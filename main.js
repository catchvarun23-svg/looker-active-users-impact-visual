/* global dscc, d3 */

let lastDataResponse = null;
let selectedLaunchKey = null;
let rangeStartIndex = 0;
let rangeEndIndex = null;
let resizeTimer = null;

const DEFAULT_STYLE = {
  activeLineColor: "#155e75",
  activeLineWidth: 3,
  projectLaunchColor: "#c2410c",
  publicHolidayColor: "#7c3aed",
  eventMarkerTextColor: "#ffffff",
  showEventMarkers: true,
  beforeHighlightColor: "#e2e8f0",
  afterHighlightColor: "#dcfce7",
  selectedLaunchLineColor: "#c2410c",
  fontFamily: "Arial",
  axisFontSize: 11,
  kpiTitleFontSize: 12,
  kpiValueFontSize: 24,
  kpiPanelWidth: 220,
  eventBandHeight: 60,
  showGridlines: true
};

function getStyle(data, key) {
  const style = data?.style || {};
  const item = style[key];
  if (item && item.value !== undefined) return item.value;
  return DEFAULT_STYLE[key];
}

function parseLookerData(data) {
  const tables = data?.tables?.DEFAULT;
  if (!tables || !tables.length) return [];

  return tables.map((row) => {
    const dateDimension = row.date?.[0];
    const eventTypeDimension = row.eventType?.[0];
    const eventNameDimension = row.eventName?.[0];
    const activeUsersMetric = row.activeUsers?.[0];

    const dateRaw = dateDimension?.value || dateDimension?.formattedValue || "";
    const eventType = eventTypeDimension?.value || eventTypeDimension?.formattedValue || "";
    const eventName = eventNameDimension?.value || eventNameDimension?.formattedValue || "";
    const activeUsers = Number(activeUsersMetric?.value ?? activeUsersMetric?.formattedValue ?? 0);

    return {
      date: normalizeDate(dateRaw),
      eventType: String(eventType || "").trim(),
      eventName: String(eventName || "").trim(),
      activeUsers: Number.isFinite(activeUsers) ? activeUsers : 0
    };
  }).filter((d) => d.date);
}

function normalizeDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

function fmtDate(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short"
  });
}

