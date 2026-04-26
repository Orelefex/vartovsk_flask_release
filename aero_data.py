"""
Модуль для работы с данными радиозондирования
Получает данные с University of Wyoming
"""

import json
from pathlib import Path

import numpy as np
import requests


class AeroDataFetcher:
    """Класс для получения и обработки данных радиозондирования"""

    def __init__(self, stations_file="aero_index.json"):
        """
        Инициализация

        Args:
            stations_file: путь к JSON файлу со станциями
        """
        self.stations_file = stations_file
        self.stations = self._load_stations()

    def _load_stations(self):
        """Загружает список станций радиозондирования из JSON-файла"""
        try:
            stations_path = Path(self.stations_file)
            if not stations_path.exists():
                print(f"Предупреждение: Файл '{self.stations_file}' не найден.")
                return {}

            with open(stations_path, "r", encoding="utf-8") as f:
                stations = json.load(f)
            return stations
        except Exception as e:
            print(f"Ошибка при загрузке станций: {e}")
            return {}

    def get_stations(self):
        """
        Возвращает словарь всех доступных станций

        Returns:
            dict: {station_id: {name, region}}
        """
        return self.stations

    def fetch_sounding_data(self, station_id, date_str, hour="00"):
        """
        Получает данные радиозондирования с University of Wyoming

        Args:
            station_id: код станции (например, '26063')
            date_str: дата в формате YYYYMMDD
            hour: срок зондирования ('00' или '12')

        Returns:
            tuple: (data_dict, error_message)
                data_dict содержит:
                    - pressure: список давлений (гПа)
                    - temperature: список температур (°C)
                    - dewpoint: список точек росы (°C)
                    - u_wind: компонента ветра U (м/с)
                    - v_wind: компонента ветра V (м/с)
                    - station_id: код станции
                    - station_name: название станции
                    - date_time: дата и время в формате ISO
        """
        try:
            # Проверка существования станции
            if station_id not in self.stations:
                return None, f"Станция {station_id} не найдена в базе данных"

            station_info = self.stations[station_id]
            region = station_info["region"]

            # Парсинг даты
            year = date_str[:4]
            month = date_str[4:6]
            day = date_str[6:8]

            # Формируем URL для University of Wyoming
            url = "https://weather.uwyo.edu/cgi-bin/sounding"
            params = {
                "region": region,
                "TYPE": "TEXT:LIST",
                "YEAR": year,
                "MONTH": month,
                "FROM": day + hour,
                "TO": day + hour,
                "STNM": station_id,
            }

            # Запрос к серверу
            response = requests.get(url, params=params, timeout=30)
            response.raise_for_status()

            # Парсинг данных
            data = self._parse_uwyo_response(response.text)

            if not data:
                return (
                    None,
                    f"Не найдены данные зондирования для станции {station_id} на {date_str} {hour}:00 UTC",
                )

            # Добавляем метаданные
            data["station_id"] = station_id
            data["station_name"] = station_info["name"]
            data["region"] = region
            data["date_time"] = f"{year}-{month}-{day}T{hour}:00:00Z"

            return data, None

        except requests.exceptions.RequestException as e:
            return None, f"Ошибка запроса к University of Wyoming: {str(e)}"
        except Exception as e:
            return None, f"Ошибка обработки данных: {str(e)}"

    def _parse_uwyo_response(self, text_data):
        lines = text_data.split("\n")

        pressure = []
        height = []  # НОВОЕ: высота в метрах
        temperature = []
        dewpoint = []
        u_wind = []
        v_wind = []

        data_started = False
        data_found = False

        for line in lines:
            line = line.strip()

            if (
                "PRES   HGHT   TEMP   DWPT   RELH   MIXR   DRCT   SKNT   THTA   THTE   THTV"
                in line
            ):
                data_started = True
                continue

            if not data_started:
                continue

            if (
                line.startswith("Station")
                or line.startswith("</PRE>")
                or "Station identifier" in line
            ):
                break

            if not line or line.startswith("-"):
                continue

            parts = line.split()
            if len(parts) < 11:
                continue

            try:
                p = float(parts[0])
                h = float(parts[1]) if parts[1] != "-9999.00" else None  # НОВОЕ
                t = float(parts[2]) if parts[2] != "-9999.00" else None
                td = float(parts[3]) if parts[3] != "-9999.00" else None
                wind_dir = float(parts[6]) if parts[6] != "-9999.00" else None
                wind_speed = float(parts[7]) if parts[7] != "-9999.00" else None

                if t is None or td is None:
                    continue

                pressure.append(p)
                height.append(h)  # НОВОЕ
                temperature.append(t)
                dewpoint.append(td)
                data_found = True

                if wind_dir is not None and wind_speed is not None:
                    ws_kmh = wind_speed * 1.852
                    wd_rad = np.radians(wind_dir)
                    u = -ws_kmh * np.sin(wd_rad)
                    v = -ws_kmh * np.cos(wd_rad)
                else:
                    u = 0.0
                    v = 0.0

                u_wind.append(u)
                v_wind.append(v)

            except (ValueError, IndexError):
                continue

        if not data_found or len(pressure) < 5:
            return None

        return {
            "pressure": pressure,
            "height": height,  # НОВОЕ
            "temperature": temperature,
            "dewpoint": dewpoint,
            "u_wind": u_wind,
            "v_wind": v_wind,
        }

    def calculate_wind_speed_direction(self, u_wind, v_wind):
        """
        Вычисляет скорость и направление ветра из компонент

        Args:
            u_wind: список компонент U (км/ч)
            v_wind: список компонент V (км/ч)

        Returns:
            tuple: (speeds, directions) в км/ч и градусах
        """
        speeds = []
        directions = []

        for u, v in zip(u_wind, v_wind):
            # Скорость в км/ч (компоненты уже в км/ч)
            speed = np.sqrt(u**2 + v**2)
            speeds.append(speed)

            # Направление (откуда дует)
            direction = (np.degrees(np.arctan2(u, v)) + 180) % 360
            directions.append(direction)

        return speeds, directions

    def calculate_stability_indices(self, data):
        """
        Рассчитывает индексы неустойчивости атмосферы

        Args:
            data: словарь с данными радиозондирования

        Returns:
            dict: словарь с рассчитанными индексами
        """
        try:
            pressure = np.array(data["pressure"])
            temperature = np.array(data["temperature"])
            dewpoint = np.array(data["dewpoint"])

            indices = {}

            def get_value_at_level(p_level, values, max_gap_hpa=250):
                # Ищем уровень с допуском ±0.5 гПа (избегаем float-сравнения)
                close = np.where(np.abs(pressure - p_level) <= 0.5)[0]
                if len(close) > 0:
                    return values[close[0]]
                if p_level > pressure.max() or p_level < pressure.min():
                    return None
                # Интерполяция по log(P) — температура линейна по высоте, не по P
                log_p = np.log(pressure[::-1])
                log_target = np.log(p_level)
                idx = np.searchsorted(log_p, log_target)
                if idx == 0 or idx >= len(pressure):
                    return None
                p1, p2 = pressure[::-1][idx - 1], pressure[::-1][idx]
                # Если уровни слишком далеко — интерполяция ненадёжна
                if abs(p1 - p2) > max_gap_hpa:
                    return None
                v1, v2 = values[::-1][idx - 1], values[::-1][idx]
                lp1, lp2 = np.log(p1), np.log(p2)
                return v1 + (v2 - v1) * (log_target - lp1) / (lp2 - lp1)

            # Интерполируем все нужные уровни один раз
            t850 = get_value_at_level(850, temperature)
            t700 = get_value_at_level(700, temperature)
            t500 = get_value_at_level(500, temperature)
            td850 = get_value_at_level(850, dewpoint)
            td700 = get_value_at_level(700, dewpoint)

            # Базовые параметры уровней
            if t850 is not None:
                indices["t850"] = round(t850, 1)
            if t700 is not None:
                indices["t700"] = round(t700, 1)
            if t500 is not None:
                indices["t500"] = round(t500, 1)
            if td850 is not None:
                indices["td850"] = round(td850, 1)
            if td700 is not None:
                indices["td700"] = round(td700, 1)

            # Индекс Фауста: FI = T850 - T500
            # < 24 — устойчиво, 24-28 — слабая, 28-32 — умеренная, > 32 — сильная
            if t850 is not None and t500 is not None:
                fi = t850 - t500
                indices["faust"] = round(fi, 1)
                if fi < 24:
                    indices["faust_rating"] = "Устойчиво"
                    indices["faust_color"] = "#4CAF50"
                elif fi < 28:
                    indices["faust_rating"] = "Слабая неустойчивость"
                    indices["faust_color"] = "#FFC107"
                elif fi < 32:
                    indices["faust_rating"] = "Умеренная неустойчивость"
                    indices["faust_color"] = "#FF9800"
                else:
                    indices["faust_rating"] = "Сильная неустойчивость"
                    indices["faust_color"] = "#F44336"

            # Индекс Вайтинга: WI = (T850 - T500) - (Td850 - 10)
            # < -3 — маловероятна, -3...0 — слабая, 0...4 — умеренная, > 4 — высокая
            if t850 is not None and t500 is not None and td850 is not None:
                wi = (t850 - t500) - (td850 - 10)
                indices["whiting"] = round(wi, 1)
                if wi < -3:
                    indices["whiting_rating"] = "Конвекция маловероятна"
                    indices["whiting_color"] = "#4CAF50"
                elif wi < 0:
                    indices["whiting_rating"] = "Слабая вероятность"
                    indices["whiting_color"] = "#8BC34A"
                elif wi < 4:
                    indices["whiting_rating"] = "Умеренная вероятность гроз"
                    indices["whiting_color"] = "#FF9800"
                else:
                    indices["whiting_rating"] = "Высокая вероятность гроз"
                    indices["whiting_color"] = "#F44336"

            # K-индекс: K = T850 - T500 + Td850 - (T700 - Td700)
            # < 20 — маловероятна, 20-25 — <20%, 26-30 — 20-40%, 31-35 — 40-60%, > 35 — >60%
            if all(v is not None for v in [t850, t700, t500, td850, td700]):
                ki = t850 - t500 + td850 - (t700 - td700)
                indices["k_index"] = round(ki, 1)
                if ki < 20:
                    indices["k_rating"] = "Гроза маловероятна"
                    indices["k_color"] = "#4CAF50"
                elif ki < 26:
                    indices["k_rating"] = "Слабая вероятность (<20%)"
                    indices["k_color"] = "#8BC34A"
                elif ki < 31:
                    indices["k_rating"] = "Умеренная вероятность (20–40%)"
                    indices["k_color"] = "#FFC107"
                elif ki < 36:
                    indices["k_rating"] = "Высокая вероятность (40–60%)"
                    indices["k_color"] = "#FF9800"
                else:
                    indices["k_rating"] = "Очень высокая вероятность (>60%)"
                    indices["k_color"] = "#F44336"

            # Total Totals: TT = T850 + Td850 - 2·T500
            # < 44 — маловероятна, 44-50 — слабая, 50-55 — умеренная, > 55 — высокая
            if t850 is not None and t500 is not None and td850 is not None:
                tt = t850 + td850 - 2 * t500
                indices["total_totals"] = round(tt, 1)
                if tt < 44:
                    indices["tt_rating"] = "Гроза маловероятна"
                    indices["tt_color"] = "#4CAF50"
                elif tt < 50:
                    indices["tt_rating"] = "Слабая вероятность гроз"
                    indices["tt_color"] = "#FFC107"
                elif tt < 55:
                    indices["tt_rating"] = "Умеренная вероятность гроз"
                    indices["tt_color"] = "#FF9800"
                else:
                    indices["tt_rating"] = "Высокая вероятность гроз"
                    indices["tt_color"] = "#F44336"

            return indices

        except Exception as e:
            print(f"Ошибка при расчете индексов: {e}")
            return {}


# Для удобства создаем singleton instance
_fetcher = None


def get_fetcher():
    """Возвращает singleton instance AeroDataFetcher"""
    global _fetcher
    if _fetcher is None:
        _fetcher = AeroDataFetcher()
    return _fetcher


# Удобные функции для прямого использования
def get_stations():
    """Получить список всех станций"""
    return get_fetcher().get_stations()


def fetch_sounding(station_id, date_str, hour="00"):
    """
    Получить данные радиозондирования

    Args:
        station_id: код станции
        date_str: дата в формате YYYYMMDD
        hour: срок ('00' или '12')

    Returns:
        tuple: (data, error)
    """
    return get_fetcher().fetch_sounding_data(station_id, date_str, hour)
