// Aero diagrams JavaScript
document.addEventListener("DOMContentLoaded", function () {
  // Elements
  const stationSelect = document.getElementById("station-select");
  const dateInput = document.getElementById("date-input");
  const hourSelect = document.getElementById("hour-select");
  const buildBtn = document.getElementById("build-btn");
  const clearBtn = document.getElementById("clear-aero-btn");
  const loadingAero = document.getElementById("loading-aero");
  const errorAero = document.getElementById("error-aero");
  const stationInfo = document.getElementById("station-info");
  const chartsSection = document.getElementById("charts-section");
  const dataTableSection = document.getElementById("data-table-section");

  // Определяем производительность устройства для оптимизации
  const isLowPerformance =
    window.innerWidth <= 768 ||
    navigator.hardwareConcurrency <= 2 ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    );

  console.log(
    "Режим производительности:",
    isLowPerformance ? "упрощенный" : "полный",
  );

  // Set default date to yesterday
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  dateInput.value = yesterday.toISOString().split("T")[0];

  // Load stations on page load
  loadStations();

  // Event listeners
  buildBtn.addEventListener("click", buildDiagram);
  clearBtn.addEventListener("click", clearAll);

  function loadStations() {
    fetch("/aero/stations")
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          const stations = data.stations;
          stationSelect.innerHTML =
            '<option value="">Выберите станцию...</option>';

          // Sort stations by name
          const sortedStations = Object.entries(stations).sort((a, b) =>
            a[1].name.localeCompare(b[1].name),
          );

          sortedStations.forEach(([code, info]) => {
            const option = document.createElement("option");
            option.value = code;
            option.textContent = `${code} - ${info.name}`;
            stationSelect.appendChild(option);
          });
        } else {
          showError("Ошибка загрузки списка станций");
        }
      })
      .catch((error) => {
        showError("Ошибка соединения с сервером: " + error.message);
      });
  }

  function buildDiagram() {
    const stationId = stationSelect.value;
    const date = dateInput.value;
    const hour = hourSelect.value;

    if (!stationId) {
      showError("Пожалуйста, выберите станцию");
      return;
    }

    if (!date) {
      showError("Пожалуйста, выберите дату");
      return;
    }

    hideError();
    hideResults();
    showLoading();

    // Format date for API (YYYYMMDD)
    const dateFormatted = date.replace(/-/g, "");

    fetch("/aero/fetch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        station_id: stationId,
        date: dateFormatted,
        hour: hour,
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        hideLoading();

        if (data.success) {
          displayResults(data.data);
        } else {
          showError(data.error || "Ошибка при получении данных");
        }
      })
      .catch((error) => {
        hideLoading();
        showError("Ошибка соединения с сервером: " + error.message);
      });
  }

  function displayResults(data) {
    // Display station info
    document.getElementById("station-title").textContent =
      `${data.station_id} - ${data.station_name}`;
    document.getElementById("info-date").textContent = dateInput.value;
    document.getElementById("info-hour").textContent =
      hourSelect.value + ":00 UTC";
    document.getElementById("info-levels").textContent = data.pressure.length;
    document.getElementById("info-temp").textContent =
      data.temperature[0].toFixed(1) + "°C";

    stationInfo.style.display = "block";

    // Display stability indices
    if (data.indices) {
      displayStabilityIndices(data.indices);
    }

    // Create temperature chart
    createTemperatureChart(data);

    // Create wind chart
    createWindChart(data);

    // Create data table
    createDataTable(data);

    // Show results
    chartsSection.style.display = "block";
    dataTableSection.style.display = "block";
  }

  function displayStabilityIndices(indices) {
    const indicesSection = document.getElementById("indices-section");
    if (!indicesSection) return;

    let html = '<div class="indices-container">';
    html +=
      '<h3 style="margin-bottom: 15px; color: var(--text-primary);">Индексы неустойчивости атмосферы</h3>';

    html += '<div class="indices-grid">';

    // Индекс Фауста
    if (indices.faust !== undefined) {
      html +=
        '<div class="index-card" style="border-left: 4px solid ' +
        indices.faust_color +
        '">';
      html += '<div class="index-header">Индекс Фауста</div>';
      html +=
        '<div class="index-value" style="color: ' +
        indices.faust_color +
        '">' +
        indices.faust +
        "</div>";
      html += '<div class="index-rating">' + indices.faust_rating + "</div>";
      html +=
        '<div class="index-formula">FI = T<sub>850</sub> − T<sub>500</sub></div>';
      if (indices.t850 !== undefined && indices.t500 !== undefined) {
        html += '<div class="index-details">';
        html += "T<sub>850</sub> = " + indices.t850 + "°C, ";
        html += "T<sub>500</sub> = " + indices.t500 + "°C";
        html += "</div>";
      }
      html += "</div>";
    }

    // Индекс Вайтинга
    if (indices.whiting !== undefined) {
      html +=
        '<div class="index-card" style="border-left: 4px solid ' +
        indices.whiting_color +
        '">';
      html += '<div class="index-header">Индекс Вайтинга</div>';
      html +=
        '<div class="index-value" style="color: ' +
        indices.whiting_color +
        '">' +
        indices.whiting +
        "</div>";
      html += '<div class="index-rating">' + indices.whiting_rating + "</div>";
      html +=
        '<div class="index-formula">WI = T<sub>850</sub> − T<sub>500</sub> − (Td<sub>850</sub> − 10)</div>';
      if (indices.t850 !== undefined && indices.t500 !== undefined && indices.td850 !== undefined) {
        html += '<div class="index-details">';
        html += "T<sub>850</sub> = " + indices.t850 + "°C, ";
        html += "T<sub>500</sub> = " + indices.t500 + "°C, ";
        html += "Td<sub>850</sub> = " + indices.td850 + "°C";
        html += "</div>";
      }
      html += "</div>";
    }

    // K-индекс
    if (indices.k_index !== undefined) {
      html +=
        '<div class="index-card" style="border-left: 4px solid ' +
        indices.k_color +
        '">';
      html += '<div class="index-header">K-индекс</div>';
      html +=
        '<div class="index-value" style="color: ' +
        indices.k_color +
        '">' +
        indices.k_index +
        "</div>";
      html += '<div class="index-rating">' + indices.k_rating + "</div>";
      html +=
        '<div class="index-formula">K = T<sub>850</sub> − T<sub>500</sub> + Td<sub>850</sub> − (T<sub>700</sub> − Td<sub>700</sub>)</div>';
      if (indices.t700 !== undefined && indices.td700 !== undefined) {
        html += '<div class="index-details">';
        html += "T<sub>700</sub> = " + indices.t700 + "°C, ";
        html += "Td<sub>700</sub> = " + indices.td700 + "°C";
        html += "</div>";
      }
      html += "</div>";
    }

    // Total Totals
    if (indices.total_totals !== undefined) {
      html +=
        '<div class="index-card" style="border-left: 4px solid ' +
        indices.tt_color +
        '">';
      html += '<div class="index-header">Total Totals</div>';
      html +=
        '<div class="index-value" style="color: ' +
        indices.tt_color +
        '">' +
        indices.total_totals +
        "</div>";
      html += '<div class="index-rating">' + indices.tt_rating + "</div>";
      html +=
        '<div class="index-formula">TT = T<sub>850</sub> + Td<sub>850</sub> − 2·T<sub>500</sub></div>';
      html += "</div>";
    }

    html += "</div>"; // indices-grid
    html += "</div>"; // indices-container

    indicesSection.innerHTML = html;
    indicesSection.style.display = "block";
  }

  function createTemperatureChart(data) {
    const skewFactor = 0.04;

    function satVP(T_C) {
      return 6.1121 * Math.exp((17.502 * T_C) / (T_C + 240.97));
    }

    function moistStep(T_C, P_hPa, dP_hPa) {
      const T_K = T_C + 273.15;
      const Lv = 2.501e6, Cp = 1004, Rd = 287, Rv = 461.5;
      const es = satVP(T_C);
      const ws = 0.622 * es / Math.max(P_hPa - es, 1e-6);
      const num = 1 + (Lv * ws) / (Rd * T_K);
      const den = 1 + (Lv * Lv * ws) / (Cp * Rv * T_K * T_K);
      const dTdP = (Rd * T_K) / (P_hPa * 100 * Cp) * (num / den);
      return T_C + dTdP * dP_hPa * 100;
    }

    const tempX = data.temperature.map((t, i) => t + (1000 - data.pressure[i]) * skewFactor);
    const dewpointX = data.dewpoint.map((t, i) => t + (1000 - data.pressure[i]) * skewFactor);

    const heightLabels = data.pressure.map((_, i) => {
      const h = data.height && data.height[i] != null ? `${Math.round(data.height[i])} м` : "—";
      return h;
    });

    const tempTrace = {
      x: tempX, y: data.pressure,
      mode: "lines+markers", name: "Температура",
      line: { color: "#E53935", width: 2.5 },
      marker: { size: 5, color: "#E53935" },
      text: data.temperature.map((t) => t.toFixed(1)),
      customdata: heightLabels,
      hovertemplate: "T: %{text}°C<br>P: %{y} гПа<br>H: %{customdata}<extra></extra>",
    };

    const dewpointTrace = {
      x: dewpointX, y: data.pressure,
      mode: "lines+markers", name: "Точка росы",
      line: { color: "#43A047", width: 2.5 },
      marker: { size: 5, color: "#43A047" },
      text: data.dewpoint.map((t) => t.toFixed(1)),
      customdata: heightLabels,
      hovertemplate: "Td: %{text}°C<br>P: %{y} гПа<br>H: %{customdata}<extra></extra>",
    };

    // Изотермы (0°C рисуем отдельно)
    const isotherms = [];
    const isothermStep = isLowPerformance ? 20 : 10;
    for (let T = -80; T <= 40; T += isothermStep) {
      if (T === 0) continue;
      const x = [], y = [];
      for (let p = 1050; p >= 100; p -= 50) {
        x.push(T + (1000 - p) * skewFactor);
        y.push(p);
      }
      isotherms.push({ x, y, mode: "lines", line: { color: "#CFD8DC", width: 0.5, dash: "dot" }, showlegend: false, hoverinfo: "skip" });
    }

    // Изотерма 0°C — выделяем синим
    const zeroX = [], zeroY = [];
    for (let p = 1050; p >= 100; p -= 50) {
      zeroX.push(0 + (1000 - p) * skewFactor);
      zeroY.push(p);
    }
    const zeroIsotherm = {
      x: zeroX, y: zeroY,
      mode: "lines", name: "0°C",
      line: { color: "#1565C0", width: 2 },
      showlegend: true, hoverinfo: "skip",
    };

    // Сухие адиабаты: θ = T_surface + 273.15 K
    const dryAdiabats = [];
    const thetaSurface = isLowPerformance ? [-20, 20, 60] : [-20, 0, 20, 40, 60, 80];
    for (let idx = 0; idx < thetaSurface.length; idx++) {
      const theta_K = thetaSurface[idx] + 273.15;
      const x = [], y = [];
      for (let p = 1050; p >= 100; p -= 10) {
        const T_C = theta_K * Math.pow(p / 1000, 0.286) - 273.15;
        x.push(T_C + (1000 - p) * skewFactor);
        y.push(p);
      }
      dryAdiabats.push({
        x, y, mode: "lines",
        name: idx === 0 ? "Сухие адиабаты" : undefined,
        showlegend: idx === 0,
        line: { color: "#FFCCBC", width: 0.8 },
        hoverinfo: "skip",
      });
    }

    // Мокрые (насыщенные) адиабаты
    const moistAdiabats = [];
    const moistT0 = isLowPerformance ? [-10, 10, 30] : [-20, -10, 0, 10, 20, 30];
    for (let idx = 0; idx < moistT0.length; idx++) {
      const x = [], y = [];
      let T = moistT0[idx];
      for (let p = 1000; p >= 100; p -= 10) {
        x.push(T + (1000 - p) * skewFactor);
        y.push(p);
        T = moistStep(T, p, -10);
      }
      moistAdiabats.push({
        x, y, mode: "lines",
        name: idx === 0 ? "Мокрые адиабаты" : undefined,
        showlegend: idx === 0,
        line: { color: "#4FC3F7", width: 0.8, dash: "dash" },
        hoverinfo: "skip",
      });
    }

    // Изобары — горизонтальные линии на стандартных уровнях
    const pressureLevels = [1000, 850, 700, 500, 300, 200, 100];
    const isobars = pressureLevels.map((p) => ({
      x: [-60, 60],
      y: [p, p],
      mode: "lines",
      line: { color: "#B0BEC5", width: 0.8 },
      showlegend: false, hoverinfo: "skip",
    }));

    const layout = {
      title: { text: "Skew-T диаграмма", font: { size: 18 }, x: 0.5, xanchor: "center" },
      xaxis: {
        title: "Температура (°C)",
        showgrid: false,
        zeroline: false,
        range: [-60, 60],
      },
      yaxis: {
        title: "Давление (гПа)",
        type: "log",
        range: [Math.log10(1050), Math.log10(100)],
        tickmode: "array",
        tickvals: [100, 200, 300, 500, 700, 850, 1000],
        ticktext: ["100", "200", "300", "500", "700", "850", "1000"],
        showgrid: false,
      },
      plot_bgcolor: "#FAFAFA",
      paper_bgcolor: "white",
      hovermode: "closest",
      showlegend: true,
      legend: { x: 0.02, y: 0.98, bgcolor: "rgba(255,255,255,0.9)", bordercolor: "#BDBDBD", borderwidth: 1 },
      margin: { l: 65, r: 65, t: 60, b: 60 },
    };

    const traces = [...isobars, ...isotherms, zeroIsotherm, ...dryAdiabats, ...moistAdiabats, tempTrace, dewpointTrace];
    Plotly.newPlot("temp-chart", traces, layout, { responsive: true, displayModeBar: !isLowPerformance, staticPlot: isLowPerformance });
  }

  function createWindChart(data) {
    const windSpeed = data.u_wind.map((u, i) => {
      const v = data.v_wind[i];
      return Math.sqrt(u * u + v * v);
    });
    const windDirection = data.u_wind.map((u, i) => {
      const v = data.v_wind[i];
      return ((Math.atan2(u, v) * 180) / Math.PI + 180) % 360;
    });

    const maxSpeed = Math.max(...windSpeed);
    const speedMax = Math.max(maxSpeed * 1.15, 30);

    // Профиль скорости с hover-подсказкой о направлении
    const speedTrace = {
      x: windSpeed,
      y: data.pressure,
      mode: "lines+markers",
      name: "Скорость (км/ч)",
      line: { color: "#0D47A1", width: 2.5 },
      marker: {
        size: 6,
        color: windSpeed,
        colorscale: [[0, "#4CAF50"], [0.4, "#FFC107"], [0.7, "#FF9800"], [1, "#F44336"]],
        cmin: 0, cmax: Math.max(maxSpeed, 100),
        showscale: false,
      },
      text: windDirection.map((d) => `${Math.round(d)}°`),
      hovertemplate: "Скорость: %{x:.1f} км/ч<br>Направление: %{text}<br>P: %{y} гПа<extra></extra>",
    };

    // Легенда для стрелок направления
    const dirLegendTrace = {
      x: [null], y: [null],
      mode: "markers",
      marker: { symbol: "arrow-up", size: 12, color: "#E53935" },
      name: "Направление",
      showlegend: true,
      hoverinfo: "skip",
    };

    // Стрелки на стандартных уровнях давления
    const standardLevels = [1000, 850, 700, 500, 300, 200, 100];
    const arrowIndices = [];
    for (const target of standardLevels) {
      let closest = -1, minDiff = Infinity;
      for (let i = 0; i < data.pressure.length; i++) {
        const diff = Math.abs(data.pressure[i] - target);
        if (diff < minDiff) { minDiff = diff; closest = i; }
      }
      if (closest !== -1 && minDiff <= 75) arrowIndices.push(closest);
    }

    // ax/ay — смещение хвоста от острия в пикселях экрана (ось y: вниз = +).
    // Для ветра, дующего ИЗ направления d, воздух движется В направление moveDir.
    // Формула: ax = −sin(rad)·L, ay = cos(rad)·L даёт правильную ориентацию стрелки.
    const arrowLen = 16;
    const dirAnnotations = arrowIndices.map((i) => {
      const d = windDirection[i];
      const moveDir = (d + 180) % 360;
      const rad = (moveDir * Math.PI) / 180;
      return {
        x: windSpeed[i],
        y: data.pressure[i],
        xref: "x", yref: "y",
        ax: -Math.sin(rad) * arrowLen,
        ay: Math.cos(rad) * arrowLen,
        axref: "pixel", ayref: "pixel",
        arrowhead: 2,
        arrowsize: 1.2,
        arrowwidth: 2,
        arrowcolor: "#E53935",
        showarrow: true,
        text: "",
      };
    });

    const layout = {
      title: { text: "Профиль ветра", font: { size: 18 }, x: 0.5, xanchor: "center" },
      xaxis: {
        title: "Скорость ветра (км/ч)",
        range: [0, speedMax],
        zeroline: false,
        gridcolor: "#E0E0E0",
        showgrid: true,
      },
      yaxis: {
        title: "Давление (гПа)",
        type: "log",
        range: [Math.log10(1050), Math.log10(100)],
        tickmode: "array",
        tickvals: [100, 200, 300, 500, 700, 850, 1000],
        ticktext: ["100", "200", "300", "500", "700", "850", "1000"],
        gridcolor: "#E0E0E0",
        showgrid: true,
      },
      annotations: dirAnnotations,
      plot_bgcolor: "#FAFAFA",
      paper_bgcolor: "white",
      hovermode: "closest",
      showlegend: true,
      legend: { x: 0.02, y: 0.98, bgcolor: "rgba(255,255,255,0.9)", bordercolor: "#BDBDBD", borderwidth: 1 },
      margin: { l: 65, r: 65, t: 60, b: 60 },
    };

    Plotly.newPlot("wind-chart", [speedTrace, dirLegendTrace], layout, { responsive: true, displayModeBar: !isLowPerformance, staticPlot: isLowPerformance });
  }

  function createDataTable(data) {
    const tbody = document.getElementById("sounding-tbody");
    const fragment = document.createDocumentFragment();

    // Стандартные высоты (м) — выделяем цветом
    const standardHeights = [500, 1500, 3000, 5500, 7000, 9000];

    // Для каждой стандартной высоты находим ближайший уровень в данных
    const standardIndices = new Set();
    for (const targetH of standardHeights) {
      let closestIdx = -1;
      let minDiff = Infinity;
      for (let i = 0; i < data.pressure.length; i++) {
        if (data.height && data.height[i] != null) {
          const diff = Math.abs(data.height[i] - targetH);
          if (diff < minDiff) {
            minDiff = diff;
            closestIdx = i;
          }
        }
      }
      if (closestIdx !== -1) {
        standardIndices.add(closestIdx);
      }
    }

    // Выводим все уровни, стандартные высоты выделяем классом
    for (let i = 0; i < data.pressure.length; i++) {
      const row = document.createElement("tr");

      const u = data.u_wind[i];
      const v = data.v_wind[i];
      const speed = Math.sqrt(u * u + v * v);
      const direction = ((Math.atan2(u, v) * 180) / Math.PI + 180) % 360;

      const heightVal =
        data.height && data.height[i] != null
          ? Math.round(data.height[i])
          : "—";

      if (standardIndices.has(i)) {
        row.className = "row-standard-height";
      }

      row.innerHTML = `
                <td>${data.pressure[i].toFixed(1)}</td>
                <td>${heightVal}</td>
                <td>${data.temperature[i].toFixed(1)}</td>
                <td>${data.dewpoint[i].toFixed(1)}</td>
                <td>${speed.toFixed(1)}</td>
                <td>${direction.toFixed(0)}</td>
            `;

      fragment.appendChild(row);
    }

    tbody.innerHTML = "";
    tbody.appendChild(fragment);
  }
  function clearAll() {
    stationSelect.value = "";
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    dateInput.value = yesterday.toISOString().split("T")[0];
    hourSelect.value = "00";
    hideError();
    hideResults();
  }

  function showLoading() {
    loadingAero.style.display = "block";
  }

  function hideLoading() {
    loadingAero.style.display = "none";
  }

  function showError(message) {
    errorAero.textContent = message;
    errorAero.style.display = "block";
  }

  function hideError() {
    errorAero.style.display = "none";
  }

  function hideResults() {
    stationInfo.style.display = "none";
    const indicesSection = document.getElementById("indices-section");
    if (indicesSection) {
      indicesSection.style.display = "none";
    }
    chartsSection.style.display = "none";
    dataTableSection.style.display = "none";
  }
});