function fmtLongDate(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function fmtUsers(value) {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

function buildChartRows(rawRows) {
  const byDate = new Map();

  rawRows.forEach((row) => {
    if (!byDate.has(row.date)) {
      byDate.set(row.date, {
        date: row.date,
        activeUsers: 0,
        events: []
      });
    }

    const existing = byDate.get(row.date);

    if (row.activeUsers > 0) {
      existing.activeUsers = row.activeUsers;
    }

    if (row.eventType || row.eventName) {
      existing.events.push({
        date: row.date,
        eventType: row.eventType || "Event",
        eventName: row.eventName || row.eventType || "Event"
      });
    }
  });

  const rows = Array.from(byDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row, index, arr) => {
      const beforeRows = arr.slice(Math.max(0, index - 7), index);
      const afterRows = arr.slice(index + 1, index + 8);

      const beforeAvg = beforeRows.length
        ? d3.mean(beforeRows, (d) => d.activeUsers)
        : row.activeUsers;

      const afterAvg = afterRows.length
        ? d3.mean(afterRows, (d) => d.activeUsers)
        : row.activeUsers;

      return {
        ...row,
        xIndex: index,
        beforeAvg,
        afterAvg,
        impact: beforeAvg ? ((afterAvg - beforeAvg) / beforeAvg) * 100 : 0
      };
    });

  return rows;
}

function getLaunches(rows) {
  return rows.flatMap((row) =>
    row.events
      .filter((event) => event.eventType.toLowerCase() === "project launch")
      .map((event, i) => ({
        ...event,
        key: `${event.date}-${event.eventName}-${i}`,
        activeUsers: row.activeUsers,
        beforeAvg: row.beforeAvg,
        afterAvg: row.afterAvg,
        impact: row.impact,
        xIndex: row.xIndex
      }))
  );
}

function render(dataResponse) {
  lastDataResponse = dataResponse;

  const root = document.getElementById("chart-container");
  root.innerHTML = "";

  const rawRows = parseLookerData(dataResponse);
  const rows = buildChartRows(rawRows);

  if (!rows.length) {
    root.innerHTML = `
      <div class="empty-state">
        <div>
          <strong>No data available</strong><br/>
          Add Date and Active Users fields to the visual.
        </div>
      </div>
    `;
    return;
  }

  if (rangeEndIndex === null || rangeEndIndex >= rows.length) {
    rangeStartIndex = 0;
    rangeEndIndex = rows.length - 1;
  }

  const style = {
    activeLineColor: getStyle(dataResponse, "activeLineColor"),
    activeLineWidth: Number(getStyle(dataResponse, "activeLineWidth")),
    projectLaunchColor: getStyle(dataResponse, "projectLaunchColor"),
    publicHolidayColor: getStyle(dataResponse, "publicHolidayColor"),
    eventMarkerTextColor: getStyle(dataResponse, "eventMarkerTextColor"),
    showEventMarkers: Boolean(getStyle(dataResponse, "showEventMarkers")),
    beforeHighlightColor: getStyle(dataResponse, "beforeHighlightColor"),
    afterHighlightColor: getStyle(dataResponse, "afterHighlightColor"),
    selectedLaunchLineColor: getStyle(dataResponse, "selectedLaunchLineColor"),
    fontFamily: getStyle(dataResponse, "fontFamily"),
    axisFontSize: Number(getStyle(dataResponse, "axisFontSize")),
    kpiTitleFontSize: Number(getStyle(dataResponse, "kpiTitleFontSize")),
    kpiValueFontSize: Number(getStyle(dataResponse, "kpiValueFontSize")),
    kpiPanelWidth: Number(getStyle(dataResponse, "kpiPanelWidth")),
    eventBandHeight: Number(getStyle(dataResponse, "eventBandHeight")),
    showGridlines: Boolean(getStyle(dataResponse, "showGridlines"))
  };

  const launches = getLaunches(rows);

  if (!selectedLaunchKey && launches.length) {
    selectedLaunchKey = launches[0].key;
  }

  const selectedLaunch =
    launches.find((launch) => launch.key === selectedLaunchKey) || launches[0];

  root.style.fontFamily = style.fontFamily;

  const wrap = document.createElement("div");
  wrap.className = "visual-wrap";
  wrap.style.fontFamily = style.fontFamily;

  wrap.innerHTML = `
    <div class="visual-header">
      <div>
        <h3 class="visual-title">Launch Impact View</h3>
        <p class="visual-subtitle">Daily active users with project launches and public holidays.</p>
      </div>
    </div>

    <div class="launch-buttons"></div>

    <div class="legend-row">
      <strong>Graph markers:</strong>
      <span class="legend-item"><span class="legend-dot" style="background:${style.projectLaunchColor}"></span> Project Launch</span>
      <span class="legend-item"><span class="legend-dot" style="background:${style.publicHolidayColor}"></span> Public Holiday</span>
      <span>Hover on a marker to see event details.</span>
    </div>

    <div class="content-grid" style="grid-template-columns:minmax(0, 1fr) ${style.kpiPanelWidth}px;">
      <div class="chart-card">
        <div class="chart-svg-wrap"></div>
        <div class="slider-card">
          <div class="slider-top">
            <span><strong>Timeline range</strong></span>
            <span class="slider-dates"></span>
          </div>
          <div class="slider-range">
            <div class="slider-track"></div>
            <div class="slider-fill"></div>
            <input class="slider-input slider-start" type="range" />
            <input class="slider-input slider-end" type="range" />
          </div>
        </div>
      </div>

      <div class="kpi-panel"></div>
    </div>

    <div class="tooltip"></div>
  `;

  root.appendChild(wrap);

  renderLaunchButtons(wrap, launches);
  renderKpiPanel(wrap, selectedLaunch, style);
  renderSlider(wrap, rows);
  drawChart(wrap, rows, selectedLaunch, style);
}

function renderLaunchButtons(wrap, launches) {
  const container = wrap.querySelector(".launch-buttons");

  if (!launches.length) {
    container.innerHTML = `<span class="visual-subtitle">No project launch events found.</span>`;
    return;
  }

  launches.forEach((launch) => {
    const button = document.createElement("button");
    button.className = `launch-button ${launch.key === selectedLaunchKey ? "active" : ""}`;
    button.textContent = launch.eventName;
    button.onclick = () => {
      selectedLaunchKey = launch.key;
      render(lastDataResponse);
    };
    container.appendChild(button);
  });
}

function renderKpiPanel(wrap, selectedLaunch, style) {
  const panel = wrap.querySelector(".kpi-panel");

  if (!selectedLaunch) {
    panel.innerHTML = `
      <div class="kpi-title">Selected launch</div>
      <div class="kpi-launch-name">No project launch selected</div>
    `;
    return;
  }

  panel.innerHTML = `
    <div class="kpi-title" style="font-size:${style.kpiTitleFontSize}px;">Selected launch</div>
    <div class="kpi-launch-name">${escapeHtml(selectedLaunch.eventName)}</div>
    <div class="kpi-launch-date">${fmtLongDate(selectedLaunch.date)}</div>

    <div class="kpi-card">
      <div class="kpi-label">Launch day users</div>
      <div class="kpi-value" style="font-size:${style.kpiValueFontSize}px;">${fmtUsers(selectedLaunch.activeUsers)}</div>
    </div>

    <div class="kpi-card">
      <div class="kpi-label">Before 7-day avg</div>
      <div class="kpi-value" style="font-size:${style.kpiValueFontSize}px;">${fmtUsers(selectedLaunch.beforeAvg)}</div>
    </div>

    <div class="kpi-card">
      <div class="kpi-label">After 7-day avg</div>
      <div class="kpi-value" style="font-size:${style.kpiValueFontSize}px;">${fmtUsers(selectedLaunch.afterAvg)}</div>
    </div>

    <div class="kpi-card">
      <div class="kpi-label">Estimated impact</div>
      <div class="kpi-value" style="font-size:${style.kpiValueFontSize}px;">${selectedLaunch.impact >= 0 ? "+" : ""}${selectedLaunch.impact.toFixed(1)}%</div>
    </div>
  `;
}

function renderSlider(wrap, rows) {
  const startInput = wrap.querySelector(".slider-start");
  const endInput = wrap.querySelector(".slider-end");
  const fill = wrap.querySelector(".slider-fill");
  const dates = wrap.querySelector(".slider-dates");

  startInput.min = 0;
  startInput.max = rows.length - 2;
  startInput.value = rangeStartIndex;

  endInput.min = 1;
  endInput.max = rows.length - 1;
  endInput.value = rangeEndIndex;

  const startPct = (rangeStartIndex / (rows.length - 1)) * 100;
  const endPct = (rangeEndIndex / (rows.length - 1)) * 100;

  fill.style.left = `${startPct}%`;
  fill.style.width = `${endPct - startPct}%`;
  dates.textContent = `${fmtDate(rows[rangeStartIndex].date)} → ${fmtDate(rows[rangeEndIndex].date)}`;

  startInput.oninput = (e) => {
    rangeStartIndex = Math.min(Number(e.target.value), rangeEndIndex - 1);
    render(lastDataResponse);
  };

  endInput.oninput = (e) => {
    rangeEndIndex = Math.max(Number(e.target.value), rangeStartIndex + 1);
    render(lastDataResponse);
  };
}

function drawChart(wrap, rows, selectedLaunch, style) {
  const chartWrap = wrap.querySelector(".chart-svg-wrap");
  const tooltip = wrap.querySelector(".tooltip");

  const visibleRows = rows.slice(rangeStartIndex, rangeEndIndex + 1);

  const width = chartWrap.clientWidth || 700;
  const height = chartWrap.clientHeight || 360;

  const margin = {
    top: 18,
    right: 14,
    bottom: 58,
    left: 52
  };

  const innerWidth = Math.max(100, width - margin.left - margin.right);
  const innerHeight = Math.max(100, height - margin.top - margin.bottom);

  const activeValues = visibleRows.map((d) => d.activeUsers);
  const yMin = d3.min(activeValues);
  const yMax = d3.max(activeValues);
  const padding = Math.max(1200, (yMax - yMin) * 0.12);

  const yDomainMin = Math.max(0, Math.floor((yMin - padding) / 1000) * 1000);
  const yDomainMax = Math.ceil((yMax + padding) / 1000) * 1000;

  const x = d3.scaleLinear()
    .domain([rangeStartIndex, rangeEndIndex])
    .range([0, innerWidth]);

  const y = d3.scaleLinear()
    .domain([yDomainMin, yDomainMax])
    .nice()
    .range([innerHeight, 0]);

  const eventBaseY = yDomainMin + Math.max(700, (yDomainMax - yDomainMin) * 0.05);
  const eventStep = Math.max(1100, (yDomainMax - yDomainMin) * 0.07);

  const svg = d3.select(chartWrap)
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  if (style.showGridlines) {
    g.append("g")
      .attr("class", "grid")
      .call(
        d3.axisLeft(y)
          .ticks(5)
          .tickSize(-innerWidth)
          .tickFormat("")
      );
  }

  g.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(
      d3.axisBottom(x)
        .ticks(Math.min(9, visibleRows.length))
        .tickFormat((value) => {
          const row = rows[Math.round(value)];
          return row ? fmtDate(row.date) : "";
        })
    )
    .selectAll("text")
    .style("font-size", `${style.axisFontSize}px`)
    .attr("text-anchor", "end")
    .attr("transform", "rotate(-35)");

  g.append("g")
    .attr("class", "axis")
    .call(
      d3.axisLeft(y)
        .ticks(5)
        .tickFormat(fmtUsers)
    )
    .selectAll("text")
    .style("font-size", `${style.axisFontSize}px`);

  drawImpactAreas(g, visibleRows, rows, selectedLaunch, x, y, innerHeight, style);

  const line = d3.line()
    .x((d) => x(d.xIndex))
    .y((d) => y(d.activeUsers))
    .curve(d3.curveMonotoneX);

  g.append("path")
    .datum(visibleRows)
    .attr("fill", "none")
    .attr("stroke", style.activeLineColor)
    .attr("stroke-width", style.activeLineWidth)
    .attr("d", line);

  if (selectedLaunch) {
    const selectedX = x(selectedLaunch.xIndex);

    if (selectedLaunch.xIndex >= rangeStartIndex && selectedLaunch.xIndex <= rangeEndIndex) {
      g.append("line")
        .attr("x1", selectedX)
        .attr("x2", selectedX)
        .attr("y1", 0)
        .attr("y2", innerHeight)
        .attr("stroke", style.selectedLaunchLineColor)
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", "4 3");

      g.append("text")
        .attr("x", selectedX + 4)
        .attr("y", 12)
        .attr("fill", style.selectedLaunchLineColor)
        .attr("font-size", 11)
        .attr("font-weight", 700)
        .text("Selected launch");
    }
  }

  if (style.showEventMarkers) {
    drawEventMarkers(g, visibleRows, x, y, eventBaseY, eventStep, tooltip, style);
  }
}

function drawImpactAreas(g, visibleRows, allRows, selectedLaunch, x, y, innerHeight, style) {
  if (!selectedLaunch) return;

  const selectedIndex = selectedLaunch.xIndex;

  const beforeRows = visibleRows.filter((d) =>
    d.xIndex >= selectedIndex - 7 && d.xIndex < selectedIndex
  );

  const afterRows = visibleRows.filter((d) =>
    d.xIndex > selectedIndex && d.xIndex <= selectedIndex + 7
  );

  const area = d3.area()
    .x((d) => x(d.xIndex))
    .y0(innerHeight)
    .y1((d) => y(d.activeUsers))
    .curve(d3.curveMonotoneX);

  if (beforeRows.length) {
    g.append("path")
      .datum(beforeRows)
      .attr("fill", style.beforeHighlightColor)
      .attr("opacity", 0.75)
      .attr("d", area);
  }

  if (afterRows.length) {
    g.append("path")
      .datum(afterRows)
      .attr("fill", style.afterHighlightColor)
      .attr("opacity", 0.75)
      .attr("d", area);
  }
}

function drawEventMarkers(g, visibleRows, x, y, eventBaseY, eventStep, tooltip, style) {
  visibleRows.forEach((row) => {
    if (!row.events || !row.events.length) return;

    row.events.forEach((event, stackIndex) => {
      const isLaunch = event.eventType.toLowerCase() === "project launch";
      const color = isLaunch ? style.projectLaunchColor : style.publicHolidayColor;
      const label = isLaunch ? "Launch" : "Holiday";

      const eventWithMetrics = {
        ...event,
        activeUsers: row.activeUsers,
        beforeAvg: row.beforeAvg,
        afterAvg: row.afterAvg,
        impact: row.impact
      };

      const markerX = x(row.xIndex);
      const markerY = y(eventBaseY + stackIndex * eventStep);

      const marker = g.append("g")
        .attr("transform", `translate(${markerX},${markerY})`)
        .style("cursor", "pointer");

      marker.append("line")
        .attr("x1", 0)
        .attr("y1", 10)
        .attr("x2", 0)
        .attr("y2", 22)
        .attr("stroke", color)
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", "3 2");

      marker.append("rect")
        .attr("x", -24)
        .attr("y", -10)
        .attr("width", 48)
        .attr("height", 20)
        .attr("rx", 10)
        .attr("fill", color);

      marker.append("text")
        .attr("class", "event-label")
        .attr("x", 0)
        .attr("y", 4)
        .attr("text-anchor", "middle")
        .attr("fill", style.eventMarkerTextColor)
        .text(label);

      marker
        .on("mousemove", (eventObj) => showTooltip(tooltip, eventObj, eventWithMetrics))
        .on("mouseleave", () => hideTooltip(tooltip));
    });
  });
}

function showTooltip(tooltip, eventObj, item) {
  const isLaunch = item.eventType.toLowerCase() === "project launch";

  tooltip.innerHTML = `
    <div class="tooltip-title">${escapeHtml(item.eventName)}</div>
    <div class="tooltip-muted">${fmtLongDate(item.date)}</div>

    <div class="tooltip-box">
      <div class="tooltip-small">Active users</div>
      <strong>${fmtUsers(item.activeUsers)}</strong>
    </div>

    <div class="tooltip-box">
      <div class="tooltip-small">Event type</div>
      <strong>${escapeHtml(item.eventType)}</strong>
      <div class="tooltip-small">
        ${isLaunch ? "A project was launched on this day." : "This day was a public holiday."}
      </div>
    </div>

    ${
      isLaunch
        ? `
          <div class="tooltip-box">
            <div class="tooltip-small">Before 7-day avg</div>
            <strong>${fmtUsers(item.beforeAvg)}</strong>
          </div>
          <div class="tooltip-box">
            <div class="tooltip-small">After 7-day avg</div>
            <strong>${fmtUsers(item.afterAvg)}</strong>
          </div>
          <div class="tooltip-box">
            <div class="tooltip-small">Estimated impact</div>
            <strong>${item.impact >= 0 ? "+" : ""}${item.impact.toFixed(1)}%</strong>
          </div>
        `
        : ""
    }
  `;

  tooltip.style.display = "block";
  tooltip.style.left = `${eventObj.clientX + 14}px`;
  tooltip.style.top = `${eventObj.clientY + 14}px`;
}

function hideTooltip(tooltip) {
  tooltip.style.display = "none";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeRedraw() {
  if (lastDataResponse) {
    render(lastDataResponse);
  }
}

if (typeof dscc !== "undefined") {
  dscc.subscribeToData(render, { transform: dscc.objectTransform });
} else {
  document.getElementById("chart-container").innerHTML = `
    <div class="error-state">
      dscc library was not loaded. This visual must run inside Looker Studio.
    </div>
  `;
}

window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(safeRedraw, 150);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    setTimeout(safeRedraw, 100);
  }
});

window.addEventListener("pageshow", () => {
  setTimeout(safeRedraw, 100);
});
