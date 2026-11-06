# Clinical Trials Visualization Agent

This backend returns chart specifications backed by ClinicalTrials.gov for annual trial starts, phase distributions by condition, phase comparisons between drugs, and trials with recruiting sites by country.

## Run locally

Requires Python 3.10 or later and network access to ClinicalTrials.gov and your LLM provider. Copy `.env.example` to `.env` and set `LLM_BASE_URL`, `LLM_MODEL`, and `LLM_API_KEY`. Use the provider’s API base URL, before `/chat/completions`, and a model that supports strict JSON Schema structured outputs. Restart the service after changing the file. Shell environment variables take precedence.

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app
```

Open [the explorer](http://127.0.0.1:8000/) to view the four saved charts or submit a live query. Saved examples load without API credentials. A live query uses the configured LLM and registry APIs. Enable **Include source records** and expand the data table to inspect contributing registry entries.

```sh
curl -fsS http://127.0.0.1:8000/query \
  -H 'Content-Type: application/json' \
  -d '{"query":"How many trials for Pembrolizumab started each year since 2015?"}'
```

## API

To request a phase distribution, send `{"query":"How are clinical trials for cystic fibrosis distributed across phases?"}`. The optional `condition` field accepts 1–120 characters and can supply the condition when the question refers to “this condition.” Phase queries accept a single condition without drug or date filters.

The response uses `visualization.type = "bar_chart"`, with `phase` on the x-axis and `trial_count` on the y-axis. Rows follow clinical phase order, followed by “Not applicable” and “Not reported” when present. Metadata includes the condition, number of unique search matches, and counting rule. See the [actual cystic fibrosis response](examples/cystic-fibrosis-phase-distribution.json).

`POST /query` accepts a required `query` string (1–500 characters), an optional `drug_name` string (1–120 characters), and an optional integer `start_year` (1900 through the current year). For a time series, the supported intent is annual actual trial starts for one drug, from an inclusive start year through the current year. Supply `drug_name` when the query says “this drug” or `start_year` when the question omits the year. Conflicting inputs and unsupported questions return HTTP 422.

The response contains `visualization` and `meta`. The visualization has type `time_series`, a title, an x encoding of `year`, a y encoding of `trial_count`, and data rows containing both integer fields. Rows are ordered by year and include zeros through the current calendar year. The current year is partial.

Metadata reports the source URL, effective filters, yearly granularity, the `ACTUAL` start-date filter, the total number of unique search matches, and the number counted in the series. The interactive schema is available at `/docs` when running locally.

### Drug phase comparison

Ask “Compare the trial phase distributions for Pembrolizumab and Nivolumab.” Include two distinct drug names in the question. The `grouped_bar_chart` encodes `phase` on x, `trial_count` on y, and `drug_name` as the series. Each phase shown has a row for each drug, including zero counts. Each drug is searched and deduplicated independently using `query.intr`. A trial matching both searches contributes to both series. The same phase counting rules apply as for the disease distribution. [Actual comparison response](examples/pembrolizumab-nivolumab-phase-comparison.json)

### Recruiting sites by country

Ask “Which countries have the most clinical trials with recruiting sites for cystic fibrosis?” The `bar_chart` encodes `country` on x and `trial_count` on y, ordered by descending count, then country name. The service counts a trial once per country with a site marked `RECRUITING`, regardless of the trial's overall status. It skips sites without a country or recruiting status. A trial can contribute to multiple countries. Metadata includes the number of unique condition matches and the number with at least one qualifying site. [Actual country response](examples/cystic-fibrosis-recruiting-by-country.json)

## Counting rules

The service follows the ClinicalTrials.gov pagination token until the last page and verifies the number of unique NCT IDs against the first page's total. An incomplete or inconsistent upstream result returns HTTP 502. The time series counts search matches from `query.intr` with a valid `ACTUAL` start date in the requested years. Search matching uses the registry's intervention search semantics.

The phase distribution uses the registry's condition search (`query.cond`). It counts each unique trial once per listed phase. A Phase 1/Phase 2 trial contributes to both bars, so the sum of bars can exceed the number of unique trials. Registry `NA` means “Not applicable.” Missing or empty phase lists are counted under “Not reported.”

The LLM extracts an intent and the relevant drug names, start year, or condition. The backend validates that plan and resolves it against the structured inputs before retrieving and counting trials. Missing LLM configuration returns HTTP 503. Provider failures or malformed model output return HTTP 502.

## Data-point citations

Set `include_citations` to `true` in the request to include a `citations` list on each chart row. Each entry contains a contributing `nct_id` and `raw_fields`, keyed by paths relative to the registry's `protocolSection`. Year rows include the original start date and date type, phase rows include the original phase list when present, and country rows include the country and status of a qualifying site. An empty `raw_fields` object for a “Not reported” phase means the registry omitted the field. Zero-count rows return an empty citation list. Each row includes all contributing IDs, so opting in can substantially increase the response size. The default response omits citations.

## Tests

Run `python -m unittest discover -s tests -v`. The tests exercise `/query` with stubbed LLM and registry responses and require no API credentials.

## Design tradeoffs and limitations

The model selects a supported intent and extracts its parameters. The server validates them and owns pagination, deduplication, counts, and chart formatting. This limits the model's ability to change how trials are counted. The available intents cover four query shapes. Registry search may include related terms, and registry updates can change live counts. The service reads all result pages, so broad questions can be slower. A production version would add caching and a total query time budget.

Codex assisted with implementation, documentation, and tests. Verification used fixed upstream responses for failure and counting cases and live LLM and ClinicalTrials.gov calls for the saved examples. The aggregation rules and citation fields are implemented explicitly in Python.
