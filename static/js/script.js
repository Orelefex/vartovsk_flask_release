// METAR Decoder JavaScript with Auto-fetch functionality
document.addEventListener("DOMContentLoaded", function () {
  // Elements
  const icaoSearch = document.getElementById("icao-search");
  const searchResults = document.getElementById("search-results");
  const fetchBtn = document.getElementById("fetch-btn");
  const clearBtn = document.getElementById("clear-btn");
  const loading = document.getElementById("loading");
  const errorMessage = document.getElementById("error-message");
  const resultSection = document.getElementById("result-section");
  const fetchInfo = document.getElementById("fetch-info");
  const tafSection = document.getElementById("taf-section");
  const tafDecodedSection = document.getElementById("taf-decoded-section");
  const metarHistorySection = document.getElementById("metar-history-section");
  const tafHistorySection = document.getElementById("taf-history-section");
  const archiveBtn = document.getElementById("archive-btn");

  let selectedAirports = []; // Массив выбранных аэропортов {icao, name, runway_headings}
  let searchTimeout;
  const selectedAirportsContainer =
    document.getElementById("selected-airports");
  const airportsList = document.getElementById("airports-list");

  // Оптимизация: AbortController для отмены старых запросов
  let currentFetchController = null;

  // Оптимизация: простое кеширование данных на 5 минут
  const dataCache = new Map();
  const CACHE_DURATION = 5 * 60 * 1000; // 5 минут

  // Очистка старого кеша каждую минуту
  setInterval(() => {
    const now = Date.now();
    for (const [key, value] of dataCache.entries()) {
      if (now - value.timestamp > CACHE_DURATION) {
        dataCache.delete(key);
        console.log(`Удален устаревший кеш для ${key}`);
      }
    }
  }, 60000);

  // Настройки времени
  const localTimeToggle = document.getElementById("local-time-toggle");
  let useLocalTime = localStorage.getItem("useLocalTime") === "true" || false;

  // Устанавливаем начальное состояние чекбокса
  if (localTimeToggle) {
    localTimeToggle.checked = useLocalTime;
  }

  // Archive button click handler
  if (archiveBtn) {
    archiveBtn.addEventListener("click", function () {
      if (selectedIcao) {
        window.location.href = `/archive?icao=${selectedIcao}`;
      }
    });
  }

  // ICAO search with debounce
  icaoSearch.addEventListener("input", function () {
    const query = this.value.trim();

    clearTimeout(searchTimeout);

    if (query.length < 2) {
      searchResults.classList.remove("active");
      return;
    }

    searchTimeout = setTimeout(() => {
      searchAirports(query);
    }, 300);
  });

  // Close search results when clicking outside
  document.addEventListener("click", function (e) {
    if (!searchResults.contains(e.target) && e.target !== icaoSearch) {
      searchResults.classList.remove("active");
    }
  });

  // Event Listeners
  clearBtn.addEventListener("click", clearAll);
  fetchBtn.addEventListener("click", fetchMetarTaf);

  // Event delegation для результатов поиска (оптимизация)
  searchResults.addEventListener("click", function (e) {
    const item = e.target.closest(".search-result-item");
    if (item) {
      const airport = {
        icao: item.dataset.icao,
        name: item.dataset.name,
        runway_headings: item.dataset.runwayHeadings,
      };
      selectAirport(airport);
    }
  });

  // Functions

  function searchAirports(query) {
    fetch(`/airports/search?q=${encodeURIComponent(query)}`)
      .then((response) => response.json())
      .then((data) => {
        displaySearchResults(data.results);
      })
      .catch((error) => {
        console.error("Search error:", error);
      });
  }

  function displaySearchResults(results) {
    if (results.length === 0) {
      searchResults.classList.remove("active");
      return;
    }

    // Оптимизация: используем DocumentFragment для массовой вставки
    const fragment = document.createDocumentFragment();
    results.forEach((result) => {
      const item = document.createElement("div");
      item.className = "search-result-item";
      item.innerHTML = `
                <span class="search-result-icao">${result.icao}</span>
                <span class="search-result-name">${result.name}</span>
            `;
      // Сохраняем данные в data-атрибут для event delegation
      item.dataset.icao = result.icao;
      item.dataset.name = result.name;
      item.dataset.runwayHeadings = result.runway_headings || "";
      fragment.appendChild(item);
    });

    searchResults.innerHTML = "";
    searchResults.appendChild(fragment);
    searchResults.classList.add("active");
  }

  function selectAirport(airport) {
    // Проверяем, не добавлен ли уже этот аэропорт
    if (selectedAirports.some((a) => a.icao === airport.icao)) {
      showError(`Аэропорт ${airport.icao} уже добавлен`);
      searchResults.classList.remove("active");
      icaoSearch.value = "";
      return;
    }

    // Добавляем аэропорт в список
    selectedAirports.push({
      icao: airport.icao,
      name: airport.name,
      runway_headings: airport.runway_headings || "",
    });

    // Обновляем отображение
    renderSelectedAirports();

    // Очищаем поле поиска
    icaoSearch.value = "";
    searchResults.classList.remove("active");
  }

  function renderSelectedAirports() {
    if (selectedAirports.length === 0) {
      selectedAirportsContainer.style.display = "none";
      return;
    }

    selectedAirportsContainer.style.display = "block";

    // Оптимизация: используем DocumentFragment
    const fragment = document.createDocumentFragment();
    selectedAirports.forEach((airport) => {
      const tag = document.createElement("div");
      tag.className = "airport-tag";
      tag.innerHTML = `
                <span class="airport-tag-name">
                    <strong>${airport.icao}</strong> - ${airport.name}
                </span>
                <button class="airport-tag-remove" data-icao="${airport.icao}" title="Удалить">×</button>
            `;
      fragment.appendChild(tag);
    });

    airportsList.innerHTML = "";
    airportsList.appendChild(fragment);
  }

  // Event delegation для удаления аэропортов (оптимизация)
  airportsList.addEventListener("click", function (e) {
    if (e.target.classList.contains("airport-tag-remove")) {
      const icao = e.target.getAttribute("data-icao");
      removeAirport(icao);
    }
  });

  function removeAirport(icao) {
    selectedAirports = selectedAirports.filter((a) => a.icao !== icao);
    renderSelectedAirports();
  }

  // ============================================
  // Конвертация времени UTC <-> Местное
  // ============================================

  // Обработчик переключения времени
  if (localTimeToggle) {
    localTimeToggle.addEventListener("change", function () {
      useLocalTime = this.checked;
      localStorage.setItem("useLocalTime", useLocalTime);
      updateAllTimeDisplays();
    });
  }

  function parseTimestamp(timestamp) {
    // Парсит timestamp формата YYYYMMDDHHmm в Date объект UTC
    const year = parseInt(timestamp.substring(0, 4));
    const month = parseInt(timestamp.substring(4, 6)) - 1; // месяцы от 0
    const day = parseInt(timestamp.substring(6, 8));
    const hour = parseInt(timestamp.substring(8, 10));
    const minute = parseInt(timestamp.substring(10, 12));

    return new Date(Date.UTC(year, month, day, hour, minute));
  }

  function formatTime(timestamp, isLocal = false) {
    // Форматирует timestamp в строку
    const date = parseTimestamp(timestamp);

    if (isLocal) {
      // Местное время
      const day = String(date.getDate()).padStart(2, "0");
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const year = date.getFullYear();
      const hour = String(date.getHours()).padStart(2, "0");
      const minute = String(date.getMinutes()).padStart(2, "0");

      // Получаем часовой пояс
      const tzOffset = -date.getTimezoneOffset();
      const tzHours = Math.floor(Math.abs(tzOffset) / 60);
      const tzMinutes = Math.abs(tzOffset) % 60;
      const tzSign = tzOffset >= 0 ? "+" : "-";
      const tzString = `UTC${tzSign}${String(tzHours).padStart(2, "0")}:${String(tzMinutes).padStart(2, "0")}`;

      return `${day}.${month}.${year} ${hour}:${minute} (${tzString})`;
    } else {
      // UTC время
      const day = String(date.getUTCDate()).padStart(2, "0");
      const month = String(date.getUTCMonth() + 1).padStart(2, "0");
      const year = date.getUTCFullYear();
      const hour = String(date.getUTCHours()).padStart(2, "0");
      const minute = String(date.getUTCMinutes()).padStart(2, "0");

      return `${day}.${month}.${year} ${hour}:${minute}`;
    }
  }

  function updateAllTimeDisplays() {
    // Обновляет все временные метки на странице
    document.querySelectorAll("[data-timestamp]").forEach((element) => {
      const timestamp = element.getAttribute("data-timestamp");
      element.textContent = formatTime(timestamp, useLocalTime);
    });
  }

  function fetchMetarTaf() {
    if (selectedAirports.length === 0) {
      showError("Пожалуйста, выберите хотя бы один аэропорт из списка");
      return;
    }

    // Оптимизация: отменяем предыдущий запрос если он еще выполняется
    if (currentFetchController) {
      currentFetchController.abort();
    }
    currentFetchController = new AbortController();

    hideError();
    hideResult();
    tafSection.style.display = "none";
    tafDecodedSection.style.display = "none";
    fetchInfo.style.display = "none";
    metarHistorySection.style.display = "none";
    tafHistorySection.style.display = "none";
    showLoading();

    // Загружаем данные для всех выбранных аэропортов параллельно
    const fetchPromises = selectedAirports.map((airport) => {
      // Проверяем кеш
      const cacheKey = `metar_${airport.icao}`;
      const cached = dataCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log(`Используем кешированные данные для ${airport.icao}`);
        return Promise.resolve({ airport, data: cached.data });
      }

      // Загружаем с сервера
      return fetch("/fetch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ icao: airport.icao }),
        signal: currentFetchController.signal,
      })
        .then((response) => response.json())
        .then((data) => {
          // Сохраняем в кеш
          dataCache.set(cacheKey, {
            data: data,
            timestamp: Date.now(),
          });
          return { airport, data };
        });
    });

    Promise.all(fetchPromises)
      .then((results) => {
        hideLoading();
        currentFetchController = null;
        displayMultipleAirportsResults(results);
        showAutoRefreshPanel();
      })
      .catch((error) => {
        hideLoading();
        currentFetchController = null;
        // Не показываем ошибку если запрос был отменен
        if (error.name !== "AbortError") {
          showError("Ошибка соединения с сервером: " + error.message);
        }
      });
  }

  function displayMultipleAirportsResults(results) {
    // Очищаем старые результаты
    resultSection.innerHTML = "";

    if (results.length === 0) {
      showError("Нет данных для отображения");
      return;
    }

    // Создаем заголовок
    const header = document.createElement("h2");
    header.textContent = `METAR для ${results.length} аэропорт(а/ов)`;
    resultSection.appendChild(header);

    // Инициализируем lastMetarRaw если нужно
    if (!lastMetarRaw || typeof lastMetarRaw === "string") {
      lastMetarRaw = {};
    }

    // Создаем карточки для каждого аэропорта
    results.forEach(({ airport, data }) => {
      if (!data.success) {
        console.error(`Ошибка для ${airport.icao}:`, data.error);
        return;
      }

      // Сохраняем METAR для отслеживания изменений
      if (data.metar) {
        const key = `metar_${airport.icao}`;
        lastMetarRaw[key] = data.metar;
      }

      const card = createAirportCard(airport, data);
      resultSection.appendChild(card);
    });

    resultSection.style.display = "block";
  }

  function createAirportCard(airport, data) {
    const card = document.createElement("div");
    card.className = "airport-card-v2";
    card.setAttribute("data-icao", airport.icao);

    const name = data.airport_name || airport.name || airport.icao;
    const icao = airport.icao;
    const rh = airport.runway_headings || data.runway_headings || "";

    const runwayHtml = rh
      ? `<div class="card-runway"><strong>Курсы ВПП:</strong> ${formatRunwayHeadingsDetailed(rh)}</div>`
      : "";

    card.innerHTML = `
      <div class="card-title-bar">${name} (${icao})</div>
      <div class="card-subheader">
        <div class="card-subheader-left">
          <div class="card-station-line"><strong>${name} (${icao})</strong></div>
          <div><a href="/archive?icao=${icao}" class="archive-link">Архив погоды</a></div>
          ${runwayHtml}
        </div>
      </div>
      <div class="card-body-grid">
        <div class="card-metar-col">
          <div class="card-col-title">Фактическая погода</div>
          <div id="metar-fields-${icao}" class="card-fields">
            <div class="mf-loading">Загрузка...</div>
          </div>
        </div>
        <div class="card-taf-col">
          <div class="card-col-title">Прогноз погоды</div>
          <div id="taf-fields-${icao}" class="card-fields">
            ${data.taf ? '<div class="mf-loading">Загрузка...</div>' : '<div class="mf-empty">Нет данных</div>'}
          </div>
        </div>
      </div>
      <div class="card-raw-footer">
        <div class="card-raw-block">
          <span class="card-raw-label">METAR</span>
          <code>${data.metar || "Нет данных"}</code>
        </div>
        ${data.taf ? `<div class="card-raw-block">
          <span class="card-raw-label">TAF</span>
          <code>${data.taf}</code>
        </div>` : ""}
      </div>
    `;

    // Декодируем METAR
    if (data.metar) {
      fetch("/decode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metar: data.metar }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.success) {
            const el = document.getElementById(`metar-fields-${icao}`);
            if (el) el.innerHTML = renderMetarFields(d.decoded);
          }
        })
        .catch((e) => console.error("Ошибка декодирования METAR:", e));
    } else {
      const el = document.getElementById(`metar-fields-${icao}`);
      if (el) el.innerHTML = '<div class="mf-empty">Нет данных</div>';
    }

    // Декодируем TAF
    if (data.taf) {
      fetch("/decode-taf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taf: data.taf }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.success) {
            const el = document.getElementById(`taf-fields-${icao}`);
            if (el) el.innerHTML = renderTafFields(d.decoded);
          }
        })
        .catch((e) => console.error("Ошибка декодирования TAF:", e));
    }

    // История METAR/TAF ниже карточки
    const metarHistoryContainer = document.createElement("div");
    const tafHistoryContainer = document.createElement("div");
    const historyWrapper = document.createElement("div");
    historyWrapper.className = "card-history-wrapper";
    historyWrapper.appendChild(metarHistoryContainer);
    historyWrapper.appendChild(tafHistoryContainer);
    card.appendChild(historyWrapper);

    loadMetarHistoryForCard(icao, metarHistoryContainer);
    loadTafHistoryForCard(icao, tafHistoryContainer);

    return card;
  }

  function loadMetarHistoryForCard(icao, container) {
    fetch("/metar-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ icao: icao, hours: 12 }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.success || !data.history?.length) return;

        const section = document.createElement("div");
        section.style.marginTop = "20px";

        // Заголовок с кнопкой принудительного обновления
        section.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;
                            margin-bottom:10px;">
                    <h3 style="color:var(--text-primary);margin:0;">
                        История METAR (последние 3)
                    </h3>
                    <button onclick="refreshHistory('${icao}', this)"
                            style="font-size:12px;padding:4px 10px;
                                   background:var(--primary-color);color:white;
                                   border:none;border-radius:6px;cursor:pointer;">
                        Обновить
                    </button>
                </div>
            `;

        const limited = data.history.slice(0, 3);
        let html =
          '<table class="metar-history-table"><thead><tr>' +
          '<th style="width:160px;">Время</th>' +
          "<th>Код</th>" +
          '<th style="width:40px;"></th>' +
          "</tr></thead><tbody>";

        limited.forEach((item, idx) => {
          const uid = `mh-${icao}-${idx}`;
          const time = formatTime(item.timestamp, useLocalTime);
          html += `<tr class="metar-history-row" data-index="${uid}">
                           <td class="metar-time">
                             <span data-timestamp="${item.timestamp}">${time}</span>
                           </td>
                           <td class="metar-raw"><code>${item.raw}</code></td>
                           <td class="metar-arrow">
                             <span class="toggle-icon">&#9654;</span>
                           </td>
                         </tr>
                         <tr class="metar-history-details" id="${uid}"
                             style="display:none;">
                           <td colspan="3" class="metar-decoded">
                             <pre>${item.pretty}</pre>
                           </td>
                         </tr>`;
        });

        html += "</tbody></table>";

        const card = document.createElement("div");
        card.className = "result-card";
        card.innerHTML = html;
        section.appendChild(card);
        container.appendChild(section);

        // Обработчики раскрытия строк
        card.querySelectorAll(".metar-history-row").forEach((row) => {
          row.addEventListener("click", function () {
            const det = document.getElementById(this.dataset.index);
            const ico = this.querySelector(".toggle-icon");
            const open = det.style.display === "none";
            det.style.display = open ? "table-row" : "none";
            ico.innerHTML = open ? "&#9660;" : "&#9654;";
          });
          row.style.cursor = "pointer";
        });
      })
      .catch((err) => console.error(`Ошибка истории ${icao}:`, err));
  }

  // Принудительное обновление — инвалидируем кэш через новый параметр
  function refreshHistory(icao, btn) {
    btn.textContent = "...";
    btn.disabled = true;

    fetch("/metar-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ icao: icao, hours: 12, force: true }),
    })
      .then((r) => r.json())
      .then(() => {
        btn.textContent = "Готово";
        setTimeout(() => {
          btn.textContent = "Обновить";
          btn.disabled = false;
        }, 1500);
      })
      .catch(() => {
        btn.textContent = "Ошибка";
        btn.disabled = false;
      });
  }
  function loadTafHistoryForCard(icao, container) {
    fetch("/taf-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ icao: icao, hours: 48 }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success && data.history && data.history.length > 0) {
          const historySection = document.createElement("div");
          historySection.style.marginTop = "20px";
          historySection.innerHTML = `<h3 style="margin-bottom: 10px; color: var(--text-primary);">История TAF (последние 3)</h3>`;

          const limitedHistory = data.history.slice(0, 3);

          let html = '<table class="taf-history-table">';
          html += "<thead><tr>";
          html += '<th style="width: 180px;">Время выпуска</th>';
          html += "<th>TAF код</th>";
          html += '<th style="width: 40px;"></th>';
          html += "</tr></thead>";
          html += "<tbody>";

          limitedHistory.forEach((item, index) => {
            const timestamp = item.timestamp;
            const formattedTime = formatTime(timestamp, useLocalTime);

            const uniqueId = `taf-${icao}-${index}`;

            // Извлекаем период действия из декодированного TAF
            let validPeriod = "";
            if (item.decoded && item.decoded.valid_period) {
              const vp = item.decoded.valid_period;
              validPeriod = ` (действует: ${vp.from.day} ${String(vp.from.hour).padStart(2, "0")}:00 - ${vp.to.day} ${String(vp.to.hour).padStart(2, "0")}:00)`;
            }

            html += `<tr class="taf-history-row" data-index="${uniqueId}">`;
            html += `<td class="taf-time"><span data-timestamp="${timestamp}">${formattedTime}</span>${validPeriod}</td>`;
            html += `<td class="taf-raw"><code>${item.raw}</code></td>`;
            html += `<td class="taf-arrow"><span class="toggle-icon">▶</span></td>`;
            html += "</tr>";

            html += `<tr class="taf-history-details" id="${uniqueId}" style="display: none;">`;
            html += '<td colspan="3" class="taf-decoded">';
            html += `<pre>${item.pretty}</pre>`;
            html += "</td></tr>";
          });

          html += "</tbody></table>";

          const tableContainer = document.createElement("div");
          tableContainer.className = "result-card";
          tableContainer.innerHTML = html;
          historySection.appendChild(tableContainer);
          container.appendChild(historySection);

          // Добавляем обработчики кликов
          tableContainer.querySelectorAll(".taf-history-row").forEach((row) => {
            row.addEventListener("click", function () {
              const index = this.getAttribute("data-index");
              const details = document.getElementById(index);
              const icon = this.querySelector(".toggle-icon");

              if (details.style.display === "none") {
                details.style.display = "table-row";
                icon.textContent = "▼";
              } else {
                details.style.display = "none";
                icon.textContent = "▶";
              }
            });
            row.style.cursor = "pointer";
          });
        }
      })
      .catch((error) => {
        console.error(`Ошибка загрузки истории TAF для ${icao}:`, error);
      });
  }

  function formatRunwayHeadings(runwayStr) {
    if (!runwayStr) return "Нет данных";

    // Format: "06:058°,24:238°"
    const runways = runwayStr.split(",");
    return runways
      .map((rw) => {
        const [num, heading] = rw.split(":");
        return `ВПП ${num}: ${heading}`;
      })
      .join(" | ");
  }

  // ---- Вспомогательные функции рендера карточки ----

  function pad2(n) { return String(n).padStart(2, "0"); }

  function mfRow(label, value) {
    return `<div class="mf-row">
      <span class="mf-label">${label}</span>
      <span class="mf-value">${value}</span>
    </div>`;
  }

  function translateWxFull(w) {
    const WX = {
      DZ: "морось", RA: "дождь", SN: "снег", SG: "снежные зёрна",
      IC: "ледяные кристаллы", PL: "ледяной дождь", GR: "град",
      GS: "мелкий град/крупа", UP: "неизвестные осадки",
      BR: "дымка", FG: "туман", FU: "дым", VA: "вулканический пепел",
      DU: "пыль", SA: "песок", HZ: "мгла", SQ: "шквалы",
      FC: "смерч", SS: "песчаная буря", DS: "пыльная буря",
      SHRA: "ливневой дождь", SHSN: "ливневой снег",
      SHGR: "ливневой град", SHGS: "ливневая крупа",
      SNRA: "снег с дождём", RASN: "дождь со снегом",
      SHSNRA: "ливневой снег с дождём",
    };
    const INSTR = {
      дождь: "дождём", снег: "снегом", морось: "моросью",
      град: "градом", туман: "туманом", дымка: "дымкой",
    };
    const INT = { "-": "слабый", "+": "сильный" };
    const DESC = {
      MI: "местами", PR: "частичный", BC: "область", DR: "низовой",
      BL: "метель", SH: "ливневый", FZ: "переохлаждённый", VC: "в окрестностях",
    };

    const combo = (w.desc || "") + (w.phenomena || "");
    let base = WX[combo] || WX[w.phenomena] || w.phenomena || "";
    const intStr = INT[w.intensity] || "";

    if (w.desc === "TS") {
      const baseInstr = INSTR[base] || base;
      const tsInt = w.intensity === "+" ? "сильная" : w.intensity === "-" ? "слабая" : "";
      return [tsInt, "гроза", base ? `с ${baseInstr}` : ""].filter(Boolean).join(" ");
    }
    if (w.desc && !WX[combo]) {
      base = [DESC[w.desc] || w.desc, base].filter(Boolean).join(" ");
    }
    return [intStr, base].filter(Boolean).join(" ");
  }

  function renderForecastGroupFields(fc) {
    if (!fc) return "";
    const CLOUD_FULL = {
      SKC: "ясно", CLR: "ясно (авто)", NSC: "нет значимой облачности",
      FEW: "незначительная (0–2 балла)", SCT: "рассеянная (3–5 баллов)",
      BKN: "значительная (6–9 баллов)", OVC: "сплошная (10 баллов)",
      VV: "вертикальная видимость",
    };
    let html = "";
    if (fc.wind) {
      const w = fc.wind;
      const dir = w.dir === "VRB" ? "Переменный" : `${w.dir}°`;
      const unit = w.unit === "KT" ? "уз" : w.unit === "MPS" ? "м/с" : "км/ч";
      let ws = `${dir} ${w.speed} ${unit}`;
      if (w.gust) ws += `, порывы до ${w.gust} ${unit}`;
      html += mfRow("Ветер:", ws);
    }
    if (fc.visibility) {
      const vis = fc.visibility;
      let vs;
      if (vis.cavok) vs = "CAVOK";
      else if (vis.meters >= 10000) vs = "10 км и более";
      else if (vis.meters >= 1000) vs = `${(vis.meters / 1000).toFixed(1)} км`;
      else vs = `${vis.meters} м`;
      html += mfRow("Видимость:", vs);
    }
    if (fc.weather && fc.weather.length > 0) {
      html += mfRow("Явления:", fc.weather.map(translateWxFull).join("; "));
    }
    if (fc.clouds && fc.clouds.length > 0) {
      const lines = fc.clouds.map((c) => {
        let s = CLOUD_FULL[c.type] || c.type;
        const h = c.height_m || c.height_ft;
        if (h) s += ` на ${h} м`;
        if (c.qual === "CB") s += " кучево-дождевая";
        else if (c.qual === "TCU") s += " мощно-кучевая";
        return s;
      });
      html += `<div class="mf-row mf-multiline">
        <span class="mf-label">Облачность:</span>
        <span class="mf-value">${lines.join(";<br>")}</span>
      </div>`;
    }
    return html;
  }

  function renderMetarFields(decoded) {
    const MONTHS_RU = ["января","февраля","марта","апреля","мая","июня",
      "июля","августа","сентября","октября","ноября","декабря"];
    const CLOUD_FULL = {
      SKC: "ясно", CLR: "ясно (авто)", NSC: "нет значимой облачности",
      FEW: "незначительная (0–2 балла)", SCT: "рассеянная (3–5 баллов)",
      BKN: "значительная (6–9 баллов)", OVC: "сплошная (10 баллов)",
      VV: "вертикальная видимость",
    };
    const RC_TYPE = {
      "0": "чистая и сухая", "1": "влажная", "2": "мокрая или лужи",
      "3": "изморозь/иней", "4": "сухой снег", "5": "мокрый снег",
      "6": "слякоть", "7": "лёд", "8": "уплотнённый снег",
      "9": "замёрзшие колеи", "/": "тип не определён",
    };
    const RC_EXTENT = {
      "1": "10% и менее", "2": "11–25%", "5": "26–50%",
      "9": "51–100%", "/": "не определена", NR: "не сообщается",
    };
    const TREND_LABELS = {
      NOSIG: "без существенных изменений",
      TEMPO: "временами", BECMG: "ожидается изменение",
    };

    let html = "";
    const now = new Date();

    if (decoded.time) {
      const t = decoded.time;
      html += mfRow("Дата:", `${t.day} ${MONTHS_RU[now.getUTCMonth()]} ${now.getUTCFullYear()}`);
      html += mfRow("Время:", `${pad2(t.hour)}:${pad2(t.minute)} UTC`);
    }
    if (decoded.auto) html += mfRow("", "Автоматическое наблюдение");
    if (decoded.nil) { html += mfRow("", "Отчёт NIL (данные отсутствуют)"); return html; }

    if (decoded.wind) {
      const w = decoded.wind;
      const dir = w.dir === "VRB" ? "Переменный" : `${w.dir}°`;
      const unit = w.unit === "KT" ? "уз" : w.unit === "MPS" ? "м/с" : "км/ч";
      let ws = `${dir}–${w.speed} ${unit}`;
      if (w.gust) ws += `, порывы до ${w.gust} ${unit}`;
      if (decoded.wind_var) ws += ` (${decoded.wind_var.from}°–${decoded.wind_var.to}°)`;
      html += mfRow("Ветер:", ws);
    }

    if (decoded.visibility) {
      const vis = decoded.visibility;
      let vs;
      if (vis.cavok) vs = "CAVOK";
      else if (vis.meters >= 10000) vs = "10 км и более";
      else if (vis.meters >= 1000) vs = `${(vis.meters / 1000).toFixed(1)} км`;
      else vs = `${vis.meters} м`;
      html += mfRow("Видимость:", vs);
    }

    if (decoded.runway_vis && decoded.runway_vis.length > 0) {
      decoded.runway_vis.forEach((r) => {
        let s = r.min.replace("P", ">").replace("M", "<");
        if (r.max) s += `–${r.max.replace("P", ">")}`;
        const trend = { U: "растёт", D: "падает", N: "без изм." }[r.trend] || "";
        html += mfRow(`RVR ВПП ${r.runway}:`, `${s} м${trend ? ` (${trend})` : ""}`);
      });
    }

    if (decoded.weather && decoded.weather.length > 0) {
      html += mfRow("Явления:", decoded.weather.map(translateWxFull).join("; "));
    }

    if (!(decoded.visibility && decoded.visibility.cavok) && decoded.clouds && decoded.clouds.length > 0) {
      const lines = decoded.clouds.map((c) => {
        let s = CLOUD_FULL[c.type] || c.type;
        if (c.height_ft) s += ` на ${c.height_ft} м`;
        if (c.qual === "CB") s += " кучево-дождевая";
        else if (c.qual === "TCU") s += " мощно-кучевая";
        return s;
      });
      html += `<div class="mf-row mf-multiline">
        <span class="mf-label">Облачность:</span>
        <span class="mf-value">${lines.join(";<br>")}</span>
      </div>`;
    }

    if (decoded.temp_c != null) {
      const sT = decoded.temp_c > 0 ? "+" : "";
      const sD = decoded.dewpoint_c > 0 ? "+" : "";
      html += mfRow("Температура:", `${sT}${decoded.temp_c}°C`);
      html += mfRow("Точка росы:", `${sD}${decoded.dewpoint_c}°C`);
      if (decoded.relative_humidity != null) {
        html += mfRow("Влажность:", `${decoded.relative_humidity} %`);
      }
    }

    if (decoded.altimeter_hpa) {
      html += mfRow("QNH:", `${decoded.altimeter_hpa} гПа`);
    }

    if (decoded.runway_condition && decoded.runway_condition.length > 0) {
      html += `<div class="mf-section-header">Состояние ВПП:</div>`;
      decoded.runway_condition.forEach((rc) => {
        const type = RC_TYPE[rc.type] || rc.type;
        const ext = RC_EXTENT[rc.extent] || rc.extent;
        let desc = `ВПП ${rc.runway}: ${type}`;
        if (ext) desc += `, покрытие ${ext}`;
        if (rc.depth && rc.depth !== "//" && rc.depth !== "00") desc += `, толщина ${rc.depth} мм`;
        if (rc.friction && rc.friction !== "//") {
          const fr = parseInt(rc.friction);
          desc += fr >= 95 ? `, сцепление 0.${rc.friction}+` : `, коэффициент сцепления 0.${rc.friction}`;
        }
        html += `<div class="mf-row mf-indent mf-multiline"><span class="mf-value">${desc}</span></div>`;
      });
    }

    if (decoded.trends && decoded.trends.length > 0) {
      html += mfRow("Прогноз:", TREND_LABELS[decoded.trends[0].type] || decoded.trends[0].type);
    }

    if (decoded.remarks) {
      const qfeMatch = decoded.remarks.match(/QFE(\d+)/);
      if (qfeMatch) html += mfRow("Давление QFE:", `${qfeMatch[1]} мм.рт.ст`);
    }

    return html || '<div class="mf-empty">Нет данных</div>';
  }

  function renderTafFields(decoded) {
    if (!decoded || decoded.error) {
      return `<div class="mf-empty">${decoded ? decoded.error : "Нет данных"}</div>`;
    }
    const MONTHS_RU = ["января","февраля","марта","апреля","мая","июня",
      "июля","августа","сентября","октября","ноября","декабря"];
    const CHANGE_LABELS = {
      TEMPO: "ВРЕМЕНАМИ", BECMG: "ИЗМЕНЕНИЯ",
      PROB30: "ВЕРОЯТНОСТЬ 30%", PROB40: "ВЕРОЯТНОСТЬ 40%",
      "PROB30 TEMPO": "ВЕРОЯТНОСТЬ 30% ВРЕМЕНАМИ",
      "PROB40 TEMPO": "ВЕРОЯТНОСТЬ 40% ВРЕМЕНАМИ",
      FM: "С МОМЕНТА",
    };

    const now = new Date();
    const month = MONTHS_RU[now.getUTCMonth()];
    const year = now.getUTCFullYear();
    let html = "";

    if (decoded.issue_time) {
      const it = decoded.issue_time;
      html += `<div class="mf-row mf-taf-issue">Прогноз получен: ${it.day} ${month} ${year}, в ${pad2(it.hour)}:${pad2(it.minute)} UTC</div>`;
    }
    if (decoded.valid_period) {
      const vf = decoded.valid_period.from;
      const vt = decoded.valid_period.to;
      html += `<div class="mf-row mf-taf-valid">Действует: с ${vf.day} ${month} ${pad2(vf.hour)}.00 до ${vt.day} ${month} ${pad2(vt.hour)}.00 UTC</div>`;
    }
    if (decoded.amendment) html += `<div class="mf-row mf-taf-valid">Исправленный прогноз (AMD)</div>`;

    html += renderForecastGroupFields(decoded.base_forecast);

    if (decoded.temperatures) {
      const tp = decoded.temperatures;
      html += mfRow("Макс. температура:", `${tp.max_temp > 0 ? "+" : ""}${tp.max_temp}°C в ${tp.max_time.day} ${pad2(tp.max_time.hour)}:00 UTC`);
      html += mfRow("Мин. температура:", `${tp.min_temp > 0 ? "+" : ""}${tp.min_temp}°C в ${tp.min_time.day} ${pad2(tp.min_time.hour)}:00 UTC`);
    }

    if (decoded.change_groups && decoded.change_groups.length > 0) {
      decoded.change_groups.forEach((group) => {
        const label = CHANGE_LABELS[group.type] || group.type;
        let periodStr = "";
        if (group.type === "FM" && group.time) {
          const t = group.time;
          periodStr = ` ${t.day} ${month} ${pad2(t.hour)}:${pad2(t.minute)} UTC`;
        } else if (group.time_period) {
          const tp = group.time_period;
          periodStr = ` ${tp.from.day} ${month} с ${pad2(tp.from.hour)}.00 до ${tp.to.day} ${month} ${pad2(tp.to.hour)}.00 UTC`;
        }
        html += `<div class="mf-change-header">${label}${periodStr}</div>`;
        html += renderForecastGroupFields(group.forecast);
      });
    }

    return html || '<div class="mf-empty">Нет данных</div>';
  }

  function formatRunwayHeadingsDetailed(runwayStr) {
    if (!runwayStr) return "";
    return runwayStr.split(",").map((rw) => {
      const [num, heading] = rw.split(":");
      return `<span class="runway-item">ВПП&nbsp;${num.trim()}: ${heading ? heading.trim() : "—"}</span>`;
    }).join(" | ");
  }

  function clearAll() {
    // Останавливаем автообновление если включено
    if (autoRefreshToggle && autoRefreshToggle.checked) {
      autoRefreshToggle.checked = false;
      stopAutoRefresh();
    }

    // Скрываем панель автообновления
    if (autoRefreshPanel) {
      autoRefreshPanel.style.display = "none";
    }

    // Сбрасываем данные
    icaoSearch.value = "";
    selectedAirports = [];
    renderSelectedAirports();
    hideResult();
    hideError();
    tafSection.style.display = "none";
    tafDecodedSection.style.display = "none";
    fetchInfo.style.display = "none";
    metarHistorySection.style.display = "none";
    tafHistorySection.style.display = "none";
    searchResults.classList.remove("active");
    resultSection.innerHTML = "";
    lastMetarRaw = {};
    icaoSearch.focus();
  }

  function showLoading() {
    loading.style.display = "block";
  }

  function hideLoading() {
    loading.style.display = "none";
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = "block";
  }

  function hideError() {
    errorMessage.style.display = "none";
  }

  function hideResult() {
    resultSection.style.display = "none";
  }

  // ============================================
  // Автообновление METAR (Оперативный режим)
  // ============================================
  const autoRefreshToggle = document.getElementById("auto-refresh-toggle");
  const refreshTimer = document.getElementById("refresh-timer");
  const autoRefreshPanel = document.getElementById("auto-refresh-panel");

  const REFRESH_INTERVAL_SECONDS = 600; // Фиксированный интервал 10 минут

  let autoRefreshInterval = null;
  let countdownInterval = null;
  let remainingSeconds = 0;
  let lastMetarRaw = null; // Для отслеживания изменений

  // Показываем панель автообновления когда загружен METAR
  function showAutoRefreshPanel() {
    autoRefreshPanel.style.display = "block";
  }

  // Обработчик включения/выключения автообновления
  autoRefreshToggle.addEventListener("change", function () {
    if (this.checked) {
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  });

  function startAutoRefresh() {
    if (selectedAirports.length === 0) {
      autoRefreshToggle.checked = false;
      showError("Сначала выберите хотя бы один аэропорт");
      return;
    }

    remainingSeconds = REFRESH_INTERVAL_SECONDS;

    // Обновляем таймер каждую секунду
    updateCountdown();
    countdownInterval = setInterval(updateCountdown, 1000);

    // Выполняем обновление по интервалу
    autoRefreshInterval = setInterval(() => {
      performAutoRefresh();
    }, REFRESH_INTERVAL_SECONDS * 1000);

    console.log(
      `Автообновление включено для ${selectedAirports.length} аэропорт(а/ов): каждые ${REFRESH_INTERVAL_SECONDS} секунд (10 минут)`,
    );
  }

  function stopAutoRefresh() {
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }

    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }

    refreshTimer.innerHTML = "⏸ Остановлено";
    console.log("Автообновление остановлено");
  }

  function updateCountdown() {
    if (remainingSeconds <= 0) {
      remainingSeconds = REFRESH_INTERVAL_SECONDS;
    }

    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    const timeString = `${minutes}:${String(seconds).padStart(2, "0")}`;

    refreshTimer.innerHTML = `🔄 Обновление через: <strong>${timeString}</strong>`;
    remainingSeconds--;
  }

  function performAutoRefresh() {
    if (selectedAirports.length === 0) {
      stopAutoRefresh();
      autoRefreshToggle.checked = false;
      return;
    }

    console.log(
      `Автообновление для ${selectedAirports.length} аэропорт(а/ов)...`,
    );

    // Показываем индикатор без скрытия контента
    showRefreshIndicator();

    // Загружаем данные для всех аэропортов
    const fetchPromises = selectedAirports.map((airport) =>
      fetch("/fetch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ icao: airport.icao }),
      })
        .then((response) => response.json())
        .then((data) => ({ airport, data })),
    );

    Promise.all(fetchPromises)
      .then((results) => {
        hideRefreshIndicator();

        // Проверяем, изменились ли какие-то METAR
        let hasChanges = false;
        results.forEach(({ airport, data }) => {
          if (data.success && data.metar) {
            const key = `metar_${airport.icao}`;
            if (!lastMetarRaw) lastMetarRaw = {};

            if (lastMetarRaw[key] !== data.metar) {
              hasChanges = true;
              lastMetarRaw[key] = data.metar;
              console.log(`Обнаружен новый METAR для ${airport.icao}`);
            }
          }
        });

        if (hasChanges) {
          showNewMetarNotification();
          // Обновляем отображение
          displayMultipleAirportsResults(results);
        } else {
          console.log("METAR не изменились");
          showNoChangeNotification();
        }

        // Сбрасываем таймер
        remainingSeconds = REFRESH_INTERVAL_SECONDS;
      })
      .catch((error) => {
        hideRefreshIndicator();
        console.error("Ошибка автообновления:", error);

        // Сбрасываем таймер даже при ошибке
        remainingSeconds = REFRESH_INTERVAL_SECONDS;
      });
  }

  function showRefreshIndicator() {
    // Создаем индикатор если его нет
    let indicator = document.getElementById("refresh-indicator");
    if (!indicator) {
      indicator = document.createElement("div");
      indicator.id = "refresh-indicator";
      indicator.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 12px 20px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                z-index: 1000;
                display: flex;
                align-items: center;
                gap: 10px;
                font-size: 14px;
                font-weight: 500;
            `;
      indicator.innerHTML = `
                <div class="spinner" style="width: 16px; height: 16px; border-width: 2px;"></div>
                <span>Обновление данных...</span>
            `;
      document.body.appendChild(indicator);
    }
    indicator.style.display = "flex";
  }

  function hideRefreshIndicator() {
    const indicator = document.getElementById("refresh-indicator");
    if (indicator) {
      indicator.style.display = "none";
    }
  }

  function showNewMetarNotification() {
    showNotification("✅ Получен новый METAR!", "success");
  }

  function showNoChangeNotification() {
    showNotification("ℹ️ METAR не изменился", "info");
  }

  function showNotification(message, type = "info") {
    // Создаем уведомление
    const notification = document.createElement("div");
    notification.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            background: ${type === "success" ? "linear-gradient(135deg, #11998e 0%, #38ef7d 100%)" : "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)"};
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1001;
            font-size: 14px;
            font-weight: 500;
            animation: slideIn 0.3s ease-out;
        `;
    notification.textContent = message;

    // Добавляем анимацию
    const style = document.createElement("style");
    style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(400px);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
        `;
    if (!document.getElementById("notification-animations")) {
      style.id = "notification-animations";
      document.head.appendChild(style);
    }

    document.body.appendChild(notification);

    // Удаляем через 3 секунды
    setTimeout(() => {
      notification.style.opacity = "0";
      notification.style.transform = "translateX(400px)";
      notification.style.transition = "all 0.3s ease-out";
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  // Модифицируем функцию fetchMetarTaf чтобы показывать панель
  const originalFetchMetarTaf = fetchMetarTaf;
  window.fetchMetarTaf = function () {
    // Останавливаем автообновление при ручном обновлении
    if (autoRefreshToggle.checked) {
      autoRefreshToggle.checked = false;
      stopAutoRefresh();
    }

    originalFetchMetarTaf();
  };
  fetchBtn.removeEventListener("click", fetchMetarTaf);
  fetchBtn.addEventListener("click", window.fetchMetarTaf);

  // Панель автообновления уже показывается в fetchMetarTaf через showAutoRefreshPanel()
});
