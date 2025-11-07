// src/main.js
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

/**
 * Expected CSV (residential only, by residential type):
 * data/derived/town_year_residential_bytype.csv
 * Columns: Town, Year, Property Type, Residential Type, NumSales, MedianSale, AvgSalesRatio
 */

const DERIVED = "./data/derived/town_year_residential_bytype.csv";
const statusEl = document.getElementById("status");

// ---------- helpers ----------
const fmtInt = d3.format(",.0f");
const fmtMoney = d3.format("$,");
const extentYears = data => d3.extent(data, d => d.Year);

// ---------- load ----------
let data = await d3.csv(DERIVED, d => ({
  Town: d.Town,
  Year: +d.Year,
  PropertyType: d["Property Type"],
  ResidentialType: (d["Residential Type"] || "Unspecified").trim(),
  NumSales: +d.NumSales,
  MedianSale: +d.MedianSale,
  AvgSalesRatio: d.AvgSalesRatio === "" ? NaN : +d.AvgSalesRatio
}));

// --- filter out unwanted data ---
data = data.filter(d =>
  d.Year >= 2006 &&                            // ✅ only from 2006 onwards
  d.ResidentialType.toLowerCase() !== "nan" && // ✅ exclude "nan" type
  d.ResidentialType !== ""                    // ✅ exclude empty strings
);


statusEl.textContent = `Loaded ${fmtInt(data.length)} aggregated rows (residential only)`;

const years = Array.from(new Set(data.map(d => d.Year))).sort(d3.ascending);
const rTypes = Array.from(new Set(data.map(d => d.ResidentialType))).sort();
const mostRecentYear = d3.max(years);

// =====================================================
// 0) SANITY — statewide total residential sales per year
// =====================================================
(function renderSanity() {
  const svg = d3.select("#chart-sanity");
  const W = +svg.attr("width"), H = +svg.attr("height");
  const M = { top: 28, right: 24, bottom: 40, left: 56 };
  const innerW = W - M.left - M.right, innerH = H - M.top - M.bottom;
  const g = svg.append("g").attr("transform", `translate(${M.left},${M.top})`);

  const byYear = Array.from(
    d3.rollup(data, v => d3.sum(v, d => d.NumSales), d => d.Year),
    ([Year, Count]) => ({ Year, Count })
  ).sort((a,b) => d3.ascending(a.Year, b.Year));

  const x = d3.scaleLinear().domain(d3.extent(byYear, d => d.Year)).range([0, innerW]).nice();
  const y = d3.scaleLinear().domain([0, d3.max(byYear, d => d.Count)]).range([innerH, 0]).nice();

  g.append("g").attr("class","axis").attr("transform",`translate(0,${innerH})`)
    .call(d3.axisBottom(x).tickFormat(d3.format("d")));
  g.append("g").attr("class","axis").call(d3.axisLeft(y));

  const line = d3.line().x(d => x(d.Year)).y(d => y(d.Count));
  g.append("path").datum(byYear).attr("fill","none").attr("stroke","currentColor").attr("stroke-width",2).attr("d", line);
})();

