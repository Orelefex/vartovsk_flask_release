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
        // Update section header
        const metarHeader = document.querySelector('#archive-metar-section h2');
        if (metarHeader) {
            metarHeader.textContent = `Архив METAR/SPECI ${periodText}`;
        }

        let html = '<table class="metar-history-table">';
        html += '<thead><tr>';
        html += '<th style="width: 180px;">Время (UTC)</th>';
        html += '<th>METAR/SPECI код</th>';
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

            html += `<tr class="metar-history-row" data-index="${index}">`;
            html += `<td class="metar-time">${formattedTime}</td>`;
            html += `<td class="metar-raw"><code>${item.raw}</code></td>`;
            html += `<td class="metar-arrow"><span class="toggle-icon">▶</span></td>`;
            html += '</tr>';

            html += `<tr class="metar-history-details" id="metar-details-${index}" style="display: none;">`;
            html += '<td colspan="3" class="metar-decoded">';
            html += `<pre>${item.pretty}</pre>`;
            html += '</td></tr>';
        });

        html += '</tbody></table>';
        archiveMetarTable.innerHTML = html;

        // Add click handlers
        document.querySelectorAll('.metar-history-row').forEach(row => {
            row.addEventListener('click', function() {
                const index = this.getAttribute('data-index');
                const details = document.getElementById(`metar-details-${index}`);
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

    function displayTafArchive(history, periodText) {
        // Update section header
        const tafHeader = document.querySelector('#archive-taf-section h2');
        if (tafHeader) {
            tafHeader.textContent = `Архив TAF ${periodText}`;
        }

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
