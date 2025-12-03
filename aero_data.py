"""
Модуль для работы с данными радиозондирования
Получает данные с University of Wyoming
"""
import json
import requests
import numpy as np
from pathlib import Path


class AeroDataFetcher:
    """Класс для получения и обработки данных радиозондирования"""

    def __init__(self, stations_file='aero_index.json'):
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

            with open(stations_path, 'r', encoding='utf-8') as f:
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

    def fetch_sounding_data(self, station_id, date_str, hour='00'):
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
            region = station_info['region']

            # Парсинг даты
            year = date_str[:4]
            month = date_str[4:6]
            day = date_str[6:8]

            # Формируем URL для University of Wyoming
            url = "https://weather.uwyo.edu/cgi-bin/sounding"
            params = {
                'region': region,
                'TYPE': 'TEXT:LIST',
                'YEAR': year,
                'MONTH': month,
                'FROM': day + hour,
                'TO': day + hour,
                'STNM': station_id
            }

            # Запрос к серверу
            response = requests.get(url, params=params, timeout=30)
            response.raise_for_status()

            # Парсинг данных
            data = self._parse_uwyo_response(response.text)

            if not data:
                return None, f"Не найдены данные зондирования для станции {station_id} на {date_str} {hour}:00 UTC"

            # Добавляем метаданные
            data['station_id'] = station_id
            data['station_name'] = station_info['name']
            data['region'] = region
            data['date_time'] = f"{year}-{month}-{day}T{hour}:00:00Z"

            return data, None

        except requests.exceptions.RequestException as e:
            return None, f"Ошибка запроса к University of Wyoming: {str(e)}"
        except Exception as e:
            return None, f"Ошибка обработки данных: {str(e)}"

    def _parse_uwyo_response(self, text_data):
        """
        Парсит текстовый ответ от University of Wyoming

        Args:
            text_data: текст ответа от сервера

        Returns:
            dict или None: словарь с данными или None если данных нет
        """
        lines = text_data.split('\n')

        pressure = []
        temperature = []
        dewpoint = []
        u_wind = []
        v_wind = []

        data_started = False
        data_found = False

        for line in lines:
            line = line.strip()

            # Ищем заголовок таблицы данных
            if 'PRES   HGHT   TEMP   DWPT   RELH   MIXR   DRCT   SKNT   THTA   THTE   THTV' in line:
                data_started = True
                continue

            if not data_started:
                continue

            # Останавливаемся на конце данных
            if (line.startswith('Station') or
                line.startswith('</PRE>') or
                'Station identifier' in line):
                break

            if not line or line.startswith('-'):
                continue

            # Парсим строку данных
            parts = line.split()
            if len(parts) < 11:
                continue

            try:
                # Извлекаем данные
                p = float(parts[0])  # Давление
                t = float(parts[2]) if parts[2] != '-9999.00' else None  # Температура
                td = float(parts[3]) if parts[3] != '-9999.00' else None  # Точка росы
                wind_dir = float(parts[6]) if parts[6] != '-9999.00' else None  # Направление
                wind_speed = float(parts[7]) if parts[7] != '-9999.00' else None  # Скорость

                # Пропускаем уровни с отсутствующими основными данными
                if t is None or td is None:
                    continue

                pressure.append(p)
                temperature.append(t)
                dewpoint.append(td)
                data_found = True

                # Конвертируем ветер из узлов в км/ч и в компоненты
                if wind_dir is not None and wind_speed is not None:
                    ws_kmh = wind_speed * 1.852  # узлы -> км/ч
                    wd_rad = np.radians(wind_dir)
                    # Метеорологическая конвенция (откуда дует ветер)
                    u = -ws_kmh * np.sin(wd_rad)
                    v = -ws_kmh * np.cos(wd_rad)
                else:
                    u = 0.0
                    v = 0.0

                u_wind.append(u)
                v_wind.append(v)

            except (ValueError, IndexError):
                continue

        # Проверяем достаточность данных
        if not data_found or len(pressure) < 5:
            return None

        return {
            'pressure': pressure,
            'temperature': temperature,
            'dewpoint': dewpoint,
            'u_wind': u_wind,
            'v_wind': v_wind
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
            pressure = np.array(data['pressure'])
            temperature = np.array(data['temperature'])
            dewpoint = np.array(data['dewpoint'])

            indices = {}

            # Функция для интерполяции значений на заданном уровне давления
            def get_value_at_level(p_level, values):
                if p_level in pressure:
                    idx = np.where(pressure == p_level)[0][0]
                    return values[idx]
                # Линейная интерполяция
                if p_level > pressure.max() or p_level < pressure.min():
                    return None
                idx = np.searchsorted(pressure[::-1], p_level)
                if idx == 0 or idx >= len(pressure):
                    return None
                p1, p2 = pressure[::-1][idx-1], pressure[::-1][idx]
                v1, v2 = values[::-1][idx-1], values[::-1][idx]
                return v1 + (v2 - v1) * (p_level - p1) / (p2 - p1)

            # Индекс Фауста (Faust Index)
            # FI = T850 - T500
            # Оценка: < 24°C - устойчиво, 24-28°C - слабая неустойчивость,
            # 28-32°C - умеренная, > 32°C - сильная неустойчивость
            t850 = get_value_at_level(850, temperature)
            t500 = get_value_at_level(500, temperature)

            if t850 is not None and t500 is not None:
                faust_index = t850 - t500
                indices['faust'] = round(faust_index, 1)

                # Оценка индекса Фауста
                if faust_index < 24:
                    indices['faust_rating'] = 'Устойчиво'
                    indices['faust_color'] = '#4CAF50'  # зеленый
                elif faust_index < 28:
                    indices['faust_rating'] = 'Слабая неустойчивость'
                    indices['faust_color'] = '#FFC107'  # желтый
                elif faust_index < 32:
                    indices['faust_rating'] = 'Умеренная неустойчивость'
                    indices['faust_color'] = '#FF9800'  # оранжевый
                else:
                    indices['faust_rating'] = 'Сильная неустойчивость'
                    indices['faust_color'] = '#F44336'  # красный

            # Индекс Вайтинга (Whiting Index)
            # WI = T850 - T500 - (Td850 - 10)
            # где Td850 - точка росы на 850 гПа
            # Оценка: < -3 - конвекция маловероятна, -3...0 - слабая вероятность,
            # 0...4 - умеренная, > 4 - высокая вероятность гроз
            td850 = get_value_at_level(850, dewpoint)

            if t850 is not None and t500 is not None and td850 is not None:
                whiting_index = (t850 - t500) - (td850 - 10)
                indices['whiting'] = round(whiting_index, 1)

                # Оценка индекса Вайтинга
                if whiting_index < -3:
                    indices['whiting_rating'] = 'Конвекция маловероятна'
                    indices['whiting_color'] = '#4CAF50'  # зеленый
                elif whiting_index < 0:
                    indices['whiting_rating'] = 'Слабая вероятность'
                    indices['whiting_color'] = '#8BC34A'  # светло-зеленый
                elif whiting_index < 4:
                    indices['whiting_rating'] = 'Умеренная вероятность гроз'
                    indices['whiting_color'] = '#FF9800'  # оранжевый
                else:
                    indices['whiting_rating'] = 'Высокая вероятность гроз'
                    indices['whiting_color'] = '#F44336'  # красный

            # Добавим также базовые параметры для информации
            t850_val = get_value_at_level(850, temperature)
            t500_val = get_value_at_level(500, temperature)
            td850_val = get_value_at_level(850, dewpoint)

            if t850_val is not None:
                indices['t850'] = round(t850_val, 1)
            if t500_val is not None:
                indices['t500'] = round(t500_val, 1)
            if td850_val is not None:
                indices['td850'] = round(td850_val, 1)

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


def fetch_sounding(station_id, date_str, hour='00'):
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