// =====================================================
// 1) STATIC — Median Sale Price by Residential Type over time
// =====================================================
(function renderTypePrice() {
  const svg = d3.select("#chart-type-price");
  const W = +svg.attr("width"), H = +svg.attr("height");
  const M = { top: 20, right: 170, bottom: 40, left: 70 };
  const innerW = W - M.left - M.right, innerH = H - M.top - M.bottom;
  const g = svg.append("g").attr("transform", `translate(${M.left},${M.top})`);

  const series = d3.rollups(
    data.filter(d => !isNaN(d.MedianSale)),
    v => d3.median(v, d => d.MedianSale),
    d => d.ResidentialType,
    d => d.Year
  ).map(([rtype, m]) => ({
    key: rtype,
    values: Array.from(m, ([Year, MedianSale]) => ({ Year:+Year, MedianSale }))
                 .sort((a,b)=>d3.ascending(a.Year,b.Year))
  }));

  const x = d3.scaleLinear().domain(extentYears(data)).range([0, innerW]).nice();
  const y = d3.scaleLinear()
    .domain([0, d3.max(series, s => d3.max(s.values, d => d.MedianSale))])
    .range([innerH, 0]).nice();

  const color = d3.scaleOrdinal().domain(series.map(s => s.key)).range(d3.schemeTableau10);

  g.append("g").attr("class","axis").attr("transform",`translate(0,${innerH})`)
    .call(d3.axisBottom(x).tickFormat(d3.format("d")));
  g.append("g").attr("class","axis").call(d3.axisLeft(y).tickFormat(d => fmtMoney(d)));

  const line = d3.line().x(d => x(d.Year)).y(d => y(d.MedianSale));
  g.selectAll(".series").data(series).join("path")
    .attr("class","series").attr("fill","none").attr("stroke-width",2)
    .attr("stroke", d => color(d.key)).attr("d", d => line(d.values));

  // legend
  const legend = svg.append("g").attr("transform", `translate(${W - M.right + 20},${M.top})`);
  series.forEach((s, i) => {
    const y0 = i * 18;
    legend.append("rect").attr("x",0).attr("y",y0-10).attr("width",14).attr("height",14).attr("fill",color(s.key));
    legend.append("text").attr("x",20).attr("y",y0+2).attr("dominant-baseline","middle").text(s.key);
  });
})();

// =====================================================
// 2) STATIC — Top 10 Towns by Median Sale Price (Residential, most recent year)
// =====================================================
(function renderTopTowns() {
  const svg = d3.select("#chart-top-towns");
  const W = +svg.attr("width"), H = +svg.attr("height");
  const M = { top: 20, right: 24, bottom: 30, left: 200 };
  const innerW = W - M.left - M.right, innerH = H - M.top - M.bottom;
  const g = svg.append("g").attr("transform", `translate(${M.left},${M.top})`);

  const filtered = data.filter(d => d.Year === mostRecentYear && !isNaN(d.MedianSale) && d.Town);
  // Weighted avg of type medians by NumSales as a proxy for town-wide median
  const byTown = d3.rollups(
    filtered,
    v => {
      const total = d3.sum(v, d => d.NumSales);
      const wAvg = d3.sum(v, d => d.MedianSale * d.NumSales) / (total || 1);
      return { Median: wAvg, NumSales: total };
    },
    d => d.Town
  ).map(([Town, o]) => ({ Town, Median: o.Median, NumSales: o.NumSales }));

  const top10 = byTown
    .sort((a,b)=>d3.descending(a.Median,b.Median))
    .slice(0,10)
    .sort((a,b)=>d3.ascending(a.Median,b.Median));

    // add 10% padding so labels never clip
    const maxVal = d3.max(top10, d => d.Median);
    const x = d3.scaleLinear()
    .domain([0, maxVal * 1.1])
    .range([0, innerW])
    .nice();

    const y = d3.scaleBand()
    .domain(top10.map(d => d.Town))
    .range([innerH, 0])
    .padding(0.15);

    g.append("g").attr("class","axis").call(d3.axisLeft(y));
    g.append("g").attr("class","axis")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(x).tickFormat(d => fmtMoney(Math.round(d))));

    g.selectAll("rect").data(top10).join("rect")
    .attr("x", 0)
    .attr("y", d => y(d.Town))
    .attr("height", y.bandwidth())
    .attr("width", d => x(d.Median))
    .attr("fill", "#4f6ee0");

    // round to nearest dollar and display nicely
    g.selectAll(".label").data(top10).join("text")
    .attr("class", "label")
    .attr("x", d => x(d.Median) + 10)
    .attr("y", d => y(d.Town) + y.bandwidth() / 2)
    .attr("dominant-baseline", "middle")
    .attr("fill", "#333")
    .text(d => fmtMoney(Math.round(d.Median)));

})();

