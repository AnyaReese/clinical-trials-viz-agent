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
