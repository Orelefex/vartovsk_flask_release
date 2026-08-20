# Деплой рядом с Vikunja (сервер 1 GB RAM / 15 GB ROM)

Инструкция для случая, когда на сервере уже работает Vikunja (нативный
бинарник + systemd, порт по умолчанию `3456`), и нужно добавить это
Flask-приложение (METAR/TAF) на тот же сервер, не уронив ни то, ни другое.

Общие шаги установки (uv, systemd, nginx, SSL) подробно расписаны в
[DEPLOYMENT.md](DEPLOYMENT.md) — здесь только то, что специфично для
совместной работы двух сервисов на тесном железе: бюджет памяти и диска,
разделение портов, отдельный vhost под поддомен.

---

## 1. Бюджет ресурсов

### RAM (1 GB)

| Потребитель | Оценка | Комментарий |
|---|---|---|
| OS + systemd + прочие фоновые службы | ~150 MB | Debian/Ubuntu minimal |
| Vikunja (нативный бинарник) | ~80–120 MB | Go-бинарник, без Docker-оверхеда |
| nginx | ~15–20 MB | один воркер достаточно |
| gunicorn (metarapp): 2 воркера × 4 потока | ~150 MB RSS | измерено вживую, см. CHANGELOG.md |
| **Итого занято** | **~400–450 MB** | |
| **Свободно под пики/кэш ФС** | **~550–600 MB** | |

Запас есть, но он не бесконечный — `apt upgrade`, пересборка `.venv` или
одновременный всплеск нагрузки на оба сервиса могут кратковременно съесть
больше. Поэтому:

- **Не поднимайте `GUNICORN_WORKERS` выше 2** без явной необходимости —
  каждый лишний процесс это +50–75 MB. Если нужно больше параллелизма,
  сначала увеличивайте `GUNICORN_THREADS` (дешевле, см. `gunicorn_config.py`).
- **Заведите swap**, если его ещё нет — на 1 GB RAM это единственная страховка
  от OOM-killer, который может убить не тот процесс (например, Vikunja вместо
  зависшего запроса к ogimet):

  ```bash
  # Проверить, есть ли уже swap
  swapon --show
  free -h

  # Если пусто — создать 1 GB (больше не нужно, диск и так тесный)
  sudo fallocate -l 1G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```

- **Ограничьте оба сервиса через systemd**, чтобы один не задушил другой при
  утечке/аномалии (добавляется в `[Service]` секцию юнита, см. §4):

  ```ini
  MemoryHigh=250M
  MemoryMax=350M
  ```

  Значения ориентировочные — под metarapp достаточно с запасом (обычно
  ~150 MB), под Vikunja подберите по факту (`systemctl status vikunja` /
  `ps aux`).

### ROM (15 GB)

| Потребитель | Оценка |
|---|---|
| OS + пакеты (python3.12, nginx, certbot, build-essential) | ~2–3 GB |
| `.venv` metarapp | ~65 MB |
| Код приложения + `metar_history.db` (TTL-кэш, не растёт бесконечно) | < 50 MB |
| Vikunja: бинарник + SQLite БД + вложения к задачам | зависит от вложений — самая непредсказуемая часть |
| journald / логи nginx | нужно ограничить явно (см. ниже), иначе растут без границ |

Действия:

```bash
# Ограничить journald, если ещё не ограничен
sudo mkdir -p /etc/systemd/journald.conf.d
cat <<'EOF' | sudo tee /etc/systemd/journald.conf.d/size-limit.conf
[Journal]
SystemMaxUse=200M
EOF
sudo systemctl restart systemd-journald

# Логротация nginx уже штатная (пакетная), проверить конфиг
cat /etc/logrotate.d/nginx

# Периодически проверять свободное место
df -h /
du -sh /home/*/vikunja* 2>/dev/null   # если Vikunja хранит вложения на диске
```

Если у Vikunja разрешена загрузка вложений без лимита — стоит выставить
`VIKUNJA_FILES_MAXSIZE` в её конфиге, иначе именно вложения, а не эта
Flask-программа, съедят оставшийся диск.

---

## 2. Порты и разделение сервисов

| Сервис | Bind | Наружу через nginx |
|---|---|---|
| Vikunja | `127.0.0.1:3456` (проверьте свой `config.yml`) | `tasks.<домен>` (пример) |
| metarapp (gunicorn) | `127.0.0.1:5001` (уже задано в `gunicorn_config.py`) | `meteo.<домен>` (пример) |
| nginx | `0.0.0.0:80`, `0.0.0.0:443` | единственная публичная точка входа |

Оба бэкенда слушают только `127.0.0.1` — наружу торчит только nginx.
Проверьте, что Vikunja не слушает `0.0.0.0`, если раньше её открывали
напрямую без прокси:

```bash
sudo ss -tulpn | grep -E '3456|5001'
```