// =====================================================
// 3) DYNAMIC — Stacked area: Sales volume by Residential Type
// =====================================================
(function renderStacked() {
  const svg = d3.select("#chart-stack");
  const W = +svg.attr("width"), H = +svg.attr("height");
  const M = { top: 24, right: 20, bottom: 30, left: 56 };
  const innerW = W - M.left - M.right, innerH = H - M.top - M.bottom;
  const g = svg.append("g").attr("transform", `translate(${M.left},${M.top})`);
  const tooltip = d3.select("#tooltip-stack");

  const yearsSorted = years.slice();
  const typeList = rTypes.slice();

  // Year x ResidentialType -> NumSales
  const byYearType = yearsSorted.map(Y => {
    const row = { Year: Y };
    typeList.forEach(t => {
      row[t] = d3.sum(data.filter(d => d.Year === Y && d.ResidentialType === t), d => d.NumSales) || 0;
    });
    return row;
  });

  const color = d3.scaleOrdinal().domain(typeList).range(d3.schemeTableau10);
  const stackAbs = d3.stack().keys(typeList);
  const stackPct = d3.stack().keys(typeList).offset(d3.stackOffsetExpand);

  const x = d3.scaleLinear().domain(d3.extent(yearsSorted)).range([0, innerW]).nice();
  const y = d3.scaleLinear().range([innerH, 0]).nice();
  const area = d3.area().x(d => x(d.data.Year)).y0(d => y(d[0])).y1(d => y(d[1]));

  function update(mode="absolute") {
    const series = (mode === "percent" ? stackPct : stackAbs)(byYearType);
    const ymax = mode === "percent" ? 1 : d3.max(series, s => d3.max(s, d => d[1]));
    y.domain([0, ymax]).nice();

    g.selectAll(".x-axis").data([null]).join("g")
      .attr("class","x-axis axis").attr("transform",`translate(0,${innerH})`)
      .call(d3.axisBottom(x).tickFormat(d3.format("d")));

    g.selectAll(".y-axis").data([null]).join("g")
      .attr("class","y-axis axis")
      .call(mode==="percent" ? d3.axisLeft(y).tickFormat(d3.format(".0%"))
                             : d3.axisLeft(y));

    const groups = g.selectAll(".layer").data(series, d => d.key);
    groups.join(
      enter => enter.append("path")
        .attr("class","layer")
        .attr("fill", d => color(d.key))
        .attr("d", area)
        .on("mousemove", (event, d) => {
          const [mx] = d3.pointer(event);
          const year = Math.round(x.invert(mx));
          const row = byYearType.find(r => r.Year === year);
          const total = d3.sum(typeList, k => row[k] || 0);
          const value = row ? row[d.key] : 0;
          tooltip
            .attr("hidden", null)
            .style("left", (event.pageX + 12) + "px")
            .style("top",  (event.pageY + 12) + "px")
            .html(`<b>${d.key}</b><br>Year: ${year}<br>${
              mode==="percent" ? `Share: ${d3.format(".1%")(value/(total||1))}`
                               : `Sales: ${fmtInt(value)}`
            }`);
        })
        .on("mouseleave", () => tooltip.attr("hidden", true)),
      update => update.transition().duration(450).attr("d", area)
    );
  }

  // legend
  const legend = d3.select("#legend-stack");
  legend.selectAll(".item").data(typeList).join("div")
    .attr("class","item")
    .html(d => `<span class="swatch" style="background:${color(d)}"></span>${d}`);

  // radio handlers
  document.querySelectorAll('input[name="stackMode"]').forEach(input => {
    input.addEventListener("change", e => update(e.target.value));
  });

  update("absolute");
})();

