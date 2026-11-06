# Clinical Trials Visualization Agent

This backend turns an annual trial-start question into a time-series specification backed by ClinicalTrials.gov.

## Run locally

Requires Python 3.10 or later and network access to ClinicalTrials.gov and your LLM provider. Copy `.env.example` to `.env` and set `LLM_BASE_URL`, `LLM_MODEL`, and `LLM_API_KEY`. Use the provider’s API base URL, before `/chat/completions`, and a model that supports strict JSON Schema structured outputs. Restart the service after changing the file. Shell environment variables take precedence.

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app
```

```sh
curl -fsS http://127.0.0.1:8000/query \
  -H 'Content-Type: application/json' \
  -d '{"query":"How many trials for Pembrolizumab started each year since 2015?"}'
```

## API

`POST /query` accepts a required `query` string (1–500 characters), an optional `drug_name` string (1–120 characters), and an optional integer `start_year` (1900 through the current year). The supported intent is annual actual trial starts for one drug, from an inclusive start year through the current year. Supply `drug_name` when the query says “this drug” or `start_year` when the question omits the year. Conflicting inputs and unsupported questions return HTTP 422.

The response contains `visualization` and `meta`. The visualization has type `time_series`, a title, an x encoding of `year`, a y encoding of `trial_count`, and data rows containing both integer fields. Rows are ordered by year and include zeros through the current calendar year. The current year is partial.

Metadata reports the source URL, effective filters, yearly granularity, the `ACTUAL` start-date filter, the total number of unique search matches, and the number counted in the series. The interactive schema is available at `/docs` when running locally.

## Counting rules

The service follows the ClinicalTrials.gov pagination token until the last page and verifies the number of unique NCT IDs against the first page's total. An incomplete or inconsistent upstream result returns HTTP 502. It counts search matches from `query.intr` with a valid `ACTUAL` start date in the requested years. Search matching uses the registry's intervention search semantics.

The LLM extracts a plan with an intent, drug name, and start year. The backend validates that plan and resolves it against the structured inputs before retrieving and counting trials. Missing LLM configuration returns HTTP 503. Provider failures or malformed model output return HTTP 502.
