"""
Декодер TAF (Terminal Aerodrome Forecast) на Python
Расшифровка аэродромных прогнозов погоды

TAF - это прогноз погоды для аэродрома на срок до 30 часов,
содержащий информацию о ветре, видимости, облачности и погодных явлениях.
"""

import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

# Словари для перевода (используем те же, что и для METAR)
WEATHER_TRANSLATION = {
    'DZ': 'морось', 'RA': 'дождь', 'SN': 'снег', 'SG': 'снежные зёрна', 'IC': 'ледяные кристаллы',
    'PL': 'ледяной дождь', 'GR': 'град', 'GS': 'мелкий град/ледяная крупа', 'UP': 'неизвестные осадки',
    'BR': 'дымка', 'FG': 'туман', 'FU': 'дым', 'VA': 'вулканический пепел', 'DU': 'пыль', 'SA': 'песок',
    'HZ': 'мгла', 'PY': 'брызги', 'SQ': 'шквалы', 'FC': 'смерч/воронка', 'SS': 'песчаная буря', 'DS': 'пыльная буря',
    # Комбинированные явления
    'SNRA': 'снег с дождём', 'RASN': 'дождь со снегом', 'SNPL': 'снег с ледяным дождём',
    'DZRA': 'морось с дождём', 'RADZ': 'дождь с моросью', 'SNDZ': 'снег с моросью',
    'SHSN': 'ливневой снег', 'SHRA': 'ливневой дождь', 'SHGR': 'ливневой град',
    'SHGS': 'ливневая ледяная крупа', 'SHPL': 'ливневой ледяной дождь'
}

WEATHER_INTENSITY = {
    '-': 'слабый', '+': 'сильный', None: ''
}

WEATHER_DESC = {
    'MI': 'местами', 'PR': 'частичный', 'BC': 'область', 'DR': 'низовой', 'BL': 'метель',
    'SH': 'ливневой', 'TS': 'гроза', 'FZ': 'переохлаждённый', 'VC': 'в окрестностях'
}

CLOUD_TRANSLATION = {
    'SKC': 'ясно', 'CLR': 'ясно (авто)', 'NSC': 'нет значимой облачности', 'CAVOK': 'CAVOK',
    'FEW': 'малооблачно (1-3 балла)', 'SCT': 'рассеянные облака (3-6 балла)',
    'BKN': 'разорванные облака (6-9 баллов)', 'OVC': 'сплошная облачность (10 баллов)',
    'VV': 'вертикальная видимость'
}

CLOUD_QUAL = {
    'CB': 'кучево-дождевые', 'TCU': 'мощно-кучевые', 'None': 'кучево-дождевой облачности нет'
}

# Регулярные выражения для TAF
# Поддерживаем два формата:
# 1. Полный: TAF [AMD|COR] ICAO DDHHMMZ DDHH/DDHH
# 2. Краткий: ICAO DDHHMMZ DDHH/DDHH (без слова TAF)
RE_TAF_HEADER = re.compile(r'^(?:TAF\s+)?(AMD|COR)?\s*([A-Z]{4})\s+(\d{6})Z\s+(\d{4})/(\d{4})')
RE_WIND = re.compile(r'(?P<dir>\d{3}|VRB)(?P<speed>\d{2,3})(G(?P<gust>\d{2,3}))?(?P<unit>KT|MPS|KMH)')
RE_VIS_METERS = re.compile(r'\b(\d{4})\b')
RE_VIS_SM = re.compile(r'(\d+)SM')
RE_CAVOK = re.compile(r'\bCAVOK\b')
RE_WEATHER = re.compile(r'(?P<intensity>[-+])?(?P<desc>(MI|PR|BC|DR|BL|SH|TS|FZ|VC)+)?(?P<phenomena>(DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|SQ|FC|SS|DS)+)')
RE_CLOUD = re.compile(r'(SKC|CLR|NSC|FEW|SCT|BKN|OVC|VV)(\d{3})?(CB|TCU)?')
RE_TEMP = re.compile(r'TX(M?\d{2})/(\d{4})Z\s+TN(M?\d{2})/(\d{4})Z')
RE_CHANGE_GROUP = re.compile(r'\b(BECMG|TEMPO|PROB\d{2}|FM\d{6})\b')
RE_TIME_PERIOD = re.compile(r'(\d{4})/(\d{4})')