DNS: добавьте A-записи `meteo.<домен>` → IP сервера (запись для
`tasks.<домен>`/Vikunja у вас, вероятно, уже есть).

---

## 3. Установка metarapp

Стандартные шаги — как в [DEPLOYMENT.md](DEPLOYMENT.md#-установка-приложения),
кратко:

```bash
sudo useradd -m -s /bin/bash metarapp   # отдельный от Vikunja пользователь
sudo su - metarapp
cd ~
git clone <repo-url> vartovsk_flask_web
cd vartovsk_flask_web
git checkout dev   # или main, в зависимости от того, что раскатываете

uv sync            # .venv создастся автоматически, ~65 MB
uv run python -c "import metar_web_app"   # быстрая проверка, что всё импортируется
```

---

## 4. systemd-юнит metarapp (с лимитами памяти)

```bash
sudo nano /etc/systemd/system/metarapp.service
```

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

ExecStart=/home/metarapp/vartovsk_flask_web/.venv/bin/gunicorn \
    --config /home/metarapp/vartovsk_flask_web/gunicorn_config.py \
    metar_web_app:app

Restart=always
RestartSec=5
LimitNOFILE=4096

# Страховка на тесном железе — не даём процессу разрастись
# и утащить с собой Vikunja при аномалии/утечке.
MemoryHigh=250M
MemoryMax=350M

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now metarapp
sudo systemctl status metarapp
```

Если у юнита Vikunja таких лимитов ещё нет — добавьте аналогичные строки и
туда (`sudo systemctl edit vikunja` — безопаснее, чем править оригинальный
файл напрямую, изменения уйдут в drop-in).

---

## 5. nginx: отдельный vhost на поддомене

Не трогайте существующий server-блок Vikunja — добавьте новый файл рядом:

```bash
sudo nano /etc/nginx/sites-available/metarapp
```

```nginx
upstream metarapp {
    server 127.0.0.1:5001 fail_timeout=0;
}

server {
    listen 80;
    server_name meteo.<домен>;

    access_log /var/log/nginx/metarapp_access.log;
    error_log  /var/log/nginx/metarapp_error.log;

    client_max_body_size 2M;   # приложение не принимает файлы, запас не нужен

    location /static/ {
        alias /home/metarapp/vartovsk_flask_web/static/;
        expires 30d;
        add_header Cache-Control "public, immutable";
        gzip on;
        gzip_types text/css application/javascript image/svg+xml;
    }

    location / {
        proxy_pass http://metarapp;
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

```bash
sudo ln -s /etc/nginx/sites-available/metarapp /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx   # reload, не restart — не троньте активные соединения к Vikunja
```

SSL для нового поддомена отдельным вызовом certbot (не трогает
существующий сертификат Vikunja):

```bash
sudo certbot --nginx -d meteo.<домен>
```

---

## 6. Проверка

```bash
# Оба сервиса живы
sudo systemctl status metarapp vikunja nginx

# Оба отвечают локально
curl -I http://127.0.0.1:5001/
curl -I http://127.0.0.1:3456/

# Оба отвечают через nginx/домен
curl -I https://meteo.<домен>/
curl -I https://tasks.<домен>/

# Память в норме, есть запас
free -h

# Диск в норме
df -h /
```

---

## 7. Если начало не хватать памяти

1. Сначала проверьте, кто именно ест память: `htop`, `systemctl status
   metarapp vikunja` (там же видно текущий RSS).
2. Не увеличивайте `GUNICORN_WORKERS` — увеличивайте `GUNICORN_THREADS`
   (`Environment="GUNICORN_THREADS=6"` в юните metarapp).
3. Если это Vikunja (обычно вложения/индексация) — смотрите её конфиг
   лимитов, не забирайте память у metarapp снижением его `MemoryMax`, если
   она и так укладывается в лимит.
4. Убедитесь, что swap подключён (`swapon --show`) — см. §1.
5. Если совсем тесно — это тот случай, когда стоит рассмотреть апгрейд RAM,
   а не бесконечную подстройку лимитов на 1 GB.

---

## Чек-лист

- [ ] Проверено, что Vikunja и её порт (`3456` по умолчанию) слушают только `127.0.0.1`
- [ ] Swap-файл создан (или подтверждено, что уже есть)
- [ ] journald ограничен (`SystemMaxUse`)
- [ ] DNS-запись `meteo.<домен>` создана
- [ ] metarapp установлен под отдельным пользователем, `.venv` собран
- [ ] `metarapp.service` создан, включает `MemoryHigh`/`MemoryMax`
- [ ] nginx vhost для `meteo.<домен>` добавлен, не затрагивает конфиг Vikunja
- [ ] `nginx -t` прошёл, `systemctl reload nginx` выполнен (не restart)
- [ ] SSL выпущен для нового поддомена
- [ ] `free -h` и `df -h` проверены после запуска — есть запас
- [ ] Оба сервиса отвечают: `curl` локально и через домен для metarapp и Vikunja
