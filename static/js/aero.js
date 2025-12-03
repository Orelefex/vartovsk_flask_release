// Aero diagrams JavaScript
document.addEventListener('DOMContentLoaded', function() {
    // Elements
    const stationSelect = document.getElementById('station-select');
    const dateInput = document.getElementById('date-input');
    const hourSelect = document.getElementById('hour-select');
    const buildBtn = document.getElementById('build-btn');
    const clearBtn = document.getElementById('clear-aero-btn');
    const loadingAero = document.getElementById('loading-aero');
    const errorAero = document.getElementById('error-aero');
    const stationInfo = document.getElementById('station-info');
    const chartsSection = document.getElementById('charts-section');
    const dataTableSection = document.getElementById('data-table-section');

    // Определяем производительность устройства для оптимизации
    const isLowPerformance = window.innerWidth <= 768 ||
                            navigator.hardwareConcurrency <= 2 ||
                            /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    console.log('Режим производительности:', isLowPerformance ? 'упрощенный' : 'полный');

    // Set default date to yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    dateInput.value = yesterday.toISOString().split('T')[0];

    // Load stations on page load
    loadStations();

    // Event listeners
    buildBtn.addEventListener('click', buildDiagram);
    clearBtn.addEventListener('click', clearAll);

    function loadStations() {
        fetch('/aero/stations')
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    const stations = data.stations;
                    stationSelect.innerHTML = '<option value="">Выберите станцию...</option>';

                    // Sort stations by name
                    const sortedStations = Object.entries(stations)
                        .sort((a, b) => a[1].name.localeCompare(b[1].name));

                    sortedStations.forEach(([code, info]) => {
                        const option = document.createElement('option');
                        option.value = code;
                        option.textContent = `${code} - ${info.name}`;
                        stationSelect.appendChild(option);
                    });
                } else {
                    showError('Ошибка загрузки списка станций');
                }
            })
            .catch(error => {
                showError('Ошибка соединения с сервером: ' + error.message);
            });
    }

    function buildDiagram() {
        const stationId = stationSelect.value;
        const date = dateInput.value;
        const hour = hourSelect.value;

        if (!stationId) {
            showError('Пожалуйста, выберите станцию');
            return;
        }

        if (!date) {
            showError('Пожалуйста, выберите дату');
            return;
        }

        hideError();
        hideResults();
        showLoading();

        // Format date for API (YYYYMMDD)
        const dateFormatted = date.replace(/-/g, '');

        fetch('/aero/fetch', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                station_id: stationId,
                date: dateFormatted,
                hour: hour
            })
        })
        .then(response => response.json())
        .then(data => {
            hideLoading();

            if (data.success) {
                displayResults(data.data);
            } else {
                showError(data.error || 'Ошибка при получении данных');
            }
        })
        .catch(error => {
            hideLoading();
            showError('Ошибка соединения с сервером: ' + error.message);
        });
    }

    function displayResults(data) {
        // Display station info
        document.getElementById('station-title').textContent =
            `${data.station_id} - ${data.station_name}`;
        document.getElementById('info-date').textContent = dateInput.value;
        document.getElementById('info-hour').textContent = hourSelect.value + ':00 UTC';
        document.getElementById('info-levels').textContent = data.pressure.length;
        document.getElementById('info-temp').textContent =
            data.temperature[0].toFixed(1) + '°C';

        stationInfo.style.display = 'block';

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
        chartsSection.style.display = 'block';
        dataTableSection.style.display = 'block';
    }

    function displayStabilityIndices(indices) {
        const indicesSection = document.getElementById('indices-section');
        if (!indicesSection) return;

        let html = '<div class="indices-container">';
        html += '<h3 style="margin-bottom: 15px; color: var(--text-primary);">Индексы неустойчивости атмосферы</h3>';

        html += '<div class="indices-grid">';

        // Индекс Фауста
        if (indices.faust !== undefined) {
            html += '<div class="index-card" style="border-left: 4px solid ' + indices.faust_color + '">';
            html += '<div class="index-header">Индекс Фауста</div>';
            html += '<div class="index-value" style="color: ' + indices.faust_color + '">' + indices.faust + '°C</div>';
            html += '<div class="index-rating">' + indices.faust_rating + '</div>';
            html += '<div class="index-formula">FI = T<sub>850</sub> - T<sub>500</sub></div>';
            if (indices.t850 !== undefined && indices.t500 !== undefined) {
                html += '<div class="index-details">';
                html += 'T<sub>850</sub> = ' + indices.t850 + '°C, ';
                html += 'T<sub>500</sub> = ' + indices.t500 + '°C';
                html += '</div>';
            }
            html += '</div>';
        }

        // Индекс Вайтинга
        if (indices.whiting !== undefined) {
            html += '<div class="index-card" style="border-left: 4px solid ' + indices.whiting_color + '">';
            html += '<div class="index-header">Индекс Вайтинга</div>';
            html += '<div class="index-value" style="color: ' + indices.whiting_color + '">' + indices.whiting + '°C</div>';
            html += '<div class="index-rating">' + indices.whiting_rating + '</div>';
            html += '<div class="index-formula">WI = T<sub>850</sub> - T<sub>500</sub> - (Td<sub>850</sub> - 10)</div>';
            if (indices.td850 !== undefined) {
                html += '<div class="index-details">';
                html += 'Td<sub>850</sub> = ' + indices.td850 + '°C';
                html += '</div>';
            }
            html += '</div>';
        }

        html += '</div>'; // indices-grid
        html += '</div>'; // indices-container

        indicesSection.innerHTML = html;
        indicesSection.style.display = 'block';
    }

    function createTemperatureChart(data) {
        // Skew-T диаграмма требует специального преобразования координат
        // X координата = T + (1000 - P) * skew_factor
        const skewFactor = 0.04; // Наклон изотерм (градусы на гПа)

        // Преобразуем координаты для Skew-T
        const tempX = data.temperature.map((t, i) =>
            t + (1000 - data.pressure[i]) * skewFactor
        );
        const dewpointX = data.dewpoint.map((t, i) =>
            t + (1000 - data.pressure[i]) * skewFactor
        );

        // Линия температуры
        const tempTrace = {
            x: tempX,
            y: data.pressure,
            mode: 'lines+markers',
            name: 'Температура',
            line: {color: '#FF0000', width: 2.5},
            marker: {size: 5, color: '#FF0000'},
            hovertemplate: 'T: %{text}°C<br>P: %{y} гПа<extra></extra>',
            text: data.temperature.map(t => t.toFixed(1))
        };

        // Линия точки росы
        const dewpointTrace = {
            x: dewpointX,
            y: data.pressure,
            mode: 'lines+markers',
            name: 'Точка росы',
            line: {color: '#00AA00', width: 2.5},
            marker: {size: 5, color: '#00AA00'},
            hovertemplate: 'Td: %{text}°C<br>P: %{y} гПа<extra></extra>',
            text: data.dewpoint.map(t => t.toFixed(1))
        };

        // Создаем изотермы (вертикальные линии на Skew-T)
        // Оптимизация: уменьшаем количество линий на слабых устройствах
        const isotherms = [];
        const isothermStep = isLowPerformance ? 20 : 10;
        const pressureStep = isLowPerformance ? 100 : 50;

        for (let temp = -80; temp <= 40; temp += isothermStep) {
            const x = [];
            const y = [];
            for (let p = 1050; p >= 100; p -= pressureStep) {
                x.push(temp + (1000 - p) * skewFactor);
                y.push(p);
            }
            isotherms.push({
                x: x,
                y: y,
                mode: 'lines',
                line: {color: '#B0BEC5', width: 0.5, dash: 'dot'},
                showlegend: false,
                hoverinfo: 'skip'
            });
        }

        // Создаем сухие адиабаты (наклонные линии)
        // Оптимизация: меньше линий для слабых устройств
        const dryAdiabats = [];
        const theta0Values = isLowPerformance ?
            [-40, 0, 40, 80] :
            [-40, -20, 0, 20, 40, 60, 80, 100];
        const adiabatStep = isLowPerformance ? 20 : 10;

        for (let theta0 of theta0Values) {
            const x = [];
            const y = [];
            for (let p = 1050; p >= 100; p -= adiabatStep) {
                const t = theta0 * Math.pow(p / 1000, 0.286) - 273.15;
                x.push(t + (1000 - p) * skewFactor);
                y.push(p);
            }
            dryAdiabats.push({
                x: x,
                y: y,
                mode: 'lines',
                line: {color: '#FFCCBC', width: 0.5},
                showlegend: false,
                hoverinfo: 'skip'
            });
        }

        // Изобары (горизонтальные линии)
        const isobars = [];
        const pressureLevels = [1000, 850, 700, 500, 300, 200, 100];
        for (let p of pressureLevels) {
            isobars.push({
                x: [-100 + (1000 - p) * skewFactor, 60 + (1000 - p) * skewFactor],
                y: [p, p],
                mode: 'lines',
                line: {color: '#90A4AE', width: 1},
                showlegend: false,
                hoverinfo: 'skip'
            });
        }

        const layout = {
            title: {
                text: 'Skew-T диаграмма',
                font: {size: 18, weight: 'bold'}
            },
            xaxis: {
                title: 'Температура (°C)',
                gridcolor: '#E0E0E0',
                showgrid: true,
                zeroline: false,
                range: [-60, 60]
            },
            yaxis: {
                title: 'Давление (гПа)',
                type: 'log',
                autorange: 'reversed',
                gridcolor: '#E0E0E0',
                showgrid: true,
                range: [Math.log10(1050), Math.log10(100)]
            },
            plot_bgcolor: '#FAFAFA',
            paper_bgcolor: 'white',
            hovermode: 'closest',
            showlegend: true,
            legend: {
                x: 0.02,
                y: 0.98,
                bgcolor: 'rgba(255,255,255,0.9)',
                bordercolor: '#BDBDBD',
                borderwidth: 1
            }
        };

        const traces = [...isobars, ...isotherms, ...dryAdiabats, tempTrace, dewpointTrace];

        // Настройки Plotly с оптимизацией для слабых устройств
        const config = {
            responsive: true,
            displayModeBar: !isLowPerformance, // Скрываем панель инструментов на слабых устройствах
            staticPlot: isLowPerformance // Отключаем интерактивность на слабых устройствах для повышения производительности
        };

        Plotly.newPlot('temp-chart', traces, layout, config);
    }

    function createWindChart(data) {
        // Вычисляем скорость и направление ветра
        const windSpeed = [];
        const windDirection = [];

        for (let i = 0; i < data.u_wind.length; i++) {
            const u = data.u_wind[i];
            const v = data.v_wind[i];
            const speed = Math.sqrt(u * u + v * v);
            const dir = (Math.atan2(u, v) * 180 / Math.PI + 180) % 360;
            windSpeed.push(speed);
            windDirection.push(dir);
        }

        // График скорости ветра
        const windSpeedTrace = {
            x: windSpeed,
            y: data.pressure,
            mode: 'lines+markers',
            name: 'Скорость ветра',
            line: {color: '#0066CC', width: 2.5},
            marker: {size: 5, color: '#0066CC'},
            hovertemplate: 'Скорость: %{x:.1f} км/ч<br>P: %{y} гПа<extra></extra>'
        };

        // Создаем барбы (перья) ветра
        const windBarbs = [];
        const barbInterval = Math.max(1, Math.floor(data.pressure.length / 20)); // Показываем ~20 барб

        for (let i = 0; i < data.pressure.length; i += barbInterval) {
            const speed = windSpeed[i];
            const dir = windDirection[i];
            const p = data.pressure[i];

            // Длина барба пропорциональна скорости
            const barbLength = Math.min(speed / 5, 15); // Масштаб

            // Направление в радианах (откуда дует ветер)
            const dirRad = dir * Math.PI / 180;

            // Координаты стрелки
            const x0 = 0;
            const x1 = -barbLength * Math.sin(dirRad);

            // Добавляем стрелку
            windBarbs.push({
                x: [x0, x1],
                y: [p, p],
                mode: 'lines',
                line: {color: '#333333', width: 2},
                showlegend: false,
                hovertemplate: `${speed.toFixed(1)} км/ч, ${dir.toFixed(0)}°<extra></extra>`
            });

            // Добавляем оперение (флажки)
            const numFlags = Math.floor(speed / 50); // 1 флажок = 50 км/ч
            const numBarbs = Math.floor((speed - numFlags * 50) / 10); // 1 перо = 10 км/ч

            let currentPos = 0.7; // Начальная позиция на барбе

            // Рисуем флажки
            for (let f = 0; f < numFlags; f++) {
                const barbX = x1 * currentPos;
                const flagX = barbX - 3 * Math.cos(dirRad);
                const flagY = p;

                windBarbs.push({
                    x: [barbX, flagX, barbX - 1.5 * Math.sin(dirRad)],
                    y: [flagY, flagY, flagY],
                    mode: 'lines',
                    fill: 'toself',
                    fillcolor: '#333333',
                    line: {color: '#333333', width: 1},
                    showlegend: false,
                    hoverinfo: 'skip'
                });

                currentPos -= 0.15;
            }

            // Рисуем короткие перья
            for (let b = 0; b < numBarbs; b++) {
                const barbX = x1 * currentPos;
                const pX = barbX - 2 * Math.cos(dirRad);

                windBarbs.push({
                    x: [barbX, pX],
                    y: [p, p],
                    mode: 'lines',
                    line: {color: '#333333', width: 1.5},
                    showlegend: false,
                    hoverinfo: 'skip'
                });

                currentPos -= 0.1;
            }
        }

        const layout = {
            title: {
                text: 'Профиль ветра (Барбы ветра)',
                font: {size: 18, weight: 'bold'}
            },
            xaxis: {
                title: 'Скорость ветра (км/ч)',
                gridcolor: '#E0E0E0',
                range: [-20, Math.max(...windSpeed) + 10]
            },
            yaxis: {
                title: 'Давление (гПа)',
                type: 'log',
                autorange: 'reversed',
                gridcolor: '#E0E0E0',
                range: [Math.log10(1050), Math.log10(100)]
            },
            plot_bgcolor: '#FAFAFA',
            paper_bgcolor: 'white',
            hovermode: 'closest',
            showlegend: true,
            legend: {
                x: 0.02,
                y: 0.98,
                bgcolor: 'rgba(255,255,255,0.9)',
                bordercolor: '#BDBDBD',
                borderwidth: 1
            }
        };

        const traces = [windSpeedTrace, ...windBarbs];

        // Настройки Plotly с оптимизацией для слабых устройств
        const config = {
            responsive: true,
            displayModeBar: !isLowPerformance,
            staticPlot: isLowPerformance
        };

        Plotly.newPlot('wind-chart', traces, layout, config);
    }

    function createDataTable(data) {
        const tbody = document.getElementById('sounding-tbody');

        // Оптимизация: используем DocumentFragment для массовой вставки
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < data.pressure.length; i++) {
            const row = document.createElement('tr');

            // Создаем все ячейки сразу с помощью innerHTML для лучшей производительности
            const u = data.u_wind[i];
            const v = data.v_wind[i];
            const speed = Math.sqrt(u * u + v * v);
            const direction = (Math.atan2(u, v) * 180 / Math.PI + 180) % 360;

            row.innerHTML = `
                <td>${data.pressure[i].toFixed(1)}</td>
                <td>${data.temperature[i].toFixed(1)}</td>
                <td>${data.dewpoint[i].toFixed(1)}</td>
                <td>${speed.toFixed(1)}</td>
                <td>${direction.toFixed(0)}</td>
            `;

            fragment.appendChild(row);
        }

        tbody.innerHTML = '';
        tbody.appendChild(fragment);
    }

    function clearAll() {
        stationSelect.value = '';
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        dateInput.value = yesterday.toISOString().split('T')[0];
        hourSelect.value = '00';
        hideError();
        hideResults();
    }

    function showLoading() {
        loadingAero.style.display = 'block';
    }

    function hideLoading() {
        loadingAero.style.display = 'none';
    }

    function showError(message) {
        errorAero.textContent = message;
        errorAero.style.display = 'block';
    }

    function hideError() {
        errorAero.style.display = 'none';
    }

    function hideResults() {
        stationInfo.style.display = 'none';
        const indicesSection = document.getElementById('indices-section');
        if (indicesSection) {
            indicesSection.style.display = 'none';
        }
        chartsSection.style.display = 'none';
        dataTableSection.style.display = 'none';
    }
});