class TAFDecoder:
    """Декодер TAF прогнозов"""

    def __init__(self):
        pass

    def _translate_weather(self, weather_dict: dict) -> str:
        """Переводит погодное явление на русский язык с правильной грамматикой"""
        intensity = weather_dict.get('intensity')
        desc = weather_dict.get('desc')
        phenomena = weather_dict.get('phenomena')

        # Словарь для перевода в творительный падеж (с чем?)
        instrumental_case = {
            'дождь': 'дождём', 'снег': 'снегом', 'морось': 'моросью',
            'град': 'градом', 'туман': 'туманом', 'дымка': 'дымкой'
        }

        # Сначала пробуем найти комбинированное явление
        if phenomena in WEATHER_TRANSLATION:
            base = WEATHER_TRANSLATION[phenomena]
        else:
            # Если не нашли комбинацию, разбиваем на отдельные явления
            parts = []
            i = 0
            while i < len(phenomena):
                for length in [2]:  # Все коды явлений длиной 2 символа
                    code = phenomena[i:i+length]
                    if code in WEATHER_TRANSLATION:
                        word = WEATHER_TRANSLATION[code]
                        # Применяем творительный падеж для связки "с"
                        word = instrumental_case.get(word, word)
                        parts.append(word)
                        i += length
                        break
                else:
                    i += 1
            base = ' с '.join(parts) if parts else phenomena

        # Обрабатываем дескриптор
        if desc:
            # TS (гроза) обрабатываем особо
            if desc == 'TS':
                # Переводим базовое явление в творительный падеж
                base_instr = instrumental_case.get(base, base)
                if intensity == '+':
                    return f"сильная гроза с {base_instr}"
                elif intensity == '-':
                    return f"слабая гроза с {base_instr}"
                else:
                    return f"гроза с {base_instr}"
            # SH (ливневый) - уже может быть в комбинированном коде
            elif desc == 'SH' and phenomena not in ['SHRA', 'SHSN', 'SHGR', 'SHGS', 'SHPL']:
                desc_text = WEATHER_DESC.get(desc, desc)
                if intensity == '+':
                    return f"сильный {desc_text} {base}"
                elif intensity == '-':
                    return f"слабый {desc_text} {base}"
                else:
                    return f"{desc_text} {base}"
            # Остальные дескрипторы
            else:
                desc_text = WEATHER_DESC.get(desc, desc)
                if intensity == '+':
                    return f"сильный {desc_text} {base}"
                elif intensity == '-':
                    return f"слабый {desc_text} {base}"
                else:
                    return f"{desc_text} {base}"

        # Интенсивность без дескриптора
        if intensity == '+':
            return f"сильный {base}"
        elif intensity == '-':
            return f"слабый {base}"
        else:
            return base

    def decode(self, taf: str) -> dict:
        """
        Декодирует TAF прогноз

        Args:
            taf: строка с TAF прогнозом

        Returns:
            Словарь с расшифрованными данными
        """
        taf = taf.strip()

        result = {
            'raw': taf,
            'station': None,
            'issue_time': None,
            'valid_period': None,
            'amendment': False,
            'correction': False,
            'base_forecast': {},
            'change_groups': [],
            'temperatures': None
        }

        # Проверяем заголовок TAF
        header_match = RE_TAF_HEADER.search(taf)
        if not header_match:
            result['error'] = 'Неверный формат TAF'
            return result

        amendment_cor, station, issue_time, valid_from, valid_to = header_match.groups()

        result['station'] = station
        result['issue_time'] = self._parse_time(issue_time)
        result['valid_period'] = {
            'from': self._parse_validity_time(valid_from),
            'to': self._parse_validity_time(valid_to)
        }

        if amendment_cor:
            if amendment_cor == 'AMD':
                result['amendment'] = True
            elif amendment_cor == 'COR':
                result['correction'] = True

        # Удаляем заголовок из строки
        taf_body = taf[header_match.end():].strip()

        # Разделяем на базовый прогноз и группы изменений
        tokens = taf_body.split()

        # Парсим базовый прогноз
        base_forecast_tokens = []
        i = 0
        while i < len(tokens):
            if RE_CHANGE_GROUP.match(tokens[i]):
                break
            base_forecast_tokens.append(tokens[i])
            i += 1

        result['base_forecast'] = self._parse_forecast_group(base_forecast_tokens)

        # Парсим группы изменений
        change_tokens = tokens[i:]
        result['change_groups'] = self._parse_change_groups(change_tokens)

        # Извлекаем температуры
        temp_match = RE_TEMP.search(taf)
        if temp_match:
            result['temperatures'] = self._parse_temperatures(temp_match)

        return result

    def _parse_time(self, time_str: str) -> dict:
        """Парсит время выпуска TAF"""
        day = int(time_str[:2])
        hour = int(time_str[2:4])
        minute = int(time_str[4:6])
        return {'day': day, 'hour': hour, 'minute': minute}

    def _parse_validity_time(self, time_str: str) -> dict:
        """Парсит время действия прогноза"""
        day = int(time_str[:2])
        hour = int(time_str[2:4])
        return {'day': day, 'hour': hour}

    def _parse_forecast_group(self, tokens: List[str]) -> dict:
        """Парсит группу прогноза (базовую или изменения)"""
        forecast = {
            'wind': None,
            'visibility': None,
            'cavok': False,
            'weather': [],
            'clouds': []
        }

        for token in tokens:
            # Ветер
            wind_match = RE_WIND.match(token)
            if wind_match:
                forecast['wind'] = {
                    'dir': wind_match.group('dir'),
                    'speed': int(wind_match.group('speed')),
                    'gust': int(wind_match.group('gust')) if wind_match.group('gust') else None,
                    'unit': wind_match.group('unit') or 'KT'
                }
                continue

            # CAVOK
            if RE_CAVOK.match(token):
                forecast['cavok'] = True
                forecast['visibility'] = {'meters': 10000, 'cavok': True}
                continue

            # Видимость
            vis_match = RE_VIS_METERS.match(token)
            if vis_match and len(token) == 4:
                vis = int(vis_match.group(1))
                if vis == 9999:
                    vis = 10000
                forecast['visibility'] = {'meters': vis}
                continue

            vis_sm_match = RE_VIS_SM.match(token)
            if vis_sm_match:
                miles = int(vis_sm_match.group(1))
                forecast['visibility'] = {'miles': miles, 'meters': int(miles * 1609)}
                continue

            # Погодные явления
            weather_match = RE_WEATHER.match(token)
            if weather_match:
                forecast['weather'].append(weather_match.groupdict())
                continue

            # Облачность
            cloud_match = RE_CLOUD.match(token)
            if cloud_match:
                groups = cloud_match.groups()
                cloud_data = {
                    'type': groups[0],
                    'height': groups[1],
                    'qual': groups[2]
                }
                if cloud_data['height']:
                    cloud_data['height_m'] = int(cloud_data['height']) * 30
                forecast['clouds'].append(cloud_data)
                continue

        return forecast

    def _parse_change_groups(self, tokens: List[str]) -> List[dict]:
        """Парсит группы изменений (TEMPO, BECMG, FM, PROB)"""
        change_groups = []
        current_group = None
        current_tokens = []
        current_time_period = None
        i = 0

        while i < len(tokens):
            token = tokens[i]
            change_match = RE_CHANGE_GROUP.match(token)

            if change_match:
                # Сохраняем предыдущую группу
                if current_group:
                    group_data = {
                        'type': current_group,
                        'forecast': self._parse_forecast_group(current_tokens)
                    }
                    if current_time_period:
                        group_data['time_period'] = current_time_period
                    change_groups.append(group_data)

                current_group = change_match.group(1)
                current_tokens = []
                current_time_period = None

                # Проверяем, является ли это PROB группой
                if current_group.startswith('PROB'):
                    # Проверяем следующий токен - это может быть TEMPO
                    if i + 1 < len(tokens) and tokens[i + 1] == 'TEMPO':
                        current_group = f"{current_group} TEMPO"
                        i += 1  # Пропускаем следующий токен TEMPO

                # Для FM группы извлекаем время
                if current_group.startswith('FM'):
                    time_str = current_group[2:]
                    change_groups.append({
                        'type': 'FM',
                        'time': self._parse_fm_time(time_str),
                        'forecast': {}
                    })
                    current_group = 'FM_BODY'
                    current_tokens = []
            else:
                # Проверяем, не является ли токен периодом времени для TEMPO/BECMG
                time_period_match = RE_TIME_PERIOD.match(token)
                if time_period_match and current_group and not current_group.startswith('FM'):
                    current_time_period = {
                        'from': self._parse_validity_time(time_period_match.group(1)),
                        'to': self._parse_validity_time(time_period_match.group(2))
                    }
                elif current_group:
                    current_tokens.append(token)

            i += 1

        # Сохраняем последнюю группу
        if current_group and current_tokens:
            if current_group == 'FM_BODY':
                if change_groups and change_groups[-1]['type'] == 'FM':
                    change_groups[-1]['forecast'] = self._parse_forecast_group(current_tokens)
            else:
                group_data = {
                    'type': current_group,
                    'forecast': self._parse_forecast_group(current_tokens)
                }
                if current_time_period:
                    group_data['time_period'] = current_time_period
                change_groups.append(group_data)

        return change_groups

    def _parse_fm_time(self, time_str: str) -> dict:
        """Парсит время для FM группы"""
        day = int(time_str[:2])
        hour = int(time_str[2:4])
        minute = int(time_str[4:6])
        return {'day': day, 'hour': hour, 'minute': minute}

    def _parse_temperatures(self, match) -> dict:
        """Парсит температуры TX/TN"""
        tx_temp = match.group(1)
        tx_time = match.group(2)
        tn_temp = match.group(3)
        tn_time = match.group(4)

        def parse_temp(temp_str):
            if temp_str.startswith('M'):
                return -int(temp_str[1:])
            return int(temp_str)

        return {
            'max_temp': parse_temp(tx_temp),
            'max_time': self._parse_validity_time(tx_time),
            'min_temp': parse_temp(tn_temp),
            'min_time': self._parse_validity_time(tn_time)
        }

    def pretty(self, decoded: dict) -> str:
        """Форматирует расшифрованный TAF в читаемый вид"""
        if decoded.get('error'):
            return f"Ошибка: {decoded['error']}"

        lines = [f"Исходный TAF: {decoded['raw']}\n"]

        # Заголовок
        lines.append(f"Станция: {decoded['station']}")

        issue = decoded['issue_time']
        lines.append(f"Время выпуска: {issue['day']:02d} число, {issue['hour']:02d}:{issue['minute']:02d} UTC")

        valid_from = decoded['valid_period']['from']
        valid_to = decoded['valid_period']['to']
        lines.append(f"Период действия: с {valid_from['day']:02d} {valid_from['hour']:02d}:00 до {valid_to['day']:02d} {valid_to['hour']:02d}:00 UTC")

        if decoded['amendment']:
            lines.append("⚠️ Исправленный прогноз (AMD)")
        if decoded['correction']:
            lines.append("⚠️ Корректировка (COR)")

        # Базовый прогноз
        lines.append("\n=== БАЗОВЫЙ ПРОГНОЗ ===")
        lines.extend(self._format_forecast(decoded['base_forecast']))

        # Температуры
        if decoded['temperatures']:
            temps = decoded['temperatures']
            lines.append(f"\nМаксимальная температура: {temps['max_temp']}°C в {temps['max_time']['day']:02d} {temps['max_time']['hour']:02d}:00 UTC")
            lines.append(f"Минимальная температура: {temps['min_temp']}°C в {temps['min_time']['day']:02d} {temps['min_time']['hour']:02d}:00 UTC")

        # Группы изменений
        if decoded['change_groups']:
            lines.append("\n=== ИЗМЕНЕНИЯ ===")
            for group in decoded['change_groups']:
                lines.append(f"\n{self._format_change_type(group['type'])}:")
                if group['type'] == 'FM' and 'time' in group:
                    t = group['time']
                    lines.append(f"  С {t['day']:02d} {t['hour']:02d}:{t['minute']:02d} UTC")
                elif 'time_period' in group:
                    tp = group['time_period']
                    lines.append(f"  Период: с {tp['from']['day']:02d} {tp['from']['hour']:02d}:00 до {tp['to']['day']:02d} {tp['to']['hour']:02d}:00 UTC")
                lines.extend(['  ' + line for line in self._format_forecast(group['forecast'])])

        return '\n'.join(lines)

    def _format_forecast(self, forecast: dict) -> List[str]:
        """Форматирует данные прогноза"""
        lines = []

        if forecast.get('wind'):
            w = forecast['wind']
            gust = f", порывы {w['gust']}" if w['gust'] else ''
            unit = {'KT': 'узлы', 'MPS': 'м/с', 'KMH': 'км/ч'}.get(w['unit'], w['unit'])
            lines.append(f"Ветер: {w['dir']}° {w['speed']} {unit}{gust}")

        if forecast.get('visibility'):
            vis = forecast['visibility']
            if vis.get('cavok'):
                lines.append("CAVOK (Погода хорошая))")
            elif 'meters' in vis:
                lines.append(f"Видимость: {vis['meters']} м")
            elif 'miles' in vis:
                lines.append(f"Видимость: {vis['miles']} миль")

        if forecast.get('weather'):
            lines.append("Явления:")
            for w in forecast['weather']:
                text = self._translate_weather(w)
                lines.append(f"  - {text}")

        if forecast.get('clouds'):
            lines.append("Облачность:")
            for c in forecast['clouds']:
                ctype = CLOUD_TRANSLATION.get(c['type'], c['type'])
                parts = [ctype]
                if c.get('height_m'):
                    parts.append(f"на {c['height_m']} метров")
                qual = CLOUD_QUAL.get(c.get('qual'), c.get('qual', ''))
                if qual:
                    parts.append(qual)
                lines.append("  - " + " ".join(parts))

        return lines if lines else ["  (нет изменений)"]

    def _format_change_type(self, change_type: str) -> str:
        """Форматирует тип изменения"""
        translations = {
            'BECMG': 'Постепенное изменение (BECMG)',
            'TEMPO': 'Временные изменения (TEMPO)',
            'FM': 'С определенного времени (FM)',
            'PROB30': 'Вероятность 30% (PROB30)',
            'PROB40': 'Вероятность 40% (PROB40)',
            'PROB30 TEMPO': 'Вероятность 30% (PROB30 TEMPO)',
            'PROB40 TEMPO': 'Вероятность 40% (PROB40 TEMPO)'
        }
        return translations.get(change_type, change_type)


if __name__ == "__main__":
    # Примеры TAF для тестирования
    sample_tafs = [
        """EDDH 211100Z 2112/2218 20013KT 9999 BKN020
TEMPO 2112/2120 21015G25KT 4000 SHRA BKN014TCU
BECMG 2116/2118 21008KT
TEMPO 2201/2213 4000 SHRA BKN014TCU
PROB40 TEMPO 2206/2210 BKN008
PROB30 TEMPO 2215/2218 SHRA BKN015TCU
BECMG 2216/2218 19003KT""",
        "ULOO 200500Z 2006/2015 18003MPS 8000 BKN016",  # Краткий формат без слова TAF
        "USRR 211343Z 2115/2215 22003G12MPS 9999 BKN017 TEMPO 2209/2215 -SHSNRA BKN010CB"  # Пример пользователя
    ]

    decoder = TAFDecoder()

    for taf in sample_tafs:
        print("=" * 80)
        decoded = decoder.decode(taf)
        print(decoder.pretty(decoded))
        print()