// =====================================================
// 4) DYNAMIC — Median Sale Price Over Time (Town + Type filters)
// =====================================================
(function renderTrend() {
  const svg = d3.select("#chart-trend");
  const W = +svg.attr("width"), H = +svg.attr("height");
  const M = { top: 20, right: 20, bottom: 40, left: 70 };
  const innerW = W - M.left - M.right, innerH = H - M.top - M.bottom;
  const g = svg.append("g").attr("transform", `translate(${M.left},${M.top})`);
  const tooltip = d3.select("#tooltip-trend");

  // -- controls
  const townSel = document.getElementById("trend-town");
  const typeSel = document.getElementById("trend-type");

  const towns = Array.from(new Set(data.map(d => d.Town))).sort((a,b)=>a.localeCompare(b));
  const rTypes = Array.from(new Set(data.map(d => d.ResidentialType))).sort();

  // populate dropdowns
  function fillSelect(el, opts, firstLabel) {
    const frag = document.createDocumentFragment();
    const opt0 = document.createElement("option");
    opt0.value = "__ALL__"; opt0.textContent = firstLabel;
    frag.appendChild(opt0);
    opts.forEach(v => { const o = document.createElement("option"); o.value=v; o.textContent=v; frag.appendChild(o); });
    el.innerHTML = ""; el.appendChild(frag);
  }
  fillSelect(townSel, towns, "All (Statewide)");
  fillSelect(typeSel, rTypes, "All Types");
  townSel.value = "__ALL__";
  typeSel.value = "__ALL__";

  // scales + axes
  const x = d3.scaleLinear().domain(d3.extent(data, d => d.Year)).range([0, innerW]).nice();
  const y = d3.scaleLinear().range([innerH, 0]).nice();

  const xAxis = g.append("g").attr("class","axis").attr("transform",`translate(0,${innerH})`)
                 .call(d3.axisBottom(x).tickFormat(d3.format("d")));
  const yAxis = g.append("g").attr("class","axis");

  const line = d3.line().x(d => x(d.Year)).y(d => y(d.Median));

  const path = g.append("path").attr("fill","none").attr("stroke","currentColor").attr("stroke-width",2);
  const focusDot = g.append("circle").attr("r",3).attr("fill","currentColor").attr("opacity",0);

  // compute a weighted-average-of-medians per year (weights = NumSales)
  function aggregateSeries(rows) {
    const map = d3.rollup(
      rows.filter(d => !isNaN(d.MedianSale)),
      v => {
        const total = d3.sum(v, d => d.NumSales);
        const wAvg = d3.sum(v, d => d.MedianSale * d.NumSales) / (total || 1);
        return wAvg;
      },
      d => d.Year
    );
    return Array.from(map, ([Year, Median]) => ({ Year:+Year, Median }))
                .sort((a,b)=>d3.ascending(a.Year,b.Year));
  }

  function getFiltered() {
    const tTown = townSel.value;
    const tType = typeSel.value;

    let rows = data;
    if (tTown !== "__ALL__") rows = rows.filter(d => d.Town === tTown);
    if (tType !== "__ALL__") rows = rows.filter(d => d.ResidentialType === tType);

    // If both are ALL, this returns statewide series (weighted across towns and types)
    return aggregateSeries(rows);
  }

  function update() {
    const series = getFiltered();

    // guard: if empty (rare), set minimal domain
    const yMax = d3.max(series, d => d.Median) || 1;
    y.domain([0, yMax]).nice();
    yAxis.call(d3.axisLeft(y).tickFormat(d3.format("$,")));

    xAxis.call(d3.axisBottom(x).tickFormat(d3.format("d")));
    path.datum(series).attr("d", line);

    // hover interaction over the whole plot area
    svg.on("mousemove", (event) => {
      const [mx, my] = d3.pointer(event, g.node());
      const year = Math.round(x.invert(mx));
      // find nearest year in series
      const i = d3.bisector(d => d.Year).center(series, year);
      const d0 = series[i];
      if (!d0) { tooltip.attr("hidden", true); focusDot.attr("opacity", 0); return; }

      focusDot.attr("cx", x(d0.Year)).attr("cy", y(d0.Median)).attr("opacity", 1);
      tooltip.attr("hidden", null)
        .style("left", (event.pageX + 12) + "px")
        .style("top", (event.pageY + 12) + "px")
        .html(
          `<b>${tTownLabel()}</b><br>` +
          `<b>${tTypeLabel()}</b><br>` +
          `Year: ${d0.Year}<br>` +
          `Median: ${d3.format("$,")(d0.Median)}`
        );
    }).on("mouseleave", () => {
      tooltip.attr("hidden", true);
      focusDot.attr("opacity", 0);
    });
  }

  function tTownLabel() {
    return townSel.value === "__ALL__" ? "Statewide" : townSel.value;
    }
  function tTypeLabel() {
    return typeSel.value === "__ALL__" ? "All Residential Types" : typeSel.value;
  }

  // listeners
  townSel.addEventListener("change", update);
  typeSel.addEventListener("change", update);

  update(); // initial render
})();

