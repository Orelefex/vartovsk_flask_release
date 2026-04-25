"""
Валидаторы для входных данных API
"""
import re
from datetime import datetime, timezone
from typing import Tuple
from logger_config import setup_logging

logger = setup_logging(__name__)


class ValidationError(Exception):
    """Ошибка валидации входных данных"""
    pass


def validate_icao_code(icao):
    """
    Проверяет и нормализует код ICAO

    Args:
        icao: код ICAO аэропорта

    Returns:
        Нормализованный (uppercase) код ICAO

    Raises:
        ValidationError: если код невалиден
    """
    if not icao:
        raise ValidationError("ICAO код не может быть пустым")

    icao = icao.strip().upper()

    if len(icao) != 4:
        raise ValidationError(f"ICAO код должен содержать 4 символа, получено: {len(icao)}")

    if not icao.isalpha():
        raise ValidationError(f"ICAO код должен содержать только буквы, получено: {icao}")

    logger.debug(f"ICAO код валиден: {icao}")
    return icao


def validate_hours(hours, min_hours=1, max_hours=168):
    """
    Проверяет количество часов для запроса истории

    Args:
        hours: количество часов
        min_hours: минимальное допустимое значение
        max_hours: максимальное допустимое значение (по умолчанию 7 дней)

    Returns:
        Валидированное количество часов

    Raises:
        ValidationError: если значение вне допустимого диапазона
    """
    try:
        hours = int(hours)
    except (TypeError, ValueError):
        raise ValidationError(f"Количество часов должно быть числом, получено: {hours}")

    if hours < min_hours or hours > max_hours:
        raise ValidationError(
            f"Количество часов должно быть в диапазоне {min_hours}-{max_hours}, "
            f"получено: {hours}"
        )

    return hours


def validate_date_range(date_from, date_to, max_range_days=31):
    """
    Проверяет диапазон дат

    Args:
        date_from: начальная дата в формате ISO (YYYY-MM-DDTHH:MM)
        date_to: конечная дата в формате ISO (YYYY-MM-DDTHH:MM)
        max_range_days: максимальный диапазон в днях

    Returns:
        Кортеж (start_datetime, end_datetime) с timezone UTC

    Raises:
        ValidationError: если даты невалидны
    """
    if not date_from or not date_to:
        raise ValidationError("Обе даты (dateFrom и dateTo) должны быть указаны")

    # Парсим даты
    try:
        start_time = datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc)
    except ValueError as e:
        raise ValidationError(
            f"Неверный формат начальной даты: {date_from}. "
            f"Ожидается ISO формат (YYYY-MM-DDTHH:MM)"
        )

    try:
        end_time = datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc)
    except ValueError as e:
        raise ValidationError(
            f"Неверный формат конечной даты: {date_to}. "
            f"Ожидается ISO формат (YYYY-MM-DDTHH:MM)"
        )

    # Проверяем порядок дат
    if end_time <= start_time:
        raise ValidationError("Конечная дата должна быть позже начальной")

    # Проверяем диапазон
    range_days = (end_time - start_time).days
    if range_days > max_range_days:
        raise ValidationError(
            f"Диапазон дат не должен превышать {max_range_days} дней, "
            f"получено: {range_days} дней"
        )

    logger.debug(f"Диапазон дат валиден: {start_time} - {end_time} ({range_days} дней)")
    return start_time, end_time


def validate_station_id(station_id):
    """
    Проверяет код станции радиозондирования

    Args:
        station_id: код станции (обычно 5 цифр)

    Returns:
        Валидированный код станции

    Raises:
        ValidationError: если код невалиден
    """
    if not station_id:
        raise ValidationError("Код станции не может быть пустым")

    station_id = station_id.strip()

    if not station_id.isdigit():
        raise ValidationError(f"Код станции должен содержать только цифры, получено: {station_id}")

    if len(station_id) != 5:
        raise ValidationError(f"Код станции обычно содержит 5 цифр, получено: {len(station_id)}")

    return station_id


def validate_sounding_date(date_str):
    """
    Проверяет формат даты для радиозондирования

    Args:
        date_str: дата в формате YYYYMMDD

    Returns:
        Валидированная строка даты

    Raises:
        ValidationError: если дата невалидна
    """
    if not date_str:
        raise ValidationError("Дата не может быть пустой")

    date_str = date_str.strip()

    if not date_str.isdigit() or len(date_str) != 8:
        raise ValidationError(f"Дата должна быть в формате YYYYMMDD, получено: {date_str}")

    # Проверяем что дата парсится
    try:
        year = int(date_str[:4])
        month = int(date_str[4:6])
        day = int(date_str[6:8])
        datetime(year, month, day)
    except ValueError as e:
        raise ValidationError(f"Невалидная дата: {date_str}. {str(e)}")

    return date_str


def validate_sounding_hour(hour):
    """
    Проверяет срок зондирования

    Args:
        hour: срок зондирования ('00' или '12')

    Returns:
        Валидированный срок

    Raises:
        ValidationError: если срок невалиден
    """
    if hour not in ['00', '12']:
        raise ValidationError(f"Срок зондирования должен быть '00' или '12', получено: {hour}")

    return hour
