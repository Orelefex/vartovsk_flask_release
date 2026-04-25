"""
Модуль конфигурации для METAR/TAF Decoder
Загружает настройки из переменных окружения с валидацией
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Загружаем .env файл если он существует
env_file = Path(__file__).parent / '.env'
if env_file.exists():
    load_dotenv(env_file)


class Config:
    """Класс конфигурации приложения"""

    # Flask настройки
    FLASK_DEBUG = os.getenv('FLASK_DEBUG', 'false').lower() == 'true'
    FLASK_HOST = os.getenv('FLASK_HOST', '0.0.0.0')
    FLASK_PORT = int(os.getenv('FLASK_PORT', '5001'))

    # Таймауты (секунды)
    REQUESTS_TIMEOUT = int(os.getenv('REQUESTS_TIMEOUT', '15'))
    OGIMET_TIMEOUT = int(os.getenv('OGIMET_TIMEOUT', '15'))
    AVIA_METEO_TIMEOUT = int(os.getenv('AVIA_METEO_TIMEOUT', '5'))
    UWYO_TIMEOUT = int(os.getenv('UWYO_TIMEOUT', '30'))

    # URLs внешних источников
    AVIA_METEO_METAR_URL = os.getenv(
        'AVIA_METEO_METAR_URL',
        'https://www.avia-meteo.ru/data/metar.txt'
    )
    AVIA_METEO_TAF_URL = os.getenv(
        'AVIA_METEO_TAF_URL',
        'https://www.avia-meteo.ru/data/taf.txt'
    )
    OGIMET_BASE_URL = os.getenv(
        'OGIMET_BASE_URL',
        'https://ogimet.com/display_metars2.php'
    )
    UWYO_SOUNDING_URL = os.getenv(
        'UWYO_SOUNDING_URL',
        'https://weather.uwyo.edu/cgi-bin/sounding'
    )

    # Кэширование
    CACHE_ENABLED = os.getenv('CACHE_ENABLED', 'true').lower() == 'true'
    CACHE_TTL_METAR = int(os.getenv('CACHE_TTL_METAR', '300'))  # 5 минут
    CACHE_TTL_TAF = int(os.getenv('CACHE_TTL_TAF', '1800'))     # 30 минут
    CACHE_TTL_SOUNDING = int(os.getenv('CACHE_TTL_SOUNDING', '3600'))  # 1 час
    CACHE_MAX_SIZE = int(os.getenv('CACHE_MAX_SIZE', '1000'))

    # Логирование
    LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO').upper()
    LOG_FILE = os.getenv('LOG_FILE', 'logs/metar_app.log')
    LOG_FORMAT = os.getenv(
        'LOG_FORMAT',
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    # Файлы данных
    ICAO_CSV_FILE = os.getenv('ICAO_CSV_FILE', 'ICAO.csv')
    AERO_STATIONS_FILE = os.getenv('AERO_STATIONS_FILE', 'aero_index.json')

    @classmethod
    def validate(cls):
        """
        Проверка валидности конфигурации

        Returns:
            list: список ошибок валидации (пустой если все ок)
        """
        errors = []

        # Проверяем порт
        if not (1024 <= cls.FLASK_PORT <= 65535):
            errors.append(
                f"FLASK_PORT должен быть в диапазоне 1024-65535, получено: {cls.FLASK_PORT}"
            )

        # Проверяем таймауты
        if cls.REQUESTS_TIMEOUT <= 0:
            errors.append(
                f"REQUESTS_TIMEOUT должен быть положительным, получено: {cls.REQUESTS_TIMEOUT}"
            )

        # Проверяем уровень логирования
        valid_log_levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']
        if cls.LOG_LEVEL not in valid_log_levels:
            errors.append(
                f"LOG_LEVEL должен быть одним из {valid_log_levels}, получено: {cls.LOG_LEVEL}"
            )

        # Проверяем существование файлов данных
        if not Path(cls.ICAO_CSV_FILE).exists():
            errors.append(f"Файл ICAO_CSV_FILE не найден: {cls.ICAO_CSV_FILE}")

        if not Path(cls.AERO_STATIONS_FILE).exists():
            errors.append(f"Файл AERO_STATIONS_FILE не найден: {cls.AERO_STATIONS_FILE}")

        return errors


# Создаем singleton instance
config = Config()

# Валидируем при импорте (только предупреждения, не блокируем запуск)
validation_errors = config.validate()
if validation_errors:
    import warnings
    for error in validation_errors:
        warnings.warn(f"Ошибка конфигурации: {error}")
