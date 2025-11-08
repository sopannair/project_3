// src/main.js — Explorer only
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

/**
 * Expected CSV:
 * data/derived/town_year_residential_bytype.csv
 * Columns: Town, Year, Property Type, Residential Type, NumSales, MedianSale, AvgSalesRatio
 */
const DERIVED = "./data/derived/town_year_residential_bytype.csv";
const GEO_PATH = "./data/geo/ct_towns.geojson";

const statusEl = document.getElementById("status");

// ---------- load & clean ----------
let data = await d3.csv(DERIVED, d => ({
  Town: d.Town,
  Year: +d.Year,
  PropertyType: d["Property Type"],
  ResidentialType: (d["Residential Type"] || "Unspecified").trim(),
  NumSales: +d.NumSales,
  MedianSale: +d.MedianSale,
  AvgSalesRatio: d.AvgSalesRatio === "" ? NaN : +d.AvgSalesRatio
}));

// project filters: keep 2006+ and drop 'nan' type
data = data.filter(d =>
  d.Year >= 2006 &&
  d.ResidentialType.toLowerCase() !== "nan" &&
  d.ResidentialType !== ""
);

statusEl.textContent = `Loaded ${d3.format(",")(data.length)} aggregated rows (residential only)`;

// ---------- Explorer ----------
(async function explorer() {
  const mapSvg   = d3.select("#map");
  const trendSvg = d3.select("#trend");
  const mixSvg   = d3.select("#mix");
  const legendEl = d3.select("#map-legend");
  const insightEl= d3.select("#insight");
  const mapTooltip = d3.select("#tooltip-map");

  const slider   = document.getElementById("year-slider");
  const yearLbl  = document.getElementById("year-label");
  const metricSel= document.getElementById("map-metric");
  const yearRangeEl = document.getElementById("explorer-year-range");

  const mixControls = document.getElementById("mix-controls");
  const mixLegend   = d3.select("#mix-legend");
  const mixTooltip  = d3.select("#tooltip-mix");
  let mixMode = "absolute";

  const clean = data; // already filtered

  const YEARS = Array.from(new Set(clean.map(d => d.Year))).sort(d3.ascending);
  slider.min = YEARS[0]; slider.max = YEARS.at(-1); slider.value = YEARS.at(-1);
  yearLbl.textContent = slider.value;
  const updateYearHeading = () => { yearRangeEl.textContent = `(${YEARS[0]}–${slider.value})`; };
  updateYearHeading();

  const normTown = s => (s ?? "").trim().replace(/\s+/g," ").replace(/\b\w/g, c => c.toUpperCase());

  // ---- Aggregations ----
  const townYear = d3.rollups(
    clean,
    v => {
      const total = d3.sum(v, d => d.NumSales);
      const median = d3.sum(v, d => d.MedianSale * d.NumSales) / (total || 1);
      return { median, volume: total };
    },
    d => normTown(d.Town),
    d => d.Year
  );

  const townSeries = new Map(
    Array.from(townYear, ([town, m]) => [
      town,
      Array.from(m, ([Year, o]) => ({ Year:+Year, Median:o.median, Volume:o.volume }))
            .sort((a,b)=>d3.ascending(a.Year,b.Year))
    ])
  );

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

  function typeMix(rows) {
    const map = d3.rollup(rows, v => d3.sum(v, d => d.NumSales), d => d.ResidentialType);
    return Array.from(map, ([k, v]) => ({ type:k, value:v }));
  }
  function typeMixByTownYear(town, year) {
    const rows = clean.filter(d => (town ? normTown(d.Town)===town : true) && d.Year===year);
    return typeMix(rows);
  }

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

  // ---- Geo ----
  const geo = await d3.json(GEO_PATH);
  const width = +mapSvg.attr("width"), height = +mapSvg.attr("height");
  const proj = d3.geoMercator().fitSize([width, height], geo);
  const path = d3.geoPath(proj);

  function getTownName(f) {
    const p = f.properties || {};
    return normTown(p.name || p.TOWN || p.Town || p.town || p.MUNI || "");
  }

  let selected = new Set();
  const fmtMoney = d3.format("$,.0f");
  const fmtInt = d3.format(",");

  function mapColorScale(year, metric) {
    const values = geo.features.map(f => {
      const town = getTownName(f);
      const ser  = townSeries.get(town);
      if (!ser) return NaN;
      const row = ser.find(d => d.Year === +year);
      if (!row) return NaN;
      if (metric === "median") return row.Median;
      if (metric === "volume") return row.Volume;
      if (metric === "yoy") {
        const m = yoyByTownYear.get(town);
        return m ? m.get(+year) : NaN;
      }
    }).filter(v => !isNaN(v));

    const min = d3.min(values), max = d3.max(values);
    if (metric === "yoy") {
      const lim = d3.max([Math.abs(min || 0), Math.abs(max || 0)]) || 0.01;
      return d3.scaleDiverging([-lim, 0, +lim], d3.interpolateRdYlGn);
    }
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
          valText = row?.Median ? fmtMoney(row.Median) : "No data";
        } else if (metric === "volume") {
          valText = row?.Volume ? `${fmtInt(row.Volume)} sales` : "No data";
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

    // Legend text with range
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
      legendText = `Median price · darker blue = higher price (range ${fmtMoney(min || 0)} – ${fmtMoney(max || 0)})`;
    } else if (metric === "volume") {
      legendText = `# Sales · darker purple = higher sales (range ${fmtInt(min || 0)} – ${fmtInt(max || 0)})`;
    } else {
      const lim = d3.max([Math.abs(min || 0), Math.abs(max || 0)]) || 0;
      legendText = `YoY change · red = decline, green = growth (≈ −${d3.format(".0%")(lim)} to +${d3.format(".0%")(lim)})`;
    }
    legendEl.text(legendText);
  }

  function renderTrend() {
    const W = +trendSvg.attr("width"), H = +trendSvg.attr("height");
    trendSvg.selectAll("*").remove();
    const M = {top:10,right:10,bottom:30,left:56};
    const innerW = W - M.left - M.right, innerH = H - M.top - M.bottom;
    const g = trendSvg.append("g").attr("transform",`translate(${M.left},${M.top})`);

    const xs = d3.scaleLinear().domain(d3.extent(YEARS)).range([0,innerW]).nice();
    const series = [];
    const selTowns = Array.from(selected).slice(0,5);
    for (const t of selTowns) {
      const s = (townSeries.get(t) || []).map(d => ({Year:d.Year, Value:d.Median}));
      if (s.length) series.push({key:t, values:s});
    }
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

    const legend = g.append("g").attr("transform",`translate(${innerW-120},6)`);
    series.forEach((s,i)=>{
      legend.append("rect").attr("x",0).attr("y",i*16-9).attr("width",12).attr("height",12)
        .attr("fill", s.key==="Statewide" ? "#111" : color(s.key));
      legend.append("text").attr("x",16).attr("y",i*16).attr("dominant-baseline","central").text(s.key);
    });
  }

  function renderMix() {
    const W = +mixSvg.attr("width"), H = +mixSvg.attr("height");
    mixSvg.selectAll("*").remove();
    const M = {top:10,right:10,bottom:30,left:56};
    const innerW = W - M.left - M.right, innerH = H - M.top - M.bottom;
    const g = mixSvg.append("g").attr("transform",`translate(${M.left},${M.top})`);

    const rows = selected.size ? clean.filter(d => selected.has(normTown(d.Town))) : clean;

    const years = Array.from(new Set(rows.map(d => d.Year))).sort(d3.ascending);
    const types = Array.from(new Set(rows.map(d => d.ResidentialType))).sort();

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

    const series = (mixMode === "percent" ? stackPct : stackAbs)(matrix);
    const ymax = mixMode === "percent" ? 1 : d3.max(series, s => d3.max(s, d => d[1]));
    ys.domain([0, ymax]).nice();

    g.append("g").attr("transform",`translate(0,${innerH})`).attr("class","axis")
      .call(d3.axisBottom(xs).tickFormat(d3.format("d")));
    g.append("g").attr("class","axis")
      .call(mixMode==="percent" ? d3.axisLeft(ys).tickFormat(d3.format(".0%"))
                                : d3.axisLeft(ys));

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
          .html(`<b>${d.key}</b><br/>Year: ${year}<br/>` +
                (mixMode === "percent"
                  ? `Share: ${d3.format(".1%")(val / (total || 1))}`
                  : `Sales: ${d3.format(",")(val)}`));
      })
      .on("mouseleave", () => mixTooltip.attr("hidden", true));

    // legend
    mixLegend.html("");
    const items = mixLegend.selectAll(".item").data(types).join("div").attr("class","item");
    items.append("span").attr("class","swatch").style("background", d => color(d));
    items.append("span").text(d => d);
  }

  function renderInsight() {
    const year = +slider.value;
    const towns = Array.from(selected);
    if (!towns.length) {
      const stRow = stateSeries.find(d => d.Year === year);
      const vol = d3.sum(clean.filter(d => d.Year===year), d => d.NumSales);
      insightEl.html(`Statewide • ${year} — Median ${fmtMoney(stRow?.Median||0)} · ${fmtInt(vol)} sales`);
      return;
    }
    const t = towns[0];
    const s = townSeries.get(t) || [];
    const row = s.find(d => d.Year===year);
    const vol = row?.Volume || 0;
    const medians = Array.from(townSeries.values()).map(arr => (arr.find(r => r.Year===year)?.Median)).filter(v => v>0);
    const rank = 1 + medians.filter(v => v > (row?.Median||0)).length;
    const pct = (1 - rank/medians.length);
    insightEl.html(`${t} • ${year} — Median ${fmtMoney(row?.Median||0)} · ${fmtInt(vol)} sales · ${d3.format(".0%")(pct)} percentile`);
  }

  function updateAll() {
    renderMap(+slider.value, metricSel.value);
    renderTrend();
    renderMix();
    renderInsight();
  }

  // ---- listeners ----
  slider.addEventListener("input", () => {
    yearLbl.textContent = slider.value;
    updateYearHeading();
    updateAll();
  });
  metricSel.addEventListener("change", updateAll);

  Array.from(mixControls.querySelectorAll('input[name="mixMode"]')).forEach(r => {
    r.addEventListener("change", (e) => {
      mixMode = e.target.value;
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
