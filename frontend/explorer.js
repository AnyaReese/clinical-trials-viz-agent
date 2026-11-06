const samples = [
  ["Annual starts", "pembrolizumab-annual-starts"],
  ["Phase distribution", "cystic-fibrosis-phase-distribution"],
  ["Compare drugs", "pembrolizumab-nivolumab-phase-comparison"],
  ["Recruiting countries", "cystic-fibrosis-recruiting-by-country"],
];
const form = document.querySelector("#query-form");
const question = document.querySelector("#question");
const status = document.querySelector("#status");
const chart = document.querySelector("#chart");
const result = document.querySelector("#result");
const run = document.querySelector("#run");
const names = { year: "Year", phase: "Phase", country: "Country", drug_name: "Drug", trial_count: "Trials" };
const number = new Intl.NumberFormat("en-US");

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function svgNode(tag, attributes, text) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function lineChart(rows, x, y) {
  const svg = svgNode("svg", {
    viewBox: "0 0 700 285", class: "line-chart", role: "img",
    "aria-label": "Trial counts by start year. Exact values are in the chart data table.",
  });
  const left = 62, right = 671, top = 28, bottom = 240;
  const first = rows[0][x], last = rows.at(-1)[x];
  const step = Math.max(1, Math.ceil(Math.max(...rows.map(row => row[y])) / 4));
  const px = year => first === last ? (left + right) / 2 : left + (year - first) * (right - left) / (last - first);
  const py = count => bottom - count * (bottom - top) / (step * 4);
  for (let i = 0; i <= 4; i++) {
    const value = step * i;
    svg.append(svgNode("line", { x1: left, x2: right, y1: py(value), y2: py(value), class: "chart-grid" }));
    svg.append(svgNode("text", { x: left - 8, y: py(value) + 4, "text-anchor": "end", class: "chart-label" }, number.format(value)));
  }
  svg.append(svgNode("text", { x: left, y: 14, class: "chart-label" }, "Trials"));
  svg.append(svgNode("text", { x: (left + right) / 2, y: 278, "text-anchor": "middle", class: "chart-label" }, "Start year"));
  svg.append(svgNode("polyline", {
    points: rows.map(row => [px(row[x]), py(row[y])].join(",")).join(" "), class: "chart-line",
  }));
  const tickInterval = Math.ceil(rows.length / 6);
  rows.forEach((row, index) => {
    const dot = svgNode("circle", { cx: px(row[x]), cy: py(row[y]), r: 4, class: "chart-dot" });
    dot.append(svgNode("title", {}, row[x] + " · " + number.format(row[y]) + " trials"));
    svg.append(dot);
    if (index === rows.length - 1 || (index % tickInterval === 0 && index < rows.length - 2)) {
      svg.append(svgNode("text", {
        x: px(row[x]), y: 259, "text-anchor": "middle", class: "chart-label",
      }, row[x]));
    }
  });
  return svg;
}

function barChart(rows, x, y, series) {
  const wrapper = element("div");
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row[x])) groups.set(row[x], []);
    groups.get(row[x]).push(row);
  }
  const seriesNames = series ? [...new Set(rows.map(row => row[series]))] : [];
  if (series) {
    const legend = element("div", undefined, "legend");
    seriesNames.forEach((name, index) => {
      const label = element("span");
      label.append(element("span", undefined, "swatch series-" + (index + 1)), name);
      legend.append(label);
    });
    wrapper.append(legend);
  }
  const max = Math.max(1, ...rows.map(row => row[y]));
  const bars = element("div", undefined, "bars");
  bars.setAttribute("role", "list");
  const countryLimit = 10;
  for (const [label, group] of groups) {
    const item = element("div", undefined, "bar-row");
    item.setAttribute("role", "listitem");
    item.append(element("span", label, "bar-label"));
    const measures = element("div", undefined, "bar-series");
    for (const row of group) {
      const measure = element("div", undefined, "measure");
      const track = element("div", undefined, "track");
      const mark = element("div", undefined, "mark series-" + (seriesNames.indexOf(row[series]) + 1));
      mark.style.width = (row[y] / max * 100) + "%";
      track.append(mark);
      track.setAttribute("aria-hidden", "true");
      const value = element("span", number.format(row[y]));
      if (series) value.setAttribute("aria-label", row[series] + " · " + number.format(row[y]) + " trials");
      measure.title = (series ? row[series] + " · " : "") + number.format(row[y]) + " trials";
      measure.append(track, value);
      measures.append(measure);
    }
    item.append(measures);
    bars.append(item);
  }
  wrapper.append(element("p", "Trial count", "eyebrow"), bars);
  if (x === "country" && groups.size > countryLimit) {
    const extraRows = Array.from(bars.children).slice(countryLimit);
    const toggle = element("button", "Show all " + groups.size + " countries", "more-countries");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    for (const row of extraRows) row.hidden = true;
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      toggle.textContent = expanded ? "Show all " + groups.size + " countries" : "Show top " + countryLimit;
      for (const row of extraRows) row.hidden = expanded;
    });
    wrapper.append(toggle);
  }
  return wrapper;
}