// =====================================================
// Interactive Explorer (Map + Linked Trend + Type Mix)
// =====================================================
(async function explorer() {
  // ---- CONFIG / ELEMENTS ----
  const GEO_PATH = "./data/geo/ct_towns.geojson";
  const mapSvg   = d3.select("#map");
  const trendSvg = d3.select("#trend");
  const mixSvg   = d3.select("#mix");
  const legendEl = d3.select("#map-legend");
  const insightEl= d3.select("#insight");
  const slider   = document.getElementById("year-slider");
  const yearLbl  = document.getElementById("year-label");
  const metricSel= document.getElementById("map-metric");
  const mixControls = document.getElementById("mix-controls");
    const mixLegend   = d3.select("#mix-legend");
    const mixTooltip  = d3.select("#tooltip-mix");
    let mixMode = "absolute"; // or "percent"
    const mapTooltip = d3.select("#tooltip-map");



  const yearRangeEl = document.getElementById("explorer-year-range");
function updateYearHeading() {
  yearRangeEl.textContent = `(${YEARS[0]}–${slider.value})`;
}


  // Respect your earlier filter (>=2006, no "nan") if not already applied
  const clean = data.filter(d => d.Year >= 2006 && d.ResidentialType.toLowerCase() !== "nan");

  const YEARS = Array.from(new Set(clean.map(d => d.Year))).sort(d3.ascending);
slider.min = YEARS[0]; slider.max = YEARS.at(-1); slider.value = YEARS.at(-1);
yearLbl.textContent = slider.value;
updateYearHeading();




  // Normalize town label like your Python script (title-case common)
  function normTown(s) { return (s ?? "").trim().replace(/\s+/g," ").replace(/\b\w/g, c => c.toUpperCase()); }

  // -------------- Aggregations --------------
  // Weighted median approximation per town-year (weighted avg of medians by NumSales)
  const townYear = d3.rollups(
    clean,
    v => {
      const total = d3.sum(v, d => d.NumSales);
      const median = d3.sum(v, d => d.MedianSale * d.NumSales) / (total || 1);
      return { median, volume: total };
    },
    d => normTown(d.Town),
    d => d.Year
  ); // Map<Town, Map<Year, {median, volume}>>

  const townSeries = new Map(
    Array.from(townYear, ([town, m]) => [
      town,
      Array.from(m, ([Year, o]) => ({ Year:+Year, Median:o.median, Volume:o.volume }))
            .sort((a,b)=>d3.ascending(a.Year,b.Year))
    ])
  );

  // Statewide series (for trend comparison)
  const stateSeries = Array.from(
    d3.rollup(
      clean,
      v => {
        const total = d3.sum(v, d => d.NumSales);
        return d3.sum(v, d => d.MedianSale * d.NumSales) / (total || 1);
      },
      d => d.Year
    ),
    ([Year, Median]) => ({ Year:+Year, Median })
  ).sort((a,b)=>d3.ascending(a.Year,b.Year));

  // Residential type mix per (town*, year)
  function typeMix(rows) {
    const map = d3.rollup(rows, v => d3.sum(v, d => d.NumSales), d => d.ResidentialType);
    return Array.from(map, ([k, v]) => ({ type:k, value:v }));
  }
  function typeMixByTownYear(town, year) {
    const rows = clean.filter(d => (town ? normTown(d.Town)===town : true) && d.Year===year);
    return typeMix(rows);
  }

  // YoY growth per town-year (using townSeries)
  const yoyByTownYear = new Map();
  for (const [town, arr] of townSeries) {
    const map = new Map();
    for (let i=1; i<arr.length; i++) {
      const prev = arr[i-1], cur = arr[i];
      if (prev && prev.Median && cur && cur.Median) {
        map.set(cur.Year, (cur.Median - prev.Median) / prev.Median);
      }
    }
    yoyByTownYear.set(town, map);
  }

  // -------------- MAP: draw --------------
  const geo = await d3.json(GEO_PATH);
  const width = +mapSvg.attr("width"), height = +mapSvg.attr("height");
  const proj = d3.geoMercator().fitSize([width, height], geo);
  const path = d3.geoPath(proj);

  // Derive Town Names from geoJson
  function getTownName(f) {
    const p = f.properties || {};
    return normTown(p.name);
  }

  // Color scales (recomputed on update)
  const fmtMoney = d3.format("$,");
  const fmtPct = d3.format(".0%");

  let selected = new Set(); // clicked towns

  function mapColorScale(year, metric) {
    // Build vector of values across towns for chosen metric
    const values = geo.features.map(f => {
      const town = getTownName(f);
      const ser  = townSeries.get(town);
      if (!ser) return NaN;
      const row = ser.find(d => d.Year === +year);
      if (!row) return NaN;
      if (metric === "median") return row.Median;
      if (metric === "volume") return row.Volume;
      if (metric === "yoy") {
        const map = yoyByTownYear.get(town);
        return map ? map.get(+year) : NaN;
      }
    }).filter(v => !isNaN(v));

    const min = d3.min(values), max = d3.max(values);
    if (metric === "yoy") {
      const lim = d3.max([Math.abs(min || 0), Math.abs(max || 0)]) || 0.01;
      return d3.scaleDiverging([-lim, 0, +lim], d3.interpolateRdYlGn);
    }
    // sequential for median and volume
    return d3.scaleSequential([min || 0, max || 1], metric === "median" ? d3.interpolateBlues : d3.interpolatePuRd);
  }

function renderMap(year = +slider.value, metric = metricSel.value) {
  yearLbl.textContent = year;

  const color = mapColorScale(year, metric);

  const towns = mapSvg.selectAll(".town")
    .data(geo.features, d => getTownName(d));

  towns.join("path")
    .attr("class", d => "town" + (selected.has(getTownName(d)) ? " selected" : ""))
    .attr("d", path)
    .attr("fill", d => {
      const name = getTownName(d);
      const ser  = townSeries.get(name);
      if (!ser) return "#eee";
      const row  = ser.find(r => r.Year === +year);
      if (!row) return "#eee";
      const val = (metric==="median") ? row.Median
                : (metric==="volume") ? row.Volume
                : (yoyByTownYear.get(name)?.get(+year));
      return (val==null || isNaN(val)) ? "#eee" : color(val);
    })
    .on("mousemove", (event, d) => {
      const name = getTownName(d);
      const ser  = townSeries.get(name);
      const row  = ser?.find(r => r.Year === +year);
      let valText = "";
      if (metric === "median") {
        valText = row?.Median ? d3.format("$,")(row.Median) : "No data";
      } else if (metric === "volume") {
        valText = row?.Volume ? d3.format(",")(row.Volume) + " sales" : "No data";
      } else {
        const v = yoyByTownYear.get(name)?.get(+year);
        valText = (v!=null && !isNaN(v)) ? d3.format(".1%")(v) : "No data";
      }

      mapTooltip
        .attr("hidden", null)
        .style("left", (event.pageX + 12) + "px")
        .style("top",  (event.pageY + 12) + "px")
        .html(`<b>${name}</b><br>${metric === "median" ? "Median price" :
               metric === "volume" ? "# Sales" : "YoY change"}: ${valText}`);
    })
    .on("mouseleave", () => mapTooltip.attr("hidden", true))
    .on("click", (event, d) => {
      const name = getTownName(d);
      if (event.metaKey || event.ctrlKey) {
        if (selected.has(name)) selected.delete(name); else selected.add(name);
      } else {
        selected = new Set(selected.has(name) && selected.size===1 ? [] : [name]);
      }
      renderMap(year, metric);
      renderTrend();
      renderMix();
      renderInsight();
    });

  // --- Simple, descriptive legend text with min/max
  const values = geo.features.map(f => {
    const t = getTownName(f);
    const r = townSeries.get(t)?.find(x => x.Year === +year);
    if (!r) return NaN;
    if (metric === "median") return r.Median;
    if (metric === "volume") return r.Volume;
    return yoyByTownYear.get(t)?.get(+year);
  }).filter(v => !isNaN(v));

  const min = d3.min(values), max = d3.max(values);

  let legendText = "";
  if (metric === "median") {
    legendText = `Median price · darker blue = higher price (range ${d3.format("$,")(min || 0)} – ${d3.format("$,")(max || 0)})`;
  } else if (metric === "volume") {
    legendText = `# Sales · darker purple = higher sales (range ${d3.format(",")(min || 0)} – ${d3.format(",")(max || 0)})`;
  } else {
    // diverging scale description
    const lim = d3.max([Math.abs(min || 0), Math.abs(max || 0)]) || 0;
    legendText = `YoY change · red = decline, green = growth (≈ −${d3.format(".0%")(lim)} to +${d3.format(".0%")(lim)})`;
  }
  legendEl.text(legendText);
}


  // -------------- TREND: selected vs statewide --------------
  function renderTrend() {
    const W = +trendSvg.attr("width"), H = +trendSvg.attr("height");
    trendSvg.selectAll("*").remove();
    const M = {top:10,right:10,bottom:30,left:56};
    const innerW = W - M.left - M.right, innerH = H - M.top - M.bottom;
    const g = trendSvg.append("g").attr("transform",`translate(${M.left},${M.top})`);

    const xs = d3.scaleLinear().domain(d3.extent(YEARS)).range([0,innerW]).nice();
    const series = [];
    // selected towns (limit 5 for clarity)
    const selTowns = Array.from(selected).slice(0,5);
    for (const t of selTowns) {
      const s = (townSeries.get(t) || []).map(d => ({Year:d.Year, Value:d.Median}));
      if (s.length) series.push({key:t, values:s});
    }
    // statewide
    series.push({key:"Statewide", values: stateSeries.map(d => ({Year:d.Year, Value:d.Median}))});

    const ymax = d3.max(series, s => d3.max(s.values, v => v.Value)) || 1;
    const ys = d3.scaleLinear().domain([0, ymax]).range([innerH,0]).nice();
    const color = d3.scaleOrdinal().domain(series.map(s=>s.key)).range(d3.schemeTableau10);

    g.append("g").attr("transform",`translate(0,${innerH})`).attr("class","axis")
      .call(d3.axisBottom(xs).tickFormat(d3.format("d")));
    g.append("g").attr("class","axis")
      .call(d3.axisLeft(ys).tickFormat(d => d3.format("$,")(d)));

    const line = d3.line().x(d => xs(d.Year)).y(d => ys(d.Value));

    g.selectAll(".trend").data(series).join("path")
      .attr("class","trend").attr("fill","none").attr("stroke-width",2)
      .attr("stroke", d => d.key==="Statewide" ? "#111" : color(d.key))
      .attr("opacity", d => d.key==="Statewide" ? 0.9 : 0.85)
      .attr("d", d => line(d.values));

    // legend (inline)
    const legend = g.append("g").attr("transform",`translate(${innerW-120},6)`);
    series.forEach((s,i)=>{
      legend.append("rect").attr("x",0).attr("y",i*16-9).attr("width",12).attr("height",12)
        .attr("fill", s.key==="Statewide" ? "#111" : color(s.key));
      legend.append("text").attr("x",16).attr("y",i*16).attr("dominant-baseline","central").text(s.key);
    });
  }

  // -------------- MIX: stacked area of residential types --------------
    function renderMix() {
    const W = +mixSvg.attr("width"), H = +mixSvg.attr("height");
    mixSvg.selectAll("*").remove();
    const M = {top:10,right:10,bottom:30,left:56};
    const innerW = W - M.left - M.right, innerH = H - M.top - M.bottom;
    const g = mixSvg.append("g").attr("transform",`translate(${M.left},${M.top})`);

    // focus rows: selected towns (or statewide if none)
    const rows = selected.size
        ? clean.filter(d => selected.has(normTown(d.Town)))
        : clean;

    const years = Array.from(new Set(rows.map(d => d.Year))).sort(d3.ascending);
    const types = Array.from(new Set(rows.map(d => d.ResidentialType))).sort();

    // Year × Type -> NumSales matrix
    const matrix = years.map(Y => {
        const row = {Year:Y};
        for (const t of types) {
        row[t] = d3.sum(rows.filter(d => d.Year===Y && d.ResidentialType===t), d => d.NumSales) || 0;
        }
        return row;
    });

    const xs = d3.scaleLinear().domain(d3.extent(years)).range([0,innerW]).nice();
    const ys = d3.scaleLinear().range([innerH,0]);
    const color = d3.scaleOrdinal().domain(types).range(d3.schemeTableau10);

    const stackAbs = d3.stack().keys(types);
    const stackPct = d3.stack().keys(types).offset(d3.stackOffsetExpand);
    const area = d3.area().x(d => xs(d.data.Year)).y0(d => ys(d[0])).y1(d => ys(d[1]));

    // choose mode
    const series = (mixMode === "percent" ? stackPct : stackAbs)(matrix);
    const ymax = mixMode === "percent" ? 1 : d3.max(series, s => d3.max(s, d => d[1]));
    ys.domain([0, ymax]).nice();

    // axes
    g.append("g").attr("transform",`translate(0,${innerH})`).attr("class","axis")
        .call(d3.axisBottom(xs).tickFormat(d3.format("d")));
    g.append("g").attr("class","axis")
        .call(mixMode==="percent" ? d3.axisLeft(ys).tickFormat(d3.format(".0%"))
                                : d3.axisLeft(ys));

    // layers + tooltip
    g.selectAll(".layer").data(series, d => d.key).join("path")
        .attr("class","layer")
        .attr("fill", d => color(d.key))
        .attr("d", area)
        .on("mousemove", (event, d) => {
        const [mx] = d3.pointer(event, g.node());
        const year = Math.round(xs.invert(mx));
        const row = matrix.find(r => r.Year === year);
        if (!row) return;

        const total = d3.sum(types, t => row[t] || 0);
        const val = row[d.key] || 0;

        mixTooltip
            .attr("hidden", null)
            .style("left", (event.pageX + 12) + "px")
            .style("top",  (event.pageY + 12) + "px")
            .html(
            `<b>${d.key}</b><br/>Year: ${year}<br/>` +
            (mixMode === "percent"
                ? `Share: ${d3.format(".1%")(val / (total || 1))}`
                : `Sales: ${d3.format(",")(val)}`
            )
            );
        })
        .on("mouseleave", () => mixTooltip.attr("hidden", true));

    // legend
    mixLegend.html("");
    const items = mixLegend.selectAll(".item").data(types).join("div").attr("class","item");
    items.append("span").attr("class","swatch").style("background", d => color(d));
    items.append("span").text(d => d);
    }

  // -------------- INSIGHT PANEL --------------
  function renderInsight() {
    const year = +slider.value;
    const towns = Array.from(selected);
    if (!towns.length) {
      // statewide
      const stRow = stateSeries.find(d => d.Year === year);
      const vol = d3.sum(clean.filter(d => d.Year===year), d => d.NumSales);
      insightEl.html(`Statewide • ${year} — Median ${fmtMoney(stRow?.Median||0)} · ${fmtInt(vol)} sales`);
      return;
    }
    // first selected town summary (if multiple, show first; still reflected in charts)
    const t = towns[0];
    const s = townSeries.get(t) || [];
    const row = s.find(d => d.Year===year);
    const vol = row?.Volume || 0;
    // rank by median among towns with data
    const medians = Array.from(townSeries.values()).map(arr => (arr.find(r => r.Year===year)?.Median)).filter(v => v>0);
    const rank = 1 + medians.filter(v => v > (row?.Median||0)).length;
    const pct = (1 - rank/medians.length);
    insightEl.html(`${t} • ${year} — Median ${fmtMoney(row?.Median||0)} · ${fmtInt(vol)} sales · ${d3.format(".0%")(pct)} percentile`);
  }

  // -------------- Wire controls --------------
  function updateAll() {
    renderMap(+slider.value, metricSel.value);
    renderTrend();
    renderMix();
    renderInsight();
  }

  slider.addEventListener("input", () => {
  yearLbl.textContent = slider.value;
  updateYearHeading();   // <-- update "(2006–YYYY)" in the title
  updateAll();
});

  metricSel.addEventListener("change", updateAll);
  Array.from(mixControls.querySelectorAll('input[name="mixMode"]')).forEach(r => {
  r.addEventListener("change", (e) => {
    mixMode = e.target.value;   // "absolute" or "percent"
    renderMix();
  });
});


  // clicking background clears selection
  mapSvg.on("click", (e) => {
    if (e.target === mapSvg.node()) {
      selected.clear();
      updateAll();
    }
  });

  // initial draw
  updateAll();
})();
