import os

bind = "127.0.0.1:5001"

# Сервер рассчитан на 1 GB RAM — фиксируем небольшое число воркеров вместо
# формулы от cpu_count(), которая на слабом сервере может расплодить лишние
# процессы. Внешние запросы (avia-meteo/ogimet/uwyo) — блокирующий I/O,
# поэтому для параллелизма используются потоки (gthread), а не процессы:
# они намного дешевле по памяти.
workers = int(os.getenv("GUNICORN_WORKERS", "2"))
threads = int(os.getenv("GUNICORN_THREADS", "4"))
worker_class = "gthread"

# Периодически перезапускаем воркеры, чтобы не накапливать утечки памяти
# при долгой работе на ограниченном объёме RAM.
max_requests = 500
max_requests_jitter = 50

timeout = 60
keepalive = 5
accesslog = "-"
errorlog = "-"
loglevel = "info"
preload_app = True
