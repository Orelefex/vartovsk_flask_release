// Archive page JavaScript
document.addEventListener('DOMContentLoaded', function() {
    // Elements
    const loading = document.getElementById('loading');
    const errorMessage = document.getElementById('error-message');
    const archiveMetarSection = document.getElementById('archive-metar-section');
    const archiveMetarTable = document.getElementById('archive-metar-table');
    const archiveTafSection = document.getElementById('archive-taf-section');
    const archiveTafTable = document.getElementById('archive-taf-table');
    const archiveAirportName = document.getElementById('archive-airport-name');
    const dateFrom = document.getElementById('date-from');
    const dateTo = document.getElementById('date-to');
    const loadArchiveBtn = document.getElementById('load-archive-btn');
    const resetDatesBtn = document.getElementById('reset-dates-btn');

    // Get ICAO from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const icao = urlParams.get('icao');

    if (!icao) {
        showError('Код ICAO не указан');
        return;
    }

    archiveAirportName.textContent = icao;

    // Initialize date inputs with default values
    initializeDates();

    // Event listeners
    loadArchiveBtn.addEventListener('click', loadArchive);
    resetDatesBtn.addEventListener('click', function() {
        initializeDates();
        loadArchive();
    });

    // Load archive data on page load
    loadArchive();

    function initializeDates() {
        const now = new Date();
        const past = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

        // Format for datetime-local input in UTC
        dateTo.value = formatDateTimeLocalUTC(now);
        dateFrom.value = formatDateTimeLocalUTC(past);
    }

    function formatDateTimeLocalUTC(date) {
        // Convert to UTC
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        const hours = String(date.getUTCHours()).padStart(2, '0');
        const minutes = String(date.getUTCMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    function loadArchive() {
        // Clear previous results
        archiveMetarSection.style.display = 'none';
        archiveTafSection.style.display = 'none';
        errorMessage.style.display = 'none';

        showLoading();

        // Parse dates as UTC (user enters UTC time)
        // The input value is in format YYYY-MM-DDTHH:mm
        // We treat it as UTC by appending 'Z'
        const dateFromISO = dateFrom.value; // Already in correct format for API
        const dateToISO = dateTo.value;

        // Create Date objects for display (treating input as UTC)
        const from = new Date(dateFrom.value + ':00Z');
        const to = new Date(dateTo.value + ':00Z');

        // Format for display in UTC
        const formatUTC = (date) => {
            return date.toLocaleString('ru-RU', {
                timeZone: 'UTC',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }) + ' UTC';
        };

        const periodText = `с ${formatUTC(from)} до ${formatUTC(to)}`;

        // Load METAR archive
        fetch('/metar-archive', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                icao: icao,
                dateFrom: dateFromISO,
                dateTo: dateToISO
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success && data.history && data.history.length > 0) {
                displayMetarArchive(data.history, periodText);
                archiveMetarSection.style.display = 'block';
            }
        })
        .catch(error => {
            console.error('Ошибка загрузки архива METAR:', error);
        });

        // Load TAF archive
        fetch('/taf-archive', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                icao: icao,
                dateFrom: dateFromISO,
                dateTo: dateToISO
            })
        })
        .then(response => response.json())
        .then(data => {
            hideLoading();
            if (data.success && data.history && data.history.length > 0) {
                displayTafArchive(data.history, periodText);
                archiveTafSection.style.display = 'block';
            }
        })
        .catch(error => {
            hideLoading();
            console.error('Ошибка загрузки архива TAF:', error);
            showError('Ошибка загрузки архива');
        });
    }

    function displayMetarArchive(history, periodText) {
        const metarTitle = document.getElementById('archive-metar-title');
        if (metarTitle) metarTitle.textContent = `Архив METAR/SPECI ${periodText}`;

        // Словарь явлений (сокращённо)
        const WX_SHORT = {
            'DZ': 'Морось', 'RA': 'Дождь', 'SN': 'Снег', 'SG': 'Снеж.зёрна',
            'IC': 'Лёд.крист.', 'PL': 'Лёд.дождь', 'GR': 'Град', 'GS': 'Кр.град',
            'BR': 'Дымка', 'FG': 'Туман', 'FU': 'Дым', 'VA': 'Вулк.пепел',
            'DU': 'Пыль', 'SA': 'Песок', 'HZ': 'Мгла', 'SQ': 'Шквалы',
            'FC': 'Смерч', 'SS': 'Пес.буря', 'DS': 'Пыл.буря', 'UP': 'Неизв.',
            'SHRA': 'Лив.дождь', 'SHSN': 'Лив.снег', 'SHGR': 'Лив.град',
            'SHGS': 'Лив.крупа', 'SHPL': 'Лив.лёд.дождь',
            'SNRA': 'Снег+дождь', 'RASN': 'Дождь+снег',
            'TSRA': 'Гроза+дождь', 'TSSN': 'Гроза+снег',
        };
        const DESC_SHORT = {
            'TS': 'Гроза', 'SH': 'Лив.', 'FZ': 'Замёрз.',
            'BL': 'Метель', 'DR': 'Низов.', 'MI': 'Мест.',
            'BC': 'Обл.', 'PR': 'Частич.', 'VC': 'В окр.'
        };
        const CLOUD_SHORT = {
            'SKC': 'Ясно', 'CLR': 'Ясно', 'NSC': 'NSC',
            'FEW': 'FEW', 'SCT': 'SCT', 'BKN': 'BKN', 'OVC': 'OVC', 'VV': 'VV'
        };

        function translateWx(w) {
            const int_ = w.intensity === '-' ? 'сл.' : w.intensity === '+' ? 'сил.' : '';
            const combo = w.desc && w.phenomena ? w.desc + w.phenomena : null;
            let base = '';
            if (combo && WX_SHORT[combo]) {
                base = WX_SHORT[combo];
            } else {
                if (w.desc === 'TS') {
                    base = 'Гроза' + (w.phenomena ? '+' + (WX_SHORT[w.phenomena] || w.phenomena) : '');
                } else {
                    const d = w.desc ? (DESC_SHORT[w.desc] || w.desc) : '';
                    const p = w.phenomena ? (WX_SHORT[w.phenomena] || w.phenomena) : '';
                    base = [d, p].filter(Boolean).join(' ');
                }
            }
            return [int_, base].filter(Boolean).join(' ');
        }

        function getRowClass(d) {
            const vis = d.visibility;
            const wx = d.weather || [];
            const hasFog = wx.some(w => w.phenomena === 'FG');
            const hasTS = wx.some(w => w.desc === 'TS');
            const hasHeavy = wx.some(w => w.intensity === '+');
            const visM = vis && !vis.cavok ? vis.meters : null;

            if (hasFog || hasTS || hasHeavy || (visM != null && visM < 1000)) return 'row-severe';
            if (visM != null && visM < 3000) return 'row-poor';
            if ((visM != null && visM < 9999 && wx.length > 0) || (visM != null && visM < 5000)) return 'row-moderate';
            if (vis && (vis.cavok || (vis.meters != null && vis.meters >= 9999)) && wx.length === 0) return 'row-good';
            return '';
        }

        let html = '<table class="archive-metar-table">';
        html += '<thead><tr>';
        html += '<th>Дата/Время UTC</th>';
        html += '<th>Тип</th>';
        html += '<th>Ветер</th>';
        html += '<th>VIS, м</th>';
        html += '<th>Явления</th>';
        html += '<th>Облачность</th>';
        html += '<th>T° / Td</th>';
        html += '<th>QNH</th>';
        html += '<th>RVR / ВПП</th>';
        html += '</tr></thead><tbody>';

        history.forEach((item, index) => {
            const d = item.decoded;
            const ts = item.timestamp;
            const dt = `${ts.substring(6,8)}.${ts.substring(4,6)}.${ts.substring(0,4)} ${ts.substring(8,10)}:${ts.substring(10,12)}`;

            // Ветер
            let windStr = '—';
            if (d.wind) {
                const dir = d.wind.dir === 'VRB' ? 'Перем.' : `${d.wind.dir}°`;
                const unit = d.wind.unit === 'KT' ? 'уз' : 'м/с';
                windStr = `${dir} ${d.wind.speed} ${unit}`;
                if (d.wind.gust) windStr += ` пор.${d.wind.gust}`;
                if (d.wind_var) windStr += ` (${d.wind_var.from}°–${d.wind_var.to}°)`;
            }

            // Видимость
            let visStr = '—';
            if (d.visibility) {
                if (d.visibility.cavok) visStr = 'CAVOK';
                else if (d.visibility.meters != null)
                    visStr = d.visibility.meters >= 10000 ? '≥10000' : String(d.visibility.meters);
            }

            // Явления
            let wxStr = '—';
            if (d.weather && d.weather.length > 0)
                wxStr = d.weather.map(translateWx).join(', ');

            // Облачность
            let cloudStr = '—';
            if (d.visibility && d.visibility.cavok) {
                cloudStr = 'CAVOK';
            } else if (d.clouds && d.clouds.length > 0) {
                cloudStr = d.clouds.map(c => {
                    let s = CLOUD_SHORT[c.type] || c.type;
                    if (c.height_ft) s += ` ${c.height_ft}м`;
                    if (c.qual) s += `(${c.qual})`;
                    return s;
                }).join(' ');
            }

            // Температура
            let tempStr = '—';
            if (d.temp_c != null) tempStr = `${d.temp_c} / ${d.dewpoint_c}`;

            // QNH
            const qnhStr = d.altimeter_hpa != null ? String(d.altimeter_hpa) : '—';

            // RVR / состояние ВПП
            const addParts = [];
            if (d.runway_vis && d.runway_vis.length > 0) {
                addParts.push(...d.runway_vis.map(r => {
                    let s = `R${r.runway}/${r.min}`;
                    if (r.max) s += `V${r.max}`;
                    if (r.trend) s += r.trend;
                    return s;
                }));
            }
            if (d.runway_condition && d.runway_condition.length > 0) {
                addParts.push(...d.runway_condition.map(r => `ВПП${r.runway}`));
            }
            const addStr = addParts.length > 0 ? addParts.join(' ') : '—';

            const rowClass = getRowClass(d) || (index % 2 === 0 ? 'row-even' : 'row-odd');

            html += `<tr class="${rowClass}" title="${item.raw}">`;
            html += `<td>${dt}</td>`;
            html += `<td>${item.type || 'METAR'}</td>`;
            html += `<td>${windStr}</td>`;
            html += `<td>${visStr}</td>`;
            html += `<td>${wxStr}</td>`;
            html += `<td>${cloudStr}</td>`;
            html += `<td>${tempStr}</td>`;
            html += `<td>${qnhStr}</td>`;
            html += `<td>${addStr}</td>`;
            html += '</tr>';
        });

        html += '</tbody></table>';
        archiveMetarTable.innerHTML = html;
    }

    function displayTafArchive(history, periodText) {
        const tafTitle = document.getElementById('archive-taf-title');
        if (tafTitle) tafTitle.textContent = `Архив TAF ${periodText}`;

        let html = '<table class="taf-history-table">';
        html += '<thead><tr>';
        html += '<th style="width: 180px;">Время выпуска (UTC)</th>';
        html += '<th>TAF код</th>';
        html += '<th style="width: 40px;"></th>';
        html += '</tr></thead>';
        html += '<tbody>';

        history.forEach((item, index) => {
            const timestamp = item.timestamp;
            const year = timestamp.substring(0, 4);
            const month = timestamp.substring(4, 6);
            const day = timestamp.substring(6, 8);
            const hour = timestamp.substring(8, 10);
            const minute = timestamp.substring(10, 12);
            const formattedTime = `${day}.${month}.${year} ${hour}:${minute}`;

            let validPeriod = '';
            if (item.decoded && item.decoded.valid_period) {
                const vp = item.decoded.valid_period;
                validPeriod = ` (действует: ${vp.from.day} ${String(vp.from.hour).padStart(2, '0')}:00 - ${vp.to.day} ${String(vp.to.hour).padStart(2, '0')}:00)`;
            }

            html += `<tr class="taf-history-row" data-index="${index}">`;
            html += `<td class="taf-time">${formattedTime}${validPeriod}</td>`;
            html += `<td class="taf-raw"><code>${item.raw}</code></td>`;
            html += `<td class="taf-arrow"><span class="toggle-icon">▶</span></td>`;
            html += '</tr>';

            html += `<tr class="taf-history-details" id="taf-details-${index}" style="display: none;">`;
            html += '<td colspan="3" class="taf-decoded">';
            html += `<pre>${item.pretty}</pre>`;
            html += '</td></tr>';
        });

        html += '</tbody></table>';
        archiveTafTable.innerHTML = html;

        // Add click handlers
        document.querySelectorAll('.taf-history-row').forEach(row => {
            row.addEventListener('click', function() {
                const index = this.getAttribute('data-index');
                const details = document.getElementById(`taf-details-${index}`);
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
});
