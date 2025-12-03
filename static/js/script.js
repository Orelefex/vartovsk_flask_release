// METAR Decoder JavaScript with Auto-fetch functionality
document.addEventListener('DOMContentLoaded', function() {
    // Elements
    const icaoSearch = document.getElementById('icao-search');
    const searchResults = document.getElementById('search-results');
    const fetchBtn = document.getElementById('fetch-btn');
    const clearBtn = document.getElementById('clear-btn');
    const loading = document.getElementById('loading');
    const errorMessage = document.getElementById('error-message');
    const resultSection = document.getElementById('result-section');
    const fetchInfo = document.getElementById('fetch-info');
    const tafSection = document.getElementById('taf-section');
    const tafDecodedSection = document.getElementById('taf-decoded-section');
    const metarHistorySection = document.getElementById('metar-history-section');
    const tafHistorySection = document.getElementById('taf-history-section');
    const archiveBtn = document.getElementById('archive-btn');

    let selectedAirports = []; // Массив выбранных аэропортов {icao, name, runway_headings}
    let searchTimeout;
    const selectedAirportsContainer = document.getElementById('selected-airports');
    const airportsList = document.getElementById('airports-list');

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
    const localTimeToggle = document.getElementById('local-time-toggle');
    let useLocalTime = localStorage.getItem('useLocalTime') === 'true' || false;

    // Устанавливаем начальное состояние чекбокса
    if (localTimeToggle) {
        localTimeToggle.checked = useLocalTime;
    }

    // Archive button click handler
    if (archiveBtn) {
        archiveBtn.addEventListener('click', function() {
            if (selectedIcao) {
                window.location.href = `/archive?icao=${selectedIcao}`;
            }
        });
    }

    // ICAO search with debounce
    icaoSearch.addEventListener('input', function() {
        const query = this.value.trim();

        clearTimeout(searchTimeout);

        if (query.length < 2) {
            searchResults.classList.remove('active');
            return;
        }

        searchTimeout = setTimeout(() => {
            searchAirports(query);
        }, 300);
    });

    // Close search results when clicking outside
    document.addEventListener('click', function(e) {
        if (!searchResults.contains(e.target) && e.target !== icaoSearch) {
            searchResults.classList.remove('active');
        }
    });

    // Event Listeners
    clearBtn.addEventListener('click', clearAll);
    fetchBtn.addEventListener('click', fetchMetarTaf);

    // Event delegation для результатов поиска (оптимизация)
    searchResults.addEventListener('click', function(e) {
        const item = e.target.closest('.search-result-item');
        if (item) {
            const airport = {
                icao: item.dataset.icao,
                name: item.dataset.name,
                runway_headings: item.dataset.runwayHeadings
            };
            selectAirport(airport);
        }
    });

    // Functions

    function searchAirports(query) {
        fetch(`/airports/search?q=${encodeURIComponent(query)}`)
            .then(response => response.json())
            .then(data => {
                displaySearchResults(data.results);
            })
            .catch(error => {
                console.error('Search error:', error);
            });
    }

    function displaySearchResults(results) {
        if (results.length === 0) {
            searchResults.classList.remove('active');
            return;
        }

        // Оптимизация: используем DocumentFragment для массовой вставки
        const fragment = document.createDocumentFragment();
        results.forEach(result => {
            const item = document.createElement('div');
            item.className = 'search-result-item';
            item.innerHTML = `
                <span class="search-result-icao">${result.icao}</span>
                <span class="search-result-name">${result.name}</span>
            `;
            // Сохраняем данные в data-атрибут для event delegation
            item.dataset.icao = result.icao;
            item.dataset.name = result.name;
            item.dataset.runwayHeadings = result.runway_headings || '';
            fragment.appendChild(item);
        });

        searchResults.innerHTML = '';
        searchResults.appendChild(fragment);
        searchResults.classList.add('active');
    }

    function selectAirport(airport) {
        // Проверяем, не добавлен ли уже этот аэропорт
        if (selectedAirports.some(a => a.icao === airport.icao)) {
            showError(`Аэропорт ${airport.icao} уже добавлен`);
            searchResults.classList.remove('active');
            icaoSearch.value = '';
            return;
        }

        // Добавляем аэропорт в список
        selectedAirports.push({
            icao: airport.icao,
            name: airport.name,
            runway_headings: airport.runway_headings || ''
        });

        // Обновляем отображение
        renderSelectedAirports();

        // Очищаем поле поиска
        icaoSearch.value = '';
        searchResults.classList.remove('active');
    }

    function renderSelectedAirports() {
        if (selectedAirports.length === 0) {
            selectedAirportsContainer.style.display = 'none';
            return;
        }

        selectedAirportsContainer.style.display = 'block';

        // Оптимизация: используем DocumentFragment
        const fragment = document.createDocumentFragment();
        selectedAirports.forEach(airport => {
            const tag = document.createElement('div');
            tag.className = 'airport-tag';
            tag.innerHTML = `
                <span class="airport-tag-name">
                    <strong>${airport.icao}</strong> - ${airport.name}
                </span>
                <button class="airport-tag-remove" data-icao="${airport.icao}" title="Удалить">×</button>
            `;
            fragment.appendChild(tag);
        });

        airportsList.innerHTML = '';
        airportsList.appendChild(fragment);
    }

    // Event delegation для удаления аэропортов (оптимизация)
    airportsList.addEventListener('click', function(e) {
        if (e.target.classList.contains('airport-tag-remove')) {
            const icao = e.target.getAttribute('data-icao');
            removeAirport(icao);
        }
    });

    function removeAirport(icao) {
        selectedAirports = selectedAirports.filter(a => a.icao !== icao);
        renderSelectedAirports();
    }

    // ============================================
    // Конвертация времени UTC <-> Местное
    // ============================================

    // Обработчик переключения времени
    if (localTimeToggle) {
        localTimeToggle.addEventListener('change', function() {
            useLocalTime = this.checked;
            localStorage.setItem('useLocalTime', useLocalTime);
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
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            const hour = String(date.getHours()).padStart(2, '0');
            const minute = String(date.getMinutes()).padStart(2, '0');

            // Получаем часовой пояс
            const tzOffset = -date.getTimezoneOffset();
            const tzHours = Math.floor(Math.abs(tzOffset) / 60);
            const tzMinutes = Math.abs(tzOffset) % 60;
            const tzSign = tzOffset >= 0 ? '+' : '-';
            const tzString = `UTC${tzSign}${String(tzHours).padStart(2, '0')}:${String(tzMinutes).padStart(2, '0')}`;

            return `${day}.${month}.${year} ${hour}:${minute} (${tzString})`;
        } else {
            // UTC время
            const day = String(date.getUTCDate()).padStart(2, '0');
            const month = String(date.getUTCMonth() + 1).padStart(2, '0');
            const year = date.getUTCFullYear();
            const hour = String(date.getUTCHours()).padStart(2, '0');
            const minute = String(date.getUTCMinutes()).padStart(2, '0');

            return `${day}.${month}.${year} ${hour}:${minute}`;
        }
    }

    function updateAllTimeDisplays() {
        // Обновляет все временные метки на странице
        document.querySelectorAll('[data-timestamp]').forEach(element => {
            const timestamp = element.getAttribute('data-timestamp');
            element.textContent = formatTime(timestamp, useLocalTime);
        });
    }

    function fetchMetarTaf() {
        if (selectedAirports.length === 0) {
            showError('Пожалуйста, выберите хотя бы один аэропорт из списка');
            return;
        }

        // Оптимизация: отменяем предыдущий запрос если он еще выполняется
        if (currentFetchController) {
            currentFetchController.abort();
        }
        currentFetchController = new AbortController();

        hideError();
        hideResult();
        tafSection.style.display = 'none';
        tafDecodedSection.style.display = 'none';
        fetchInfo.style.display = 'none';
        metarHistorySection.style.display = 'none';
        tafHistorySection.style.display = 'none';
        showLoading();

        // Загружаем данные для всех выбранных аэропортов параллельно
        const fetchPromises = selectedAirports.map(airport => {
            // Проверяем кеш
            const cacheKey = `metar_${airport.icao}`;
            const cached = dataCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
                console.log(`Используем кешированные данные для ${airport.icao}`);
                return Promise.resolve({ airport, data: cached.data });
            }

            // Загружаем с сервера
            return fetch('/fetch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ icao: airport.icao }),
                signal: currentFetchController.signal
            })
            .then(response => response.json())
            .then(data => {
                // Сохраняем в кеш
                dataCache.set(cacheKey, {
                    data: data,
                    timestamp: Date.now()
                });
                return { airport, data };
            });
        });

        Promise.all(fetchPromises)
            .then(results => {
                hideLoading();
                currentFetchController = null;
                displayMultipleAirportsResults(results);
                showAutoRefreshPanel();
            })
            .catch(error => {
                hideLoading();
                currentFetchController = null;
                // Не показываем ошибку если запрос был отменен
                if (error.name !== 'AbortError') {
                    showError('Ошибка соединения с сервером: ' + error.message);
                }
            });
    }

    function displayMultipleAirportsResults(results) {
        // Очищаем старые результаты
        resultSection.innerHTML = '';

        if (results.length === 0) {
            showError('Нет данных для отображения');
            return;
        }

        // Создаем заголовок
        const header = document.createElement('h2');
        header.textContent = `METAR для ${results.length} аэропорт(а/ов)`;
        resultSection.appendChild(header);

        // Инициализируем lastMetarRaw если нужно
        if (!lastMetarRaw || typeof lastMetarRaw === 'string') {
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

        resultSection.style.display = 'block';
    }

    function createAirportCard(airport, data) {
        const card = document.createElement('div');
        card.className = 'airport-card';
        card.setAttribute('data-icao', airport.icao);

        // Заголовок карточки
        const header = document.createElement('div');
        header.className = 'airport-card-header';
        header.innerHTML = `
            <div class="airport-card-title">
                <span class="airport-card-icao">${airport.icao}</span>
                <span>${airport.name}</span>
            </div>
        `;

        // Информация о ВПП если есть
        if (airport.runway_headings) {
            const runwayInfo = document.createElement('div');
            runwayInfo.style.cssText = 'font-size: 14px; color: var(--text-secondary); margin-top: 8px;';
            runwayInfo.innerHTML = `<strong>🛫 Курсы ВПП:</strong> ${formatRunwayHeadings(airport.runway_headings)}`;
            header.appendChild(runwayInfo);
        }

        card.appendChild(header);

        // Контент карточки
        const content = document.createElement('div');
        content.className = 'airport-card-content';

        // Создаем контейнеры для упорядоченного отображения
        const metarContainer = document.createElement('div');
        metarContainer.className = 'metar-container';
        metarContainer.style.order = '1';

        const tafContainer = document.createElement('div');
        tafContainer.className = 'taf-container';
        tafContainer.style.order = '2';

        const metarHistoryContainer = document.createElement('div');
        metarHistoryContainer.className = 'metar-history-container';
        metarHistoryContainer.style.order = '3';

        const tafHistoryContainer = document.createElement('div');
        tafHistoryContainer.className = 'taf-history-container';
        tafHistoryContainer.style.order = '4';

        content.style.display = 'flex';
        content.style.flexDirection = 'column';

        // METAR
        if (data.metar) {
            const metarSection = document.createElement('div');
            metarSection.style.marginBottom = '20px';

            fetch('/decode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ metar: data.metar })
            })
            .then(response => response.json())
            .then(decodeData => {
                if (decodeData.success) {
                    metarSection.innerHTML = renderMetarTable(decodeData.decoded, decodeData.pretty);

                    // Добавляем обработчик раскрытия
                    const metarRow = metarSection.querySelector('.metar-raw-row');
                    if (metarRow) {
                        metarRow.addEventListener('click', function() {
                            const details = metarSection.querySelector('.metar-details');
                            const icon = metarRow.querySelector('.toggle-icon');
                            if (details.style.display === 'none' || details.style.display === '') {
                                details.style.display = 'table-row';
                                icon.textContent = '▼';
                            } else {
                                details.style.display = 'none';
                                icon.textContent = '▶';
                            }
                        });
                        metarRow.style.cursor = 'pointer';
                    }
                }
            })
            .catch(error => {
                metarSection.innerHTML = `<p class="error-message">Ошибка декодирования METAR: ${error.message}</p>`;
            });

            metarContainer.appendChild(metarSection);
        }

        // TAF
        if (data.taf) {
            const tafSection = document.createElement('div');
            tafSection.style.marginTop = '20px';
            tafSection.innerHTML = `
                <h3 style="margin-bottom: 10px; color: var(--text-primary);">TAF - Текущий прогноз</h3>
                <div class="result-card">
                    <pre style="white-space: pre-wrap; word-wrap: break-word;">${data.taf}</pre>
                </div>
            `;

            // Декодируем TAF
            fetch('/decode-taf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taf: data.taf })
            })
            .then(response => response.json())
            .then(decodeData => {
                if (decodeData.success) {
                    const decodedDiv = document.createElement('div');
                    decodedDiv.className = 'result-card';
                    decodedDiv.style.marginTop = '10px';
                    decodedDiv.innerHTML = `<pre style="white-space: pre-wrap; word-wrap: break-word;">${decodeData.pretty}</pre>`;
                    tafSection.appendChild(decodedDiv);
                }
            })
            .catch(error => {
                console.error('Ошибка декодирования TAF:', error);
            });

            tafContainer.appendChild(tafSection);
        }

        // Добавляем контейнеры в правильном порядке
        content.appendChild(metarContainer);
        content.appendChild(tafContainer);
        content.appendChild(metarHistoryContainer);
        content.appendChild(tafHistoryContainer);

        card.appendChild(content);

        // Загружаем историю METAR (последние 3) в выделенный контейнер
        loadMetarHistoryForCard(airport.icao, metarHistoryContainer);

        // Загружаем историю TAF (последние 3) если доступна
        loadTafHistoryForCard(airport.icao, tafHistoryContainer);

        return card;
    }

    function loadMetarHistoryForCard(icao, container) {
        fetch('/metar-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ icao: icao, hours: 12 })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success && data.history && data.history.length > 0) {
                const historySection = document.createElement('div');
                historySection.style.marginTop = '20px';
                historySection.innerHTML = `<h3 style="margin-bottom: 10px; color: var(--text-primary);">История METAR (последние 3)</h3>`;

                const limitedHistory = data.history.slice(0, 3);

                let html = '<table class="metar-history-table">';
                html += '<thead><tr>';
                html += '<th style="width: 180px;">Время</th>';
                html += '<th>METAR/SPECI код</th>';
                html += '<th style="width: 40px;"></th>';
                html += '</tr></thead>';
                html += '<tbody>';

                limitedHistory.forEach((item, index) => {
                    const timestamp = item.timestamp;
                    const formattedTime = formatTime(timestamp, useLocalTime);

                    const uniqueId = `metar-${icao}-${index}`;

                    html += `<tr class="metar-history-row" data-index="${uniqueId}">`;
                    html += `<td class="metar-time"><span data-timestamp="${timestamp}">${formattedTime}</span></td>`;
                    html += `<td class="metar-raw"><code>${item.raw}</code></td>`;
                    html += `<td class="metar-arrow"><span class="toggle-icon">▶</span></td>`;
                    html += '</tr>';

                    html += `<tr class="metar-history-details" id="${uniqueId}" style="display: none;">`;
                    html += '<td colspan="3" class="metar-decoded">';
                    html += `<pre>${item.pretty}</pre>`;
                    html += '</td></tr>';
                });

                html += '</tbody></table>';

                const tableContainer = document.createElement('div');
                tableContainer.className = 'result-card';
                tableContainer.innerHTML = html;
                historySection.appendChild(tableContainer);
                container.appendChild(historySection);

                // Добавляем обработчики кликов
                tableContainer.querySelectorAll('.metar-history-row').forEach(row => {
                    row.addEventListener('click', function() {
                        const index = this.getAttribute('data-index');
                        const details = document.getElementById(index);
                        const icon = this.querySelector('.toggle-icon');

                        if (details.style.display === 'none') {
                            details.style.display = 'table-row';
                            icon.textContent = '▼';
                        } else {
                            details.style.display = 'none';
                            icon.textContent = '▶';
                        }
                    });
                    row.style.cursor = 'pointer';
                });
            }
        })
        .catch(error => {
            console.error(`Ошибка загрузки истории METAR для ${icao}:`, error);
        });
    }

    function loadTafHistoryForCard(icao, container) {
        fetch('/taf-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ icao: icao, hours: 48 })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success && data.history && data.history.length > 0) {
                const historySection = document.createElement('div');
                historySection.style.marginTop = '20px';
                historySection.innerHTML = `<h3 style="margin-bottom: 10px; color: var(--text-primary);">История TAF (последние 3)</h3>`;

                const limitedHistory = data.history.slice(0, 3);

                let html = '<table class="taf-history-table">';
                html += '<thead><tr>';
                html += '<th style="width: 180px;">Время выпуска</th>';
                html += '<th>TAF код</th>';
                html += '<th style="width: 40px;"></th>';
                html += '</tr></thead>';
                html += '<tbody>';

                limitedHistory.forEach((item, index) => {
                    const timestamp = item.timestamp;
                    const formattedTime = formatTime(timestamp, useLocalTime);

                    const uniqueId = `taf-${icao}-${index}`;

                    // Извлекаем период действия из декодированного TAF
                    let validPeriod = '';
                    if (item.decoded && item.decoded.valid_period) {
                        const vp = item.decoded.valid_period;
                        validPeriod = ` (действует: ${vp.from.day} ${String(vp.from.hour).padStart(2, '0')}:00 - ${vp.to.day} ${String(vp.to.hour).padStart(2, '0')}:00)`;
                    }

                    html += `<tr class="taf-history-row" data-index="${uniqueId}">`;
                    html += `<td class="taf-time"><span data-timestamp="${timestamp}">${formattedTime}</span>${validPeriod}</td>`;
                    html += `<td class="taf-raw"><code>${item.raw}</code></td>`;
                    html += `<td class="taf-arrow"><span class="toggle-icon">▶</span></td>`;
                    html += '</tr>';

                    html += `<tr class="taf-history-details" id="${uniqueId}" style="display: none;">`;
                    html += '<td colspan="3" class="taf-decoded">';
                    html += `<pre>${item.pretty}</pre>`;
                    html += '</td></tr>';
                });

                html += '</tbody></table>';

                const tableContainer = document.createElement('div');
                tableContainer.className = 'result-card';
                tableContainer.innerHTML = html;
                historySection.appendChild(tableContainer);
                container.appendChild(historySection);

                // Добавляем обработчики кликов
                tableContainer.querySelectorAll('.taf-history-row').forEach(row => {
                    row.addEventListener('click', function() {
                        const index = this.getAttribute('data-index');
                        const details = document.getElementById(index);
                        const icon = this.querySelector('.toggle-icon');

                        if (details.style.display === 'none') {
                            details.style.display = 'table-row';
                            icon.textContent = '▼';
                        } else {
                            details.style.display = 'none';
                            icon.textContent = '▶';
                        }
                    });
                    row.style.cursor = 'pointer';
                });
            }
        })
        .catch(error => {
            console.error(`Ошибка загрузки истории TAF для ${icao}:`, error);
        });
    }

    function formatRunwayHeadings(runwayStr) {
        if (!runwayStr) return 'Нет данных';

        // Format: "06:058°,24:238°"
        const runways = runwayStr.split(',');
        return runways.map(rw => {
            const [num, heading] = rw.split(':');
            return `ВПП ${num}: ${heading}`;
        }).join(' | ');
    }

    function renderMetarTable(decoded, prettyText) {
        let html = '<table class="metar-table">';
        html += '<thead><tr><th colspan="2" class="metar-header">';
        html += 'METAR код';
        html += '</th></tr></thead>';
        html += '<tbody>';

        // Исходный METAR код с стрелкой
        html += '<tr class="metar-raw-row">';
        html += '<td class="metar-arrow"><span class="toggle-icon">▶</span></td>';
        html += '<td class="metar-raw"><code>' + (decoded.raw || '') + '</code></td>';
        html += '</tr>';

        // Скрытая секция с полной расшифровкой
        html += '<tr class="metar-details" style="display: none;">';
        html += '<td colspan="2" class="metar-decoded">';
        html += '<pre>' + (prettyText || '') + '</pre>';
        html += '</td></tr>';

        html += '</tbody></table>';

        return html;
    }

    function clearAll() {
        // Останавливаем автообновление если включено
        if (autoRefreshToggle && autoRefreshToggle.checked) {
            autoRefreshToggle.checked = false;
            stopAutoRefresh();
        }

        // Скрываем панель автообновления
        if (autoRefreshPanel) {
            autoRefreshPanel.style.display = 'none';
        }

        // Сбрасываем данные
        icaoSearch.value = '';
        selectedAirports = [];
        renderSelectedAirports();
        hideResult();
        hideError();
        tafSection.style.display = 'none';
        tafDecodedSection.style.display = 'none';
        fetchInfo.style.display = 'none';
        metarHistorySection.style.display = 'none';
        tafHistorySection.style.display = 'none';
        searchResults.classList.remove('active');
        resultSection.innerHTML = '';
        lastMetarRaw = {};
        icaoSearch.focus();
    }

    function showLoading() {
        loading.style.display = 'block';
    }

    function hideLoading() {
        loading.style.display = 'none';
    }

    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
    }

    function hideError() {
        errorMessage.style.display = 'none';
    }

    function hideResult() {
        resultSection.style.display = 'none';
    }

    // ============================================
    // Автообновление METAR (Оперативный режим)
    // ============================================
    const autoRefreshToggle = document.getElementById('auto-refresh-toggle');
    const refreshTimer = document.getElementById('refresh-timer');
    const autoRefreshPanel = document.getElementById('auto-refresh-panel');

    const REFRESH_INTERVAL_SECONDS = 600; // Фиксированный интервал 10 минут

    let autoRefreshInterval = null;
    let countdownInterval = null;
    let remainingSeconds = 0;
    let lastMetarRaw = null; // Для отслеживания изменений

    // Показываем панель автообновления когда загружен METAR
    function showAutoRefreshPanel() {
        autoRefreshPanel.style.display = 'block';
    }

    // Обработчик включения/выключения автообновления
    autoRefreshToggle.addEventListener('change', function() {
        if (this.checked) {
            startAutoRefresh();
        } else {
            stopAutoRefresh();
        }
    });

    function startAutoRefresh() {
        if (selectedAirports.length === 0) {
            autoRefreshToggle.checked = false;
            showError('Сначала выберите хотя бы один аэропорт');
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

        console.log(`Автообновление включено для ${selectedAirports.length} аэропорт(а/ов): каждые ${REFRESH_INTERVAL_SECONDS} секунд (10 минут)`);
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

        refreshTimer.innerHTML = '⏸ Остановлено';
        console.log('Автообновление остановлено');
    }

    function updateCountdown() {
        if (remainingSeconds <= 0) {
            remainingSeconds = REFRESH_INTERVAL_SECONDS;
        }

        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = remainingSeconds % 60;
        const timeString = `${minutes}:${String(seconds).padStart(2, '0')}`;

        refreshTimer.innerHTML = `🔄 Обновление через: <strong>${timeString}</strong>`;
        remainingSeconds--;
    }

    function performAutoRefresh() {
        if (selectedAirports.length === 0) {
            stopAutoRefresh();
            autoRefreshToggle.checked = false;
            return;
        }

        console.log(`Автообновление для ${selectedAirports.length} аэропорт(а/ов)...`);

        // Показываем индикатор без скрытия контента
        showRefreshIndicator();

        // Загружаем данные для всех аэропортов
        const fetchPromises = selectedAirports.map(airport =>
            fetch('/fetch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ icao: airport.icao })
            })
            .then(response => response.json())
            .then(data => ({ airport, data }))
        );

        Promise.all(fetchPromises)
            .then(results => {
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
                    console.log('METAR не изменились');
                    showNoChangeNotification();
                }

                // Сбрасываем таймер
                remainingSeconds = REFRESH_INTERVAL_SECONDS;
            })
            .catch(error => {
                hideRefreshIndicator();
                console.error('Ошибка автообновления:', error);

                // Сбрасываем таймер даже при ошибке
                remainingSeconds = REFRESH_INTERVAL_SECONDS;
            });
    }

    function showRefreshIndicator() {
        // Создаем индикатор если его нет
        let indicator = document.getElementById('refresh-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'refresh-indicator';
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
        indicator.style.display = 'flex';
    }

    function hideRefreshIndicator() {
        const indicator = document.getElementById('refresh-indicator');
        if (indicator) {
            indicator.style.display = 'none';
        }
    }

    function showNewMetarNotification() {
        showNotification('✅ Получен новый METAR!', 'success');
    }

    function showNoChangeNotification() {
        showNotification('ℹ️ METAR не изменился', 'info');
    }

    function showNotification(message, type = 'info') {
        // Создаем уведомление
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            background: ${type === 'success' ? 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)' : 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)'};
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
        const style = document.createElement('style');
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
        if (!document.getElementById('notification-animations')) {
            style.id = 'notification-animations';
            document.head.appendChild(style);
        }

        document.body.appendChild(notification);

        // Удаляем через 3 секунды
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(400px)';
            notification.style.transition = 'all 0.3s ease-out';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    // Модифицируем функцию fetchMetarTaf чтобы показывать панель
    const originalFetchMetarTaf = fetchMetarTaf;
    window.fetchMetarTaf = function() {
        // Останавливаем автообновление при ручном обновлении
        if (autoRefreshToggle.checked) {
            autoRefreshToggle.checked = false;
            stopAutoRefresh();
        }

        originalFetchMetarTaf();
    };
    fetchBtn.removeEventListener('click', fetchMetarTaf);
    fetchBtn.addEventListener('click', window.fetchMetarTaf);

    // Панель автообновления уже показывается в fetchMetarTaf через showAutoRefreshPanel()
});