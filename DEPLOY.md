# Деплой обновления на сервер

## Что изменилось

| Файл | Статус |
|------|--------|
| `visit_tracker.py` | **новый** |
| `templates/stats.html` | **новый** |
| `metar_web_app.py` | изменён |
| `aero_data.py` | изменён |
| `metar_decoder.py` | изменён |
| `taf_decoder.py` | изменён |
| `constants.py` | изменён |
| `static/js/aero.js` | изменён |
| `templates/index.html` | изменён |
| `templates/aero.html` | изменён |
| `templates/archive.html` | изменён |

**Новых зависимостей нет.** `visits.db` создаётся автоматически при первом запуске.

---

## 1. Загрузка файлов на сервер

### Вариант A — через Git (рекомендуется)

```bash
# На сервере, в папке проекта:
git pull origin main
```

### Вариант B — rsync вручную

```bash
# С локальной машины:
rsync -avz --exclude='.venv' --exclude='*.db' --exclude='__pycache__' \
  /путь/к/vartovsk_flask_release/ \
  user@server:/путь/на/сервере/
```

> `--exclude='*.db'` — не перезаписывать `metar_history.db` на сервере.

---

## 2. Перезапуск приложения

### Если запущено через systemd

```bash
sudo systemctl restart <имя-сервиса>
sudo systemctl status  <имя-сервиса>
```

### Если через supervisor

```bash
sudo supervisorctl restart <имя-процесса>
```

### Если запускается вручную (uv)

```bash
pkill -f metar_web_app.py
cd /путь/на/сервере
uv run python metar_web_app.py &
```

---

## 3. Проверка после деплоя

```bash
# Сайт отвечает
curl -I http://localhost:5001/

# visits.db создался
ls -lh visits.db

# Страница статистики работает
curl -s http://localhost:5001/stats | grep -c "Статистика"
```

---

## Откат при проблемах

```bash
# Git
git revert HEAD --no-edit && sudo systemctl restart <сервис>

# Или вернуть конкретный файл
git checkout HEAD~1 -- metar_web_app.py
```
