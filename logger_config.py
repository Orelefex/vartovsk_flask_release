"""
Настройка логирования для METAR/TAF Decoder
"""
import logging
import sys
from pathlib import Path
from logging.handlers import RotatingFileHandler

# Импортируем конфиг, но избегаем циркулярных импортов
try:
    from config import config
except ImportError:
    # Fallback на дефолтные значения если config еще не загружен
    class FallbackConfig:
        LOG_LEVEL = 'INFO'
        LOG_FILE = 'logs/metar_app.log'
        LOG_FORMAT = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    config = FallbackConfig()


def setup_logging(name):
    """
    Создает и настраивает logger для модуля

    Args:
        name: имя модуля (обычно __name__)

    Returns:
        Настроенный logger
    """
    logger = logging.getLogger(name)

    # Избегаем дублирования handlers при повторных вызовах
    if logger.handlers:
        return logger

    logger.setLevel(getattr(logging, config.LOG_LEVEL))

    # Formatter
    formatter = logging.Formatter(config.LOG_FORMAT)

    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    # File handler (с ротацией)
    log_file_path = Path(config.LOG_FILE)
    log_file_path.parent.mkdir(parents=True, exist_ok=True)

    file_handler = RotatingFileHandler(
        log_file_path,
        maxBytes=10 * 1024 * 1024,  # 10 MB
        backupCount=5,
        encoding='utf-8'
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    return logger


# Создаем базовый logger для приложения
app_logger = setup_logging('metar_app')
