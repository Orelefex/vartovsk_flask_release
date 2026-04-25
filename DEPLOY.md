# Деплой Meteostart.ru на сервере

## Требования к серверу

- **ОС:** Ubuntu 22.04 / Debian 12
- **RAM:** от 1 ГБ (зависимости metpy/numpy/scipy тяжёлые)
- **Python:** 3.12+
- **Место на диске:** ~1 ГБ (venv с зависимостями)

---

## 1. Подготовка сервера

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git nginx curl
```

### Установка uv (пакетный менеджер)

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source $HOME/.local/bin/env   # или перезайти в терминал
```

---

## 2. Клонирование репозитория

```bash
# Создаём пользователя для приложения (рекомендуется)
sudo useradd -m -s /bin/bash meteoapp
sudo su - meteoapp

# Клонируем репозиторий
git clone <URL_репозитория> /home/meteoapp/app
cd /home/meteoapp/app
```

---

## 3. Установка зависимостей

```bash
cd /home/meteoapp/app

# uv создаст venv и установит всё из pyproject.toml
uv sync
```

---

## 4. Настройка конфигурации

```bash
cp .env.example .env
nano .env
```

Минимальные изменения в `.env` для продакшена:

```ini
FLASK_DEBUG=false
FLASK_HOST=127.0.0.1   # Gunicorn будет слушать только localhost
FLASK_PORT=5001

LOG_LEVEL=INFO
LOG_FILE=logs/metar_app.log
```

Создаём папку для логов:

```bash
mkdir -p logs
```

---

## 5. Проверка запуска

```bash
uv run python metar_web_app.py
# Должно запуститься на http://127.0.0.1:5001
# Ctrl+C для остановки
```

---

## 6. Gunicorn (WSGI-сервер)

Flask встроенный сервер **не подходит для продакшена**. Используем Gunicorn.

```bash
uv add gunicorn
```

Тестовый запуск через Gunicorn:

```bash
uv run gunicorn \
  --workers 2 \
  --bind 127.0.0.1:5001 \
  --timeout 60 \
  metar_web_app:app
```

> **workers:** для данного приложения (I/O-bound, внешние запросы) достаточно 2–3. Больше — требует больше RAM.

---

## 7. Systemd-сервис (автозапуск)

```bash
sudo nano /etc/systemd/system/meteoapp.service
```

```ini
[Unit]
Description=Meteostart Flask App
After=network.target

[Service]
User=meteoapp
Group=meteoapp
WorkingDirectory=/home/meteoapp/app
ExecStart=/home/meteoapp/.local/bin/uv run gunicorn \
    --workers 2 \
    --bind 127.0.0.1:5001 \
    --timeout 60 \
    --access-logfile logs/access.log \
    --error-logfile logs/error.log \
    metar_web_app:app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable meteoapp
sudo systemctl start meteoapp

# Проверить статус
sudo systemctl status meteoapp
```

---

## 8. Nginx (обратный прокси)

```bash
sudo nano /etc/nginx/sites-available/meteoapp
```

```nginx
server {
    listen 80;
    server_name meteostart.ru www.meteostart.ru;

    # Статические файлы отдаёт Nginx напрямую (быстрее)
    location /static/ {
        alias /home/meteoapp/app/static/;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # Всё остальное — проксируем на Gunicorn
    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/meteoapp /etc/nginx/sites-enabled/
sudo nginx -t          # проверить конфиг
sudo systemctl restart nginx
```

---

## 9. SSL (HTTPS через Certbot)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d meteostart.ru -d www.meteostart.ru
```

Certbot сам обновит конфиг Nginx и настроит автопродление сертификата.

---

## 10. Обновление приложения

```bash
sudo su - meteoapp
cd /home/meteoapp/app

git pull
uv sync                        # обновить зависимости если изменились

sudo systemctl restart meteoapp
```

---

## Структура файлов на сервере

```
/home/meteoapp/app/
├── .env                  # конфигурация (не в git!)
├── metar_history.db      # SQLite база (создаётся автоматически)
├── logs/
│   ├── metar_app.log
│   ├── access.log
│   └── error.log
├── ICAO.csv
├── aero_index.json
└── ...
```

---

## Быстрая диагностика

| Проблема | Команда |
|----------|---------|
| Статус сервиса | `sudo systemctl status meteoapp` |
| Логи приложения | `tail -f /home/meteoapp/app/logs/metar_app.log` |
| Логи Gunicorn | `tail -f /home/meteoapp/app/logs/error.log` |
| Логи Nginx | `sudo tail -f /var/log/nginx/error.log` |
| Перезапуск | `sudo systemctl restart meteoapp` |
