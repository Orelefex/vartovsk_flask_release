"""
Модуль для парсинга данных с OGIMET (https://ogimet.com)
Поддерживает получение METAR и TAF сообщений
"""

import re
import requests
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple, List, Dict


class OgimetParser:
    """Класс для работы с данными OGIMET"""

    BASE_URL = "https://ogimet.com/display_metars2.php"

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        })

    def fetch_raw_data(self, icao: str, hours: int = 24) -> Optional[str]:
        """
        Получает сырые данные с OGIMET для указанного аэропорта

        Args:
            icao: Код ICAO аэропорта (4 буквы)
            hours: Количество часов назад для запроса (по умолчанию 24)

        Returns:
            Текст ответа от OGIMET или None в случае ошибки
        """
        try:
            now = datetime.now(timezone.utc)
            start_time = now - timedelta(hours=hours)

            params = {
                'lang': 'en',
                'lugar': icao.upper(),
                'tipo': 'ALL',  # METAR + SPECI
                'ord': 'REV',   # Обратный порядок (новые первыми)
                'nil': 'SI',    # Включить NIL отчеты
                'fmt': 'txt',   # Текстовый формат
                'ano': start_time.year,
                'mes': f'{start_time.month:02d}',
                'day': f'{start_time.day:02d}',
                'hora': f'{start_time.hour:02d}',
                'anof': now.year,
                'mesf': f'{now.month:02d}',
                'dayf': f'{now.day:02d}',
                'horaf': f'{now.hour:02d}',
                'minf': f'{now.minute:02d}',
                'send': 'send'
            }

            response = self.session.get(self.BASE_URL, params=params, timeout=15)
            response.raise_for_status()

            # Извлекаем текст из <pre> тега если это HTML
            text = response.text
            if '<pre>' in text and '</pre>' in text:
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(text, 'html.parser')
                pre = soup.find('pre')
                if pre:
                    return pre.get_text()

            return text

        except requests.RequestException as e:
            print(f"Ошибка при запросе к OGIMET для {icao}: {e}")
            return None

    def fetch_raw_data_by_dates(self, icao: str, start_time: datetime, end_time: datetime) -> Optional[str]:
        """
        Получает сырые данные с OGIMET для указанного аэропорта за конкретный период

        Args:
            icao: Код ICAO аэропорта (4 буквы)
            start_time: Начальная дата и время
            end_time: Конечная дата и время

        Returns:
            Текст ответа от OGIMET или None в случае ошибки
        """
        try:
            params = {
                'lang': 'en',
                'lugar': icao.upper(),
                'tipo': 'ALL',  # METAR + SPECI
                'ord': 'REV',   # Обратный порядок (новые первыми)
                'nil': 'SI',    # Включить NIL отчеты
                'fmt': 'txt',   # Текстовый формат
                'ano': start_time.year,
                'mes': f'{start_time.month:02d}',
                'day': f'{start_time.day:02d}',
                'hora': f'{start_time.hour:02d}',
                'anof': end_time.year,
                'mesf': f'{end_time.month:02d}',
                'dayf': f'{end_time.day:02d}',
                'horaf': f'{end_time.hour:02d}',
                'minf': f'{end_time.minute:02d}',
                'send': 'send'
            }

            response = self.session.get(self.BASE_URL, params=params, timeout=15)
            response.raise_for_status()

            # Извлекаем текст из <pre> тега если это HTML
            text = response.text
            if '<pre>' in text and '</pre>' in text:
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(text, 'html.parser')
                pre = soup.find('pre')
                if pre:
                    return pre.get_text()

            return text

        except requests.RequestException as e:
            print(f"Ошибка при запросе к OGIMET для {icao}: {e}")
            return None

    def parse_metars(self, raw_data: str, icao: str) -> List[Dict[str, str]]:
        """
        Парсит METAR сообщения из сырых данных OGIMET

        Args:
            raw_data: Сырой текст ответа от OGIMET
            icao: Код ICAO для фильтрации

        Returns:
            Список словарей с METAR данными
        """
        metars = []

        if not raw_data:
            return metars

        lines = raw_data.split('\n')

        for line in lines:
            line = line.strip()

            # Пропускаем комментарии и пустые строки
            if not line or line.startswith('#'):
                continue

            # Ищем METAR или SPECI
            # Формат OGIMET: YYYYMMDDHHMM METAR ICAO DDHHMMZ ...
            # или: YYYYMMDDHHMM SPECI ICAO DDHHMMZ ...
            match = re.match(
                r'^(\d{12})\s+(METAR|SPECI)\s+(' + re.escape(icao.upper()) + r')\s+(.+)',
                line
            )

            if match:
                timestamp = match.group(1)
                report_type = match.group(2)
                station = match.group(3)
                message = match.group(4).strip()

                # Формируем полное сообщение с кодом станции
                full_message = f"{station} {message}"

                metars.append({
                    'timestamp': timestamp,
                    'type': report_type,
                    'station': station,
                    'message': full_message,
                    'raw_line': line
                })

        return metars

    def parse_tafs(self, raw_data: str, icao: str) -> List[Dict[str, str]]:
        """
        Парсит TAF сообщения из сырых данных OGIMET

        Args:
            raw_data: Сырой текст ответа от OGIMET
            icao: Код ICAO для фильтрации

        Returns:
            Список словарей с TAF данными
        """
        tafs = []

        if not raw_data:
            return tafs

        lines = raw_data.split('\n')
        in_taf_section = False
        current_taf = None
        current_timestamp = None

        for line in lines:
            line_stripped = line.strip()

            # Определяем начало секции TAF
            if '# large TAF from' in line_stripped or '#  large TAF from' in line_stripped:
                in_taf_section = True
                continue

            # Пропускаем до секции large TAF
            if not in_taf_section:
                continue

            # Пропускаем комментарии
            if line_stripped.startswith('#') or not line_stripped:
                continue

            # Ищем начало нового TAF
            # Формат: YYYYMMDDHHMM TAF ICAO DDHHMMZ ...
            match = re.match(
                r'^(\d{12})\s+TAF\s+(' + re.escape(icao.upper()) + r')\s+(.+)',
                line_stripped
            )

            if match:
                # Сохраняем предыдущий TAF если есть
                if current_taf and current_timestamp:
                    tafs.append({
                        'timestamp': current_timestamp,
                        'station': icao.upper(),
                        'message': current_taf.strip(),
                        'full_message': f"{icao.upper()} {current_taf.strip()}"
                    })

                # Начинаем новый TAF
                current_timestamp = match.group(1)
                station = match.group(2)
                message = match.group(3).strip()
                current_taf = message

            # Продолжение TAF (строки с отступом)
            elif current_taf is not None and line.startswith(' '):
                # Строки с отступом - это продолжение TAF
                continuation = line_stripped
                # Удаляем знак = если он есть в конце предыдущей части
                if current_taf.endswith('='):
                    current_taf = current_taf[:-1].rstrip()
                current_taf += ' ' + continuation

        # Сохраняем последний TAF
        if current_taf and current_timestamp:
            tafs.append({
                'timestamp': current_timestamp,
                'station': icao.upper(),
                'message': current_taf.strip(),
                'full_message': f"{icao.upper()} {current_taf.strip()}"
            })

        return tafs

    def get_latest_metar(self, icao: str, hours: int = 24) -> Optional[str]:
        """
        Получает самый свежий METAR для аэропорта

        Args:
            icao: Код ICAO аэропорта
            hours: Количество часов для поиска

        Returns:
            Строка с METAR или None
        """
        raw_data = self.fetch_raw_data(icao, hours)
        if not raw_data:
            return None

        metars = self.parse_metars(raw_data, icao)

        if not metars:
            return None

        # METAR уже отсортированы по убыванию времени (REV порядок)
        # Берем первый (самый свежий)
        return metars[0]['message']

    def get_metar_history(self, icao: str, hours: int = 12) -> List[Dict[str, str]]:
        """
        Получает историю METAR для аэропорта

        Args:
            icao: Код ICAO аэропорта
            hours: Количество часов для поиска (по умолчанию 12)

        Returns:
            Список словарей с METAR данными, отсортированный по убыванию времени
        """
        raw_data = self.fetch_raw_data(icao, hours)
        if not raw_data:
            return []

        metars = self.parse_metars(raw_data, icao)

        # Возвращаем все METAR (уже отсортированы по убыванию времени)
        return metars

    def get_metar_history_by_dates(self, icao: str, start_time: datetime, end_time: datetime) -> List[Dict[str, str]]:
        """
        Получает историю METAR для аэропорта за конкретный период

        Args:
            icao: Код ICAO аэропорта
            start_time: Начальная дата и время
            end_time: Конечная дата и время

        Returns:
            Список словарей с METAR данными, отсортированный по убыванию времени
        """
        raw_data = self.fetch_raw_data_by_dates(icao, start_time, end_time)
        if not raw_data:
            return []

        metars = self.parse_metars(raw_data, icao)

        # Возвращаем все METAR (уже отсортированы по убыванию времени)
        return metars

    def get_latest_taf(self, icao: str, hours: int = 48) -> Optional[str]:
        """
        Получает самый свежий TAF для аэропорта

        Args:
            icao: Код ICAO аэропорта
            hours: Количество часов для поиска

        Returns:
            Строка с TAF или None
        """
        raw_data = self.fetch_raw_data(icao, hours)
        if not raw_data:
            return None

        tafs = self.parse_tafs(raw_data, icao)

        if not tafs:
            return None

        # TAF уже отсортированы по убыванию времени
        # Берем первый (самый свежий)
        return tafs[0]['full_message']

    def get_taf_history(self, icao: str, hours: int = 48) -> List[Dict[str, str]]:
        """
        Получает историю TAF для аэропорта

        Args:
            icao: Код ICAO аэропорта
            hours: Количество часов для поиска (по умолчанию 48)

        Returns:
            Список словарей с TAF данными, отсортированный по убыванию времени
        """
        raw_data = self.fetch_raw_data(icao, hours)
        if not raw_data:
            return []

        tafs = self.parse_tafs(raw_data, icao)

        # Возвращаем все TAF (уже отсортированы по убыванию времени)
        return tafs

    def get_taf_history_by_dates(self, icao: str, start_time: datetime, end_time: datetime) -> List[Dict[str, str]]:
        """
        Получает историю TAF для аэропорта за конкретный период

        Args:
            icao: Код ICAO аэропорта
            start_time: Начальная дата и время
            end_time: Конечная дата и время

        Returns:
            Список словарей с TAF данными, отсортированный по убыванию времени
        """
        raw_data = self.fetch_raw_data_by_dates(icao, start_time, end_time)
        if not raw_data:
            return []

        tafs = self.parse_tafs(raw_data, icao)

        # Возвращаем все TAF (уже отсортированы по убыванию времени)
        return tafs

    def get_metar_and_taf(self, icao: str) -> Tuple[Optional[str], Optional[str]]:
        """
        Получает и METAR и TAF одним запросом

        Args:
            icao: Код ICAO аэропорта

        Returns:
            Кортеж (metar, taf)
        """
        raw_data = self.fetch_raw_data(icao, hours=48)

        if not raw_data:
            return None, None

        # Парсим METAR
        metars = self.parse_metars(raw_data, icao)
        latest_metar = metars[0]['message'] if metars else None

        # Парсим TAF
        tafs = self.parse_tafs(raw_data, icao)
        latest_taf = tafs[0]['full_message'] if tafs else None

        return latest_metar, latest_taf


# Функции для обратной совместимости
def get_metar_from_ogimet(icao: str) -> Optional[str]:
    """Получить METAR с OGIMET"""
    parser = OgimetParser()
    return parser.get_latest_metar(icao)


def get_taf_from_ogimet(icao: str) -> Optional[str]:
    """Получить TAF с OGIMET"""
    parser = OgimetParser()
    return parser.get_latest_taf(icao)


def get_metar_taf_from_ogimet(icao: str) -> Tuple[Optional[str], Optional[str]]:
    """Получить METAR и TAF с OGIMET одним запросом"""
    parser = OgimetParser()
    return parser.get_metar_and_taf(icao)


if __name__ == "__main__":
    # Тестирование
    parser = OgimetParser()

    test_icao = "USRR"  # Сургут
    print(f"Тестирование парсера OGIMET для {test_icao}...")
    print("=" * 80)

    metar, taf = parser.get_metar_and_taf(test_icao)

    if metar:
        print(f"\n✓ METAR найден:")
        print(metar)
    else:
        print("\n✗ METAR не найден")

    if taf:
        print(f"\n✓ TAF найден:")
        print(taf)
    else:
        print("\n✗ TAF не найден")
