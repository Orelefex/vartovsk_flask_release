# Инструкция по развертыванию на сервере

Руководство по развертыванию Flask приложения METAR/TAF на production сервере с использованием **uv**, **gunicorn** и **nginx**.

---

## 📋 Содержание

1. [Требования к серверу](#требования-к-серверу)
2. [Структура файлов для переноса](#структура-файлов-для-переноса)
3. [Подготовка сервера](#подготовка-сервера)
4. [Установка приложения](#установка-приложения)
5. [Настройка Gunicorn + systemd](#настройка-gunicorn--systemd)
6. [Настройка Nginx](#настройка-nginx)
7. [Проверка и запуск](#проверка-и-запуск)
8. [Обновление приложения](#обновление-приложения)
9. [Мониторинг и логи](#мониторинг-и-логи)
10. [Решение проблем](#решение-проблем)

---

## 🖥️ Требования к серверу

### Минимальные:
- **OS:** Ubuntu 20.04+ / Debian 11+ / CentOS 8+
- **RAM:** 1 GB
- **CPU:** 1 core
- **Disk:** 5 GB свободного места (venv занимает ~65 MB)
- **Python:** 3.12+

### Необходимое ПО:
- nginx
- uv (package manager)
- systemd

---

## 📦 Структура файлов для переноса

### Обязательные файлы и папки:

```
vartovsk_flask_web/
├── metar_web_app.py          # Главное приложение Flask
├── metar_decoder.py           # Декодер METAR
├── taf_decoder.py             # Декодер TAF
├── ogimet_parser.py           # Парсер Ogimet
├── pyproject.toml             # Зависимости проекта
├── uv.lock                    # Lock-файл зависимостей
├── ICAO.csv                   # База аэропортов
├── README.md                  # Документация
├── DEPLOYMENT.md              # Эта инструкция
├── templates/                 # HTML шаблоны
│   ├── index.html
│   └── archive.html
└── static/                    # Статические файлы
    ├── css/
    │   └── style.css
    ├── js/
    │   ├── script.js
    │   └── archive.js
    └── favicon.ico (опционально)
```

### НЕ переносить:
- `.venv/` - виртуальное окружение
- `__pycache__/` - кеш Python
- `.git/` - Git репозиторий
- `.gitignore`
- `test_*.py` - тестовые файлы
- `main.py` - если не используется

---

## 🚀 Подготовка сервера

### 1. Подключение к серверу

```bash
ssh your_user@your_server_ip
```

### 2. Обновление системы

```bash
sudo apt update && sudo apt upgrade -y
```

### 3. Установка необходимых пакетов

```bash
# Установка базовых инструментов
sudo apt install -y curl git build-essential nginx supervisor

# Установка Python 3.12 (если нет)
sudo apt install -y python3.12 python3.12-venv python3.12-dev

# Проверка версии Python
python3.12 --version
```

### 4. Установка uv

```bash
# Установка uv package manager
curl -LsSf https://astral.sh/uv/install.sh | sh

# Добавление uv в PATH (если нужно)
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Проверка установки
uv --version
```

---

## 📥 Установка приложения

### 1. Создание пользователя для приложения (опционально, но рекомендуется)

```bash
sudo useradd -m -s /bin/bash metarapp
sudo su - metarapp
```

### 2. Создание директории для приложения

```bash
# Если работаете под metarapp
mkdir -p ~/vartovsk_flask_web
cd ~/vartovsk_flask_web

# Или для root/sudo пользователя
# sudo mkdir -p /var/www/vartovsk_flask_web
# cd /var/www/vartovsk_flask_web
# sudo chown -R metarapp:metarapp /var/www/vartovsk_flask_web
```

### 3. Перенос файлов на сервер

**Вариант A: Через SCP (с локального компьютера)**

```bash
# На локальной машине
cd /home/oleg/code/

# Создаем архив (исключая ненужные файлы)
tar -czf vartovsk_flask_web.tar.gz \
  --exclude='.venv' \
  --exclude='__pycache__' \
  --exclude='.git' \
  --exclude='test_*.py' \
  --exclude='*.pyc' \
  vartovsk_flask_web/

# Копируем на сервер
scp vartovsk_flask_web.tar.gz your_user@your_server_ip:~/

# На сервере распаковываем
ssh your_user@your_server_ip
cd /home/metarapp/
tar -xzf ~/vartovsk_flask_web.tar.gz
mv vartovsk_flask_web/* vartovsk_flask_web/
```

**Вариант B: Через rsync (быстрее для обновлений)**

```bash
# На локальной машине
rsync -avz --exclude='.venv' --exclude='__pycache__' --exclude='.git' \
  /home/oleg/code/vartovsk_flask_web/ \
  your_user@your_server_ip:/home/metarapp/vartovsk_flask_web/
```

**Вариант C: Через Git (если используете репозиторий)**

```bash
# На сервере
cd /home/metarapp/
git clone https://your-repo-url/vartovsk_flask_web.git
cd vartovsk_flask_web
```

### 4. Установка зависимостей через uv

```bash
cd /home/metarapp/vartovsk_flask_web

# Создание виртуального окружения
uv venv

# Активация окружения
source .venv/bin/activate

# Установка зависимостей из pyproject.toml
uv sync

# Установка gunicorn (для production)
uv pip install gunicorn

# Проверка установки
python -c "import flask; print(flask.__version__)"
```

### 5. Проверка работы приложения

```bash
# Тестовый запуск
python metar_web_app.py

# Откройте в браузере: http://your_server_ip:5001
# Если работает - переходим к настройке gunicorn
# Ctrl+C для остановки
```

---

## ⚙️ Настройка Gunicorn + systemd

### 1. Конфигурация Gunicorn

Конфигурация уже есть в репозитории — `gunicorn_config.py`, дополнительно
создавать её не нужно. Она рассчитана на сервер с 1 GB RAM: фиксированное
число воркеров (не от `cpu_count()`, которая на слабом сервере может
расплодить лишние процессы), `worker_class = "gthread"` — параллелизм для
блокирующих запросов к avia-meteo/ogimet/uwyo даётся потоками, а не
дорогими по памяти процессами. Число воркеров/потоков можно переопределить
переменными окружения `GUNICORN_WORKERS` / `GUNICORN_THREADS`.

Логи по умолчанию идут в stdout/stderr (`accesslog = "-"`, `errorlog = "-"`),
их перехватит systemd/journald — отдельная директория `/var/log/gunicorn` не
требуется.

### 2. Создание systemd service файла

```bash
sudo nano /etc/systemd/system/metarapp.service
```

Содержимое файла:

```ini
[Unit]
Description=Gunicorn instance for METAR/TAF Flask Application
After=network.target

[Service]
Type=notify
User=metarapp
Group=metarapp
WorkingDirectory=/home/metarapp/vartovsk_flask_web
Environment="PATH=/home/metarapp/vartovsk_flask_web/.venv/bin"

# Команда запуска
ExecStart=/home/metarapp/vartovsk_flask_web/.venv/bin/gunicorn \
    --config /home/metarapp/vartovsk_flask_web/gunicorn_config.py \
    metar_web_app:app

# Перезапуск при падении
Restart=always
RestartSec=5

# Ограничения ресурсов (опционально)
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
```

### 3. Активация и запуск службы

```bash
# Перезагрузка конфигурации systemd
sudo systemctl daemon-reload

# Включение автозапуска
sudo systemctl enable metarapp

# Запуск службы
sudo systemctl start metarapp

# Проверка статуса
sudo systemctl status metarapp

# Просмотр логов
sudo journalctl -u metarapp -f
```

---

## 🌐 Настройка Nginx

### 1. Создание конфигурации сайта

```bash
sudo nano /etc/nginx/sites-available/metarapp
```

**Базовая конфигурация (HTTP):**

```nginx
# /etc/nginx/sites-available/metarapp

upstream metarapp {
    server 127.0.0.1:5001 fail_timeout=0;
}

server {
    listen 80;
    server_name your_domain.com www.your_domain.com;  # Замените на ваш домен
    # или используйте: server_name _;  # для любого домена

    # Логирование
    access_log /var/log/nginx/metarapp_access.log;
    error_log /var/log/nginx/metarapp_error.log;

    # Увеличиваем таймауты для длительных запросов
    proxy_connect_timeout 120;
    proxy_send_timeout 120;
    proxy_read_timeout 120;

    # Максимальный размер загружаемых файлов
    client_max_body_size 10M;

    # Статические файлы
    location /static/ {
        alias /home/metarapp/vartovsk_flask_web/static/;
        expires 30d;
        add_header Cache-Control "public, immutable";

        # Gzip сжатие
        gzip on;
        gzip_types text/css application/javascript image/svg+xml;
        gzip_min_length 1000;
    }

    # Прокси к Gunicorn
    location / {
        proxy_pass http://metarapp;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_redirect off;

        # WebSocket support (если понадобится)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Запрет доступа к скрытым файлам
    location ~ /\. {
        deny all;
    }
}
```

**Конфигурация с HTTPS (рекомендуется для production):**

```nginx
# HTTP -> HTTPS redirect
server {
    listen 80;
    server_name your_domain.com www.your_domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your_domain.com www.your_domain.com;

    # SSL сертификаты (получите через Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/your_domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your_domain.com/privkey.pem;

    # SSL настройки
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Логирование
    access_log /var/log/nginx/metarapp_access.log;
    error_log /var/log/nginx/metarapp_error.log;

    # Таймауты и размеры
    proxy_connect_timeout 120;
    proxy_send_timeout 120;
    proxy_read_timeout 120;
    client_max_body_size 10M;

    # Статические файлы
    location /static/ {
        alias /home/metarapp/vartovsk_flask_web/static/;
        expires 30d;
        add_header Cache-Control "public, immutable";
        gzip on;
        gzip_types text/css application/javascript image/svg+xml;
    }

    # Прокси к Gunicorn
    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_redirect off;
    }

    location ~ /\. {
        deny all;
    }
}
```

### 2. Активация конфигурации

```bash
# Создаем символическую ссылку
sudo ln -s /etc/nginx/sites-available/metarapp /etc/nginx/sites-enabled/

# Удаляем дефолтный сайт (опционально)
sudo rm /etc/nginx/sites-enabled/default

# Проверка конфигурации nginx
sudo nginx -t

# Если все ОК, перезапускаем nginx
sudo systemctl restart nginx
```

### 3. Настройка SSL с Let's Encrypt (опционально)

```bash
# Установка certbot
sudo apt install -y certbot python3-certbot-nginx

# Получение сертификата
sudo certbot --nginx -d your_domain.com -d www.your_domain.com

# Автопродление сертификата (проверьте, что настроено)
sudo systemctl status certbot.timer
```

---

## ✅ Проверка и запуск

### 1. Проверка всех компонентов

```bash
# Статус приложения
sudo systemctl status metarapp

# Статус nginx
sudo systemctl status nginx

# Проверка портов
sudo netstat -tulpn | grep -E '80|443|5001'

# Проверка логов
sudo journalctl -u metarapp -n 50
sudo tail -f /var/log/nginx/metarapp_error.log
```

### 2. Тестирование через curl

```bash
# Локально на сервере
curl http://localhost:5001/

# Через nginx
curl http://localhost/

# С внешнего адреса
curl http://your_server_ip/
```

### 3. Открытие в браузере

Откройте в браузере:
- `http://your_server_ip/` или
- `http://your_domain.com/`

---

## 🔄 Обновление приложения

### Процедура обновления:

```bash
# 1. Переходим в директорию приложения
cd /home/metarapp/vartovsk_flask_web

# 2. Создаем бэкап (на всякий случай)
cd ..
tar -czf backup_$(date +%Y%m%d_%H%M%S).tar.gz vartovsk_flask_web/

# 3. Копируем новые файлы (rsync с локальной машины)
# На локальной машине:
# rsync -avz /home/oleg/code/vartovsk_flask_web/ your_user@your_server_ip:/home/metarapp/vartovsk_flask_web/

# 4. Активируем виртуальное окружение
cd vartovsk_flask_web
source .venv/bin/activate

# 5. Обновляем зависимости (если изменились)
uv sync

# 6. Перезапускаем приложение
sudo systemctl restart metarapp

# 7. Проверяем статус
sudo systemctl status metarapp

# 8. Проверяем логи
sudo journalctl -u metarapp -n 50 -f
```

### Быстрое обновление (без остановки):

```bash
# Gunicorn поддерживает graceful reload
sudo systemctl reload metarapp
```

---

## 📊 Мониторинг и логи

### Просмотр логов

```bash
# Логи приложения (systemd)
sudo journalctl -u metarapp -f

# Логи Gunicorn
sudo tail -f /var/log/gunicorn/access.log
sudo tail -f /var/log/gunicorn/error.log

# Логи Nginx
sudo tail -f /var/log/nginx/metarapp_access.log
sudo tail -f /var/log/nginx/metarapp_error.log

# Последние 100 строк с ошибками
sudo journalctl -u metarapp -p err -n 100
```

### Мониторинг ресурсов

```bash
# Использование CPU и памяти
htop

# Только процессы gunicorn
ps aux | grep gunicorn

# Использование диска
df -h

# Сетевые соединения
sudo netstat -an | grep :5001
```

### Ротация логов (настройка logrotate)

```bash
sudo nano /etc/logrotate.d/metarapp
```

Содержимое:

```
/var/log/gunicorn/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 metarapp metarapp
    sharedscripts
    postrotate
        systemctl reload metarapp > /dev/null 2>&1 || true
    endscript
}
```

---

## 🔧 Решение проблем

### Проблема 1: Приложение не запускается

```bash
# Проверяем статус
sudo systemctl status metarapp

# Смотрим детальные логи
sudo journalctl -u metarapp -xe

# Проверяем права доступа
ls -la /home/metarapp/vartovsk_flask_web/

# Проверяем Python и зависимости
/home/metarapp/vartovsk_flask_web/.venv/bin/python --version
/home/metarapp/vartovsk_flask_web/.venv/bin/pip list
```

### Проблема 2: Nginx показывает 502 Bad Gateway

```bash
# Проверяем, работает ли gunicorn
sudo systemctl status metarapp
curl http://127.0.0.1:5001/

# Проверяем логи nginx
sudo tail -f /var/log/nginx/metarapp_error.log

# Проверяем SELinux (если используется)
sudo setenforce 0  # временно отключить для теста
```

### Проблема 3: Статические файлы не загружаются

```bash
# Проверяем права доступа
ls -la /home/metarapp/vartovsk_flask_web/static/

# Убедитесь, что nginx может читать файлы
sudo chmod -R 755 /home/metarapp/vartovsk_flask_web/static/

# Проверяем конфигурацию nginx
sudo nginx -t
```

### Проблема 4: Приложение медленно работает

На 1 GB RAM не увеличивайте `workers` бездумно — каждый лишний процесс ест
память. Сначала попробуйте увеличить только потоки (дешевле по RAM): в
`[Service]` секции `metarapp.service` добавьте строку
`Environment="GUNICORN_THREADS=6"`, затем:

```bash
sudo systemctl daemon-reload
sudo systemctl restart metarapp

# Проверьте использование ресурсов
htop

# Проверьте логи на медленные запросы (идут в journald, т.к. accesslog = "-")
sudo journalctl -u metarapp -f
```

### Проблема 5: Недостаточно памяти

```bash
# Создайте swap файл
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Добавьте в /etc/fstab для автозагрузки
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 🔒 Безопасность

### Рекомендации:

1. **Firewall (UFW)**

```bash
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP
sudo ufw allow 443/tcp     # HTTPS
sudo ufw enable
sudo ufw status
```

2. **Обновления безопасности**

```bash
# Автоматические обновления безопасности
sudo apt install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

3. **Fail2ban (защита от брутфорса)**

```bash
sudo apt install fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

4. **Ограничение доступа к SSH**

```bash
# Отредактируйте /etc/ssh/sshd_config
sudo nano /etc/ssh/sshd_config

# Измените:
# PermitRootLogin no
# PasswordAuthentication no (используйте SSH ключи)

sudo systemctl restart sshd
```

---

## 📝 Чек-лист развертывания

- [ ] Сервер обновлен и настроен
- [ ] Установлен Python 3.12+
- [ ] Установлен uv package manager
- [ ] Установлен nginx
- [ ] Файлы приложения перенесены на сервер
- [ ] Виртуальное окружение создано (uv venv)
- [ ] Зависимости установлены (uv sync)
- [ ] Gunicorn установлен (uv pip install gunicorn)
- [ ] Конфигурация gunicorn создана
- [ ] systemd service файл создан и активирован
- [ ] Nginx конфигурация создана и активирована
- [ ] SSL сертификат настроен (опционально)
- [ ] Firewall настроен
- [ ] Приложение запущено и работает
- [ ] Логи проверены на ошибки
- [ ] Автозапуск настроен (systemctl enable)

---

## 📞 Поддержка

При возникновении проблем:

1. Проверьте логи: `sudo journalctl -u metarapp -n 100`
2. Проверьте конфигурацию: `sudo nginx -t`
3. Проверьте статус: `sudo systemctl status metarapp nginx`

---

**Успешного развертывания! 🚀**
