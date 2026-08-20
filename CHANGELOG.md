# Changelog

## 2026-08-20 — упрощение проекта под сервер 1 GB RAM / 15 GB ROM

Изменения не закоммичены в git на момент записи — см. `git diff` / `git status`.

### Зависимости

- Из `pyproject.toml` убраны `matplotlib`, `plotly`, `metpy` — не использовались
  ни в одном `.py`-файле (графики на `/aero` рисовались в браузере через
  Plotly.js с CDN, теперь и это убрано — см. ниже).
- `uv.lock` пересобран: 45 пакетов → 21.
- `.venv` пересобран с нуля (`rm -rf .venv && uv sync`): **778 MB → 65 MB**.
  Заодно ушли «осиротевшие» пакеты (pyarrow, polars, streamlit, sqlalchemy,
  asyncpg, psycopg2 и др.), которых не было даже в старом `uv.lock` —
  видимо, венв когда-то использовался для другого проекта.

### gunicorn (`gunicorn_config.py`)

- `workers` — было `min(cpu_count()*2+1, 4)` (зависело от CPU машины, где
  собирали конфиг), стало фиксированное `workers=2` (переопределяется через
  `GUNICORN_WORKERS`).
- **Найден и исправлен баг**: `worker_class = "sync"` при этом игнорирует
  параметр `threads` — gunicorn использует потоки только с `worker_class =
  "gthread"`. Реального параллелизма внутри воркера не было. Теперь
  `worker_class = "gthread"`, `threads=4` (переопределяется через
  `GUNICORN_THREADS`) — параллелизм для блокирующих запросов к
  avia-meteo/ogimet/uwyo даётся дешёвыми по памяти потоками, а не процессами.
- Добавлены `max_requests=500`, `max_requests_jitter=50` — периодический
  рестарт воркеров против постепенных утечек памяти на долго работающем
  процессе с ограниченным RAM.
- Проверено вживую: 2 воркера + мастер-процесс ≈ 150 MB RSS суммарно.

### Удалён мёртвый код

- `cache_manager.py` — TTL/LRU-кэш для внешних запросов, нигде не
  импортировался и не использовался. Удалён целиком.

### Страница `/aero` — убраны графики

- `templates/aero.html`: убран `<script src="...cdn.plot.ly...">` и весь
  блок `charts-section` (Skew-T диаграмма температуры/точки росы + профиль
  ветра).
- `static/js/aero.js`: удалены функции `createTemperatureChart` (расчёт
  изотерм, сухих/влажных адиабат для Skew-T) и `createWindChart`, а также
  связанный с ними код определения производительности устройства
  (`isLowPerformance`). Файл сократился с 616 до ~300 строк.
- Осталась таблица радиозондирования (`sounding-table`) — давление, высота,
  температура, точка росы, скорость и направление ветра.
- Эффект: страница больше не грузит Plotly.js с CDN (~1 MB), меньше JS для
  выполнения в браузере — заметно легче на слабых устройствах и при плохом
  канале.

### Страница `/aero` — убраны индексы неустойчивости

- `templates/aero.html`: убран блок `indices-section`.
- `static/js/aero.js`: удалена функция `displayStabilityIndices`
  (рендеринг карточек индекса Фауста, Вайтинга, K-индекса, Total Totals) и
  все ссылки на неё.
- `metar_web_app.py` (`/aero/fetch`): убран вызов расчёта индексов и
  добавление `indices` в ответ API.
- `aero_data.py`: удалён неиспользуемый метод `AeroDataFetcher.calculate_stability_indices`
  (~137 строк).

### Документация

- `DEPLOYMENT.md`: требования к серверу изменены с «RAM 2 GB (рекомендуется
  4 GB), CPU 2 cores» на «RAM 1 GB, CPU 1 core»; добавлено пояснение, что
  графики строятся на клиенте и тяжёлые Python-пакеты не нужны; пример
  конфига gunicorn заменён ссылкой на реальный `gunicorn_config.py` из
  репозитория (было расхождение — в доке была своя, более старая версия
  конфига); поправлены инструкции по логам (`accesslog = "-"` → journald,
  а не `/var/log/gunicorn/access.log`) и по увеличению воркеров/потоков.

### Что проверено

- `uv run python -c "import metar_web_app"` — импортируется без ошибок.
- Запуск через `gunicorn --config gunicorn_config.py metar_web_app:app` —
  оба воркера стартуют, `GET /`, `GET /aero`, `POST /decode` отвечают 200.
- `GET /aero` больше не содержит `plot.ly`, но содержит `sounding-table`.
- `node --check static/js/aero.js` — синтаксис в порядке.
- `grep` по всему репозиторию подтвердил отсутствие оставшихся ссылок на
  `indices`/`indicesSection`/`chartsSection`/`cache_manager`.

### Ранее найденные, но пока не исправленные проблемы

(см. память проекта `review-findings-2026-08` — полный список из ревью
безопасности/качества кода, не связанный напрямую с упрощением под 1 GB RAM)

- XSS-риск: внешние METAR/TAF-данные вставляются в `innerHTML` без
  экранирования в `static/js/script.js` и `static/js/archive.js`.
- Несолёный/усечённый хеш IP в `visit_tracker.py` (`sha256(ip)[:16]`) —
  не даёт заявленной приватности.
- `X-Forwarded-For` берётся без проверки доверенного прокси.
- `validators.py` — большинство функций (`validate_icao_code`,
  `validate_hours`, `validate_station_id`, `validate_sounding_date`,
  `validate_sounding_hour`) не подключены к роутам в `metar_web_app.py`.