function dataTable(rows, fields) {
  const table = element("table");
  const withSources = rows.some(row => Array.isArray(row.citations));
  const heading = table.createTHead().insertRow();
  for (const field of fields) heading.append(element("th", names[field]));
  if (withSources) heading.append(element("th", "Source records"));
  const body = table.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    for (const field of fields) tr.insertCell().textContent = row[field];
    if (!withSources) continue;
    const cell = tr.insertCell();
    if (!row.citations.length) {
      cell.textContent = "0 records";
      continue;
    }
    const disclosure = element("details");
    disclosure.append(element("summary", number.format(row.citations.length) + " records"));
    disclosure.addEventListener("toggle", () => {
      if (!disclosure.open || disclosure.querySelector("ul")) return;
      const list = element("ul");
      for (const citation of row.citations) {
        const li = element("li");
        const link = element("a", citation.nct_id);
        link.href = "https://clinicaltrials.gov/study/" + encodeURIComponent(citation.nct_id);
        const raw = Object.entries(citation.raw_fields).map(([key, value]) => key + " = " + JSON.stringify(value));
        li.append(link, " · " + (raw.join(" · ") || "Phase field omitted"));
        list.append(li);
      }
      disclosure.append(list);
    });
    cell.append(disclosure);
  }
  return table;
}

function render({ visualization, meta }, mode) {
  const { type, title, encoding, data } = visualization;
  const { x, y, series } = encoding;
  const notes = [];
  if (meta.matched_trials !== undefined) notes.push(number.format(meta.matched_trials) + " unique registry matches");
  if (meta.counting_rule) notes.push(meta.counting_rule);
  if (type === "time_series") notes.push("The final year reflects data through the query date.");
  document.querySelector("#source-mode").textContent = mode;
  document.querySelector("#chart-title").textContent = title;
  document.querySelector("#note").textContent = notes.join(" · ");
  document.querySelector("#details").open = false;
  chart.replaceChildren();
  document.querySelector("#data").replaceChildren();
  document.querySelector("#details").hidden = data.length === 0;
  if (data.length === 0) {
    chart.append(element("p", "No chart data matched this query."));
  } else {
    chart.append(type === "time_series" ? lineChart(data, x.field, y.field) : barChart(data, x.field, y.field, series?.field));
    document.querySelector("#data").append(dataTable(data, [x.field, ...(series ? [series.field] : []), y.field]));
  }
  result.hidden = false;
}

async function load(message, operation) {
  const buttons = document.querySelectorAll("#run, #examples button");
  buttons.forEach(button => { button.disabled = true; });
  status.className = "";
  status.textContent = message;
  try {
    await operation();
    status.textContent = "";
  } catch (error) {
    status.className = "error";
    status.textContent = error.message;
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}

function selectSample(file) {
  for (const button of document.querySelectorAll("#examples button")) {
    button.setAttribute("aria-pressed", String(button.dataset.sample === file));
  }
}

function openSample(file) {
  return load("Loading saved example…", async () => {
    const response = await fetch("/examples/" + file + ".json");
    if (!response.ok) throw new Error("Could not load this saved example.");
    const sample = await response.json();
    question.value = sample.request.query;
    render(sample.response, "Saved example");
    selectSample(file);
  });
}

for (const [label, file] of samples) {
  const button = element("button", label);
  button.type = "button";
  button.dataset.sample = file;
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", () => openSample(file));
  document.querySelector("#examples").append(button);
}

form.addEventListener("submit", event => {
  event.preventDefault();
  if (run.disabled) return;
  const query = question.value.trim();
  if (!query) {
    status.className = "error";
    status.textContent = "Enter a research question.";
    return;
  }
  load("Querying the trial registry…", async () => {
    const response = await fetch("/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, include_citations: document.querySelector("#citations").checked }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(typeof payload.detail === "string" ? payload.detail : "Query failed. Check the question and try again.");
    render(payload, "Live registry query");
    selectSample(null);
  });
});

openSample(samples[0][1]);
