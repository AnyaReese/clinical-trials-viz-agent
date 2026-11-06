import io
import json
import unittest
from contextlib import ExitStack
from datetime import date
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import httpx
from fastapi.testclient import TestClient

import app


PHASE_QUESTION = "How are clinical trials for cystic fibrosis distributed across phases?"


def study(nct_id, **modules):
    return {"protocolSection": {"identificationModule": {"nctId": nct_id}, **modules}}


class QueryTests(unittest.TestCase):
    def setUp(self):
        stack = ExitStack()
        self.addCleanup(stack.close)
        self.client = stack.enter_context(TestClient(app.app))
        self.post_to_llm = stack.enter_context(patch("app.httpx.post"))
        self.open_registry = stack.enter_context(patch("app.urlopen"))
        stack.enter_context(patch.dict("os.environ", {
            "LLM_BASE_URL": "https://llm.example.test/v1",
            "LLM_MODEL": "test-model",
            "LLM_API_KEY": "test-key",
        }))

    def llm_output(self, content):
        self.post_to_llm.return_value = httpx.Response(
            200, request=httpx.Request("POST", "https://llm.example.test"),
            json={"choices": [{"finish_reason": "stop", "message": {"content": content}}]},
        )

    def plan(self, intent="phase_distribution", condition="cystic fibrosis", **fields):
        self.llm_output(json.dumps({
            "intent": intent, "condition": condition, "drug_name": None,
            "comparison_drugs": None, "start_year": None, **fields,
        }))

    def query(self, question=PHASE_QUESTION, **fields):
        return self.client.post("/query", json={"query": question, **fields})

    def pages(self, *pages):
        self.open_registry.side_effect = [
            io.StringIO(json.dumps(page)) if isinstance(page, dict) else page for page in pages
        ]

    def test_unsupported_question(self):
        self.plan("unsupported", None)
        self.assertEqual(self.query("Who won the World Cup?").status_code, 422)
        self.open_registry.assert_not_called()

    def test_conflicting_structured_fields(self):
        self.plan()
        response = self.query(condition="asthma")
        self.assertEqual(response.status_code, 422)
        self.assertIn("condition conflicts", response.json()["detail"])
        self.open_registry.assert_not_called()

    def test_invalid_model_output(self):
        for content in ("not JSON", '{"intent":"phase_distribution"}'):
            with self.subTest(content=content):
                self.llm_output(content)
                self.assertEqual(self.query().status_code, 502)
        self.open_registry.assert_not_called()

    def test_failure_on_second_page(self):
        self.plan()
        self.pages(
            {"totalCount": 2, "studies": [study("NCT00000001")], "nextPageToken": "next"},
            TimeoutError("registry timeout"),
        )
        response = self.query()
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("visualization", response.json())
        second_url = self.open_registry.call_args_list[1].args[0]
        self.assertEqual(parse_qs(urlparse(second_url).query)["pageToken"], ["next"])

    def test_empty_results(self):
        self.plan()
        self.pages({"totalCount": 0, "studies": []})
        body = self.query().json()
        self.assertEqual(body["visualization"]["data"], [])
        self.assertEqual(body["meta"]["matched_trials"], 0)

    def test_multiphase_and_duplicate_records(self):
        self.plan()
        combined = study("NCT00000001", designModule={"phases": ["PHASE1", "PHASE2", "PHASE2"]})
        self.pages(
            {"totalCount": 3, "studies": [combined], "nextPageToken": "next"},
            {"studies": [
                combined,
                study("NCT00000002", designModule={"phases": ["PHASE2"]}),
                study("NCT00000003"),
            ]},
        )
        body = self.query().json()
        self.assertEqual(body["meta"]["matched_trials"], 3)
        self.assertEqual(body["visualization"]["data"], [
            {"phase": "Phase 1", "trial_count": 1},
            {"phase": "Phase 2", "trial_count": 2},
            {"phase": "Not reported", "trial_count": 1},
        ])

    def test_phase_citations_preserve_raw_fields(self):
        self.plan()
        raw_phases = ["PHASE1", "PHASE2", "PHASE2"]
        self.pages({"totalCount": 3, "studies": [
            study("NCT00000001", designModule={"phases": raw_phases}),
            study("NCT00000002"),
            study("NCT00000003", designModule={"phases": []}),
        ]})
        rows = self.query(include_citations=True).json()["visualization"]["data"]
        citation = {"nct_id": "NCT00000001", "raw_fields": {"designModule.phases": raw_phases}}
        self.assertEqual(rows[0]["citations"], [citation])
        self.assertEqual(rows[1]["citations"], [citation])
        self.assertEqual(rows[2]["citations"], [
            {"nct_id": "NCT00000002", "raw_fields": {}},
            {"nct_id": "NCT00000003", "raw_fields": {"designModule.phases": []}},
        ])
        self.assert_citation_counts(rows)

    def test_annual_citations_exclude_estimated_and_keep_zero_years(self):
        year = date.today().year
        self.plan("annual_starts", None, drug_name="Pembrolizumab", start_year=year - 1)
        self.pages({"totalCount": 2, "studies": [
            study("NCT00000001", statusModule={"startDateStruct": {"date": f"{year}-01", "type": "ACTUAL"}}),
            study("NCT00000002", statusModule={"startDateStruct": {"date": f"{year}-01", "type": "ESTIMATED"}}),
        ]})
        rows = self.query(
            f"How many Pembrolizumab trials started each year since {year - 1}?",
            include_citations=True,
        ).json()["visualization"]["data"]
        self.assertEqual(rows[0]["citations"], [])
        self.assertEqual(rows[1]["citations"], [{
            "nct_id": "NCT00000001",
            "raw_fields": {
                "statusModule.startDateStruct.date": f"{year}-01",
                "statusModule.startDateStruct.type": "ACTUAL",
            },
        }])
        self.assert_citation_counts(rows)

    def test_comparison_citations_are_scoped_to_each_drug(self):
        self.plan("phase_comparison", None, comparison_drugs=["Pembrolizumab", "Nivolumab"])
        trial = study("NCT00000001", designModule={"phases": ["PHASE2"]})
        self.pages(
            {"totalCount": 1, "studies": [trial]},
            {"totalCount": 0, "studies": []},
        )
        rows = self.query(
            "Compare the trial phase distributions for Pembrolizumab and Nivolumab.",
            include_citations=True,
        ).json()["visualization"]["data"]
        self.assertEqual(rows[0]["drug_name"], "Pembrolizumab")
        self.assertEqual(rows[0]["citations"][0]["nct_id"], "NCT00000001")
        self.assertEqual(rows[1]["drug_name"], "Nivolumab")
        self.assertEqual(rows[1]["citations"], [])
        self.assert_citation_counts(rows)

    def test_country_citations_deduplicate_sites_in_the_same_trial(self):
        self.plan("recruiting_by_country")
        site = {"country": "France", "status": "RECRUITING"}
        self.pages({"totalCount": 1, "studies": [
            study("NCT00000001", contactsLocationsModule={"locations": [
                site, site, {"country": "Germany", "status": "COMPLETED"},
            ]}),
        ]})
        rows = self.query(
            "Which countries have clinical trials with recruiting sites for cystic fibrosis?",
            include_citations=True,
        ).json()["visualization"]["data"]
        self.assertEqual(rows, [{
            "country": "France", "trial_count": 1, "citations": [{
                "nct_id": "NCT00000001",
                "raw_fields": {
                    "contactsLocationsModule.locations[].country": "France",
                    "contactsLocationsModule.locations[].status": "RECRUITING",
                },
            }],
        }])

    def assert_citation_counts(self, rows):
        for row in rows:
            ids = [citation["nct_id"] for citation in row["citations"]]
            self.assertEqual(len(ids), row["trial_count"])
            self.assertEqual(len(set(ids)), len(ids))
