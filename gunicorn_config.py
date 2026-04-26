import multiprocessing

bind = "127.0.0.1:5001"
workers = min(multiprocessing.cpu_count() * 2 + 1, 4)
threads = 2
worker_class = "sync"
timeout = 60
keepalive = 5
accesslog = "logs/gunicorn_access.log"
errorlog = "logs/gunicorn_error.log"
loglevel = "info"
preload_app = True
