"""
Расширенный декодер METAR на Python, использующий только стандартную библиотеку и регулярные выражения.

Поддержка:
- PROB30/40 с вложенными TEMPO/BECMG
- Сложные значения RVR (тенденции, переменные значения)
- Дополнительные погодные явления
- NIL отчёты
- Замечания RMK: AO1/AO2, давление SLP, температурные группы T
- TREND временные группы (FM, TL, AT)

Вывод переведён на русский язык с расшифровкой явлений, облачности и TREND-групп.
"""

import re
import math
# Словари для перевода кодов
WEATHER_TRANSLATION = {
    'DZ': 'морось', 'RA': 'дождь', 'SN': 'снег', 'SG': 'снежные зёрна', 'IC': 'ледяные кристаллы',
    'PL': 'ледяной дождь', 'GR': 'град', 'GS': 'мелкий град/ледяная крупа', 'UP': 'неизвестные осадки',
    'BR': 'дымка', 'FG': 'туман', 'FU': 'дым', 'VA': 'вулканический пепел', 'DU': 'пыль', 'SA': 'песок',
    'HZ': 'мгла', 'PY': 'брызги', 'SQ': 'шквалы', 'FC': 'смерч/воронка', 'SS': 'песчаная буря', 'DS': 'пыльная буря',
    # Комбинированные явления
    'SNRA': 'снег с дождём', 'RASN': 'дождь со снегом', 'SNPL': 'снег с ледяным дождём',
    'DZRA': 'морось с дождём', 'RADZ': 'дождь с моросью', 'SNDZ': 'снег с моросью',
    'SHSN': 'ливневой снег', 'SHRA': 'ливневой дождь', 'SHGR': 'ливневой град',
    'SHGS': 'ливневая ледяная крупа', 'SHPL': 'ливневой ледяной дождь',
    'SHSNRA': 'ливневой снег с дождём', 'SHRASN': 'ливневой дождь со снегом'
}

WEATHER_INTENSITY = {
    '-': 'слабый', '+': 'сильный', None: ''
}

WEATHER_DESC = {
    'MI': 'местами', 'PR': 'частичный', 'BC': 'область', 'DR': 'низовой', 'BL': 'метель',
    'SH': 'ливневый', 'TS': 'гроза', 'FZ': 'переохлаждённый', 'VC': 'в окрестностях'
}

CLOUD_TRANSLATION = {
    'SKC': 'ясно', 'CLR': 'ясно (авто)', 'NSC': 'нет значимой облачности',
    'FEW': 'малооблачно(1-3 балла)', 'SCT': 'рассеянные облака(3-6 баллов)', 'BKN': 'разорванные облака(6-9 баллов)', 'OVC': 'сплошная облачность(10 баллов)',
    'VV': 'вертикальная видимость'
}

CLOUD_QUAL = {
    'CB': 'кучево-дождевые', 'TCU': 'мощно-кучевые','None':'кучево-дождевой облачности нет'
}

TREND_TRANSLATION = {
    'BECMG': 'Ожидается изменение условий',
    'TEMPO': 'Прогноз на 3 часа',
    'PROB30': 'вероятность 30%',
    'PROB40': 'вероятность 40%',
    'NOSIG':'Прогноз без изменений'
}

RUNWAY_CONTAMINATION_TYPE = {
    '0': 'чистая и сухая',
    '1': 'влажная',
    '2': 'мокрая или лужи',
    '3': 'изморозь или иней',
    '4': 'сухой снег',
    '5': 'мокрый снег',
    '6': 'слякоть',
    '7': 'лёд',
    '8': 'уплотнённый или укатанный снег',
    '9': 'замёрзшие колеи или гребни',
    '/': 'тип не определён'
}

RUNWAY_CONTAMINATION_EXTENT = {
    '1': '10% или менее',
    '2': '11-25%',
    '5': '26-50%',
    '9': '51-100%',
    '/': 'не определена',
    'NR': 'не сообщается'
}

# Регулярные выражения
RE_STATION = re.compile(r'^[A-Z]{4}$')
RE_TIME = re.compile(r'^(\d{2})(\d{2})(\d{2})Z$')
RE_WIND = re.compile(r'^(?P<dir>\d{3}|VRB)(?P<speed>\d{2,3})(G(?P<gust>\d{2,3}))?(?P<unit>KT|MPS|KMH)?$')
RE_WIND_VAR = re.compile(r'^(?P<from>\d{3})V(?P<to>\d{3})$')
RE_VIS_METERS = re.compile(r'^(?P<vis>\d{4}|\d{1,4})$')
RE_VIS_SM = re.compile(r'^(?P<whole>\d+)?(?: )?(?P<num>\d+)?/(?P<den>\d+)?SM$')
RE_RUNWAY_CONDITION = re.compile(r'^R(?P<runway>\d{2}[LCR]?)/(?P<type>\d|/)(?P<extent>\d|/|NR)(?P<depth>\d{2}|//)(?P<friction>\d{2})$')
RE_RVR = re.compile(r'^R(?P<runway>\d{2}[LCR]?)/(?P<vis>[PM]?\d{3,4})(?:V(?P<max>[PM]?\d{4}))?(?P<trend>[UDN])?$')
RE_WEATHER = re.compile(r'^(?P<intensity>[-+])?(?P<desc>(MI|PR|BC|DR|BL|SH|TS|FZ){1,2})?(?P<phenomena>(DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|SQ|FC|SS|DS)+)$')
RE_CLOUD = re.compile(r'^(?P<type>SKC|CLR|NSC|FEW|SCT|BKN|OVC|VV)(?P<height>\d{3})?(?P<qual>CB|TCU)?$')
RE_TEMP_DEW = re.compile(r'^(?P<temp>M?\d{1,2})/(?P<dew>M?\d{1,2})$')
RE_PRESS = re.compile(r'^(?P<prefix>A|Q)(?P<val>\d{4})$')
RE_AUTO = re.compile(r'^AUTO$')
RE_TREND = re.compile(r'^(TEMPO|BECMG|PROB\d{2}|FM\d{4}|TL\d{4}|AT\d{4}|NOSIG)$')
RE_NIL = re.compile(r'^NIL$')

RE_RMK_AO = re.compile(r'^AO[12]$')
RE_RMK_SLP = re.compile(r'^SLP(\d{3})$')
RE_RMK_T = re.compile(r'^T(\d{4})(\d{4})?$')

class MetarDecoder:
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

    def calculate_relative_humidity(self,temperature: float, dew_point: float) -> float:
            """
            Расчет относительной влажности по формуле Магнуса
            RH = 100 * exp((17.625 * Td)/(243.04 + Td)) / exp((17.625 * T)/(243.04 + T))
            Температура и точка росы в градусах Цельсия
            """
            if temperature is None or dew_point is None:
                return None

            # Magnus formula for relative humidity calculation
            numerator = math.exp((17.625 * dew_point) / (243.04 + dew_point))
            denominator = math.exp((17.625 * temperature) / (243.04 + temperature))

            rh = 100 * numerator / denominator
            return round(rh, 1)
    def decode(self, metar: str) -> dict:
        s = metar.strip()
        remarks = ''
        if ' RMK ' in ' ' + s + ' ':
            parts = s.split(' RMK ', 1)
            s = parts[0].strip()
            remarks = parts[1].strip()
        tokens = s.split()

        result = {
            'raw': metar,
            'station': None,
            'time': None,
            'auto': False,
            'nil': False,
            'wind': None,
            'wind_var': None,
            'visibility': None,
            'runway_vis': [],
            'runway_condition': [],
            'weather': [],
            'clouds': [],
            'temp_c': None,
            'dewpoint_c': None,
            'altimeter_hpa': None,
            'altimeter_inhg': None,
            'trends': [],
            'trend_vis':None,
            'trend_weather':[],
            'trend_vngo':[],
            'remarks': remarks,
            'remark_details': {}
        }

        i = 0
        # Пропускаем префикс METAR/SPECI если он есть
        if i < len(tokens) and tokens[i] in ('METAR', 'SPECI'):
            result['report_type'] = tokens[i]
            i += 1

        if i < len(tokens) and RE_STATION.match(tokens[i]):
            result['station'] = tokens[i]
            i += 1

        if i < len(tokens) and RE_TIME.match(tokens[i]):
            m = RE_TIME.match(tokens[i])
            day, hour, minute = m.groups()
            result['time'] = {'day': int(day), 'hour': int(hour), 'minute': int(minute), 'repr': tokens[i]}
            i += 1

        if i < len(tokens) and RE_AUTO.match(tokens[i]):
            result['auto'] = True
            i += 1

        if i < len(tokens) and RE_NIL.match(tokens[i]):
            result['nil'] = True
            return result

        if i < len(tokens) and RE_WIND.match(tokens[i]):
            m = RE_WIND.match(tokens[i])
            wind = {
                'dir': m.group('dir'),
                'speed': int(m.group('speed')),
                'gust': int(m.group('gust')) if m.group('gust') else None,
                'unit': m.group('unit') or 'KT' or 'MPS'
            }
            result['wind'] = wind
            i += 1
            if i < len(tokens) and RE_WIND_VAR.match(tokens[i]):
                vm = RE_WIND_VAR.match(tokens[i])
                result['wind_var'] = {'from': int(vm.group('from')), 'to': int(vm.group('to'))}
                i += 1

        # --- видимость, RVR ---
        if i < len(tokens):
            if tokens[i] == 'CAVOK':
                result['visibility'] = {'meters': 10000, 'cavok': True}
                result['clouds'] = []
                i += 1
            elif RE_VIS_METERS.match(tokens[i]) or RE_VIS_SM.match(tokens[i]):
                if RE_VIS_METERS.match(tokens[i]):
                    m = RE_VIS_METERS.match(tokens[i])
                    vis = int(m.group('vis'))
                    if vis == 9999:
                        vis = 10000
                    result['visibility'] = {'meters': vis}
                    i += 1
                elif RE_VIS_SM.match(tokens[i]):
                    m = RE_VIS_SM.match(tokens[i])
                    whole = int(m.group('whole')) if m.group('whole') else 0
                    frac = int(m.group('num'))/int(m.group('den')) if m.group('num') else 0
                    miles = whole + frac
                    meters = round(miles * 1609.344)
                    result['visibility'] = {'miles': miles, 'meters': meters}
                    i += 1

        # --- остальная расшифровка ---
        while i < len(tokens):
            t = tokens[i]
            # Проверяем состояние ВПП ПЕРЕД RVR (чтобы не путать R21/39//32 с RVR)
            if RE_RUNWAY_CONDITION.match(t):
                m = RE_RUNWAY_CONDITION.match(t)
                rc = {
                    'runway': m.group('runway'),
                    'type': m.group('type'),
                    'extent': m.group('extent'),
                    'depth': m.group('depth'),
                    'friction': m.group('friction')
                }
                result['runway_condition'].append(rc)
                i += 1
                continue
            # Проверяем RVR (может быть где угодно)
            if RE_RVR.match(t):
                rm = RE_RVR.match(t)
                r = {
                    'runway': rm.group('runway'),
                    'min': rm.group('vis'),
                    'max': rm.group('max'),
                    'trend': rm.group('trend')
                }
                result['runway_vis'].append(r)
                i += 1
                continue
            if RE_WEATHER.match(t) and not result.get('trends'):
                w = RE_WEATHER.match(tokens[i]).groupdict()
                result['weather'].append(w)
                i += 1
                continue
            if RE_CLOUD.match(t) and not result.get('trends'):
                m = RE_CLOUD.match(t)
                grp = m.groupdict()
                if grp.get('height'):
                    grp['height_ft'] = int(grp['height']) * 30
                result['clouds'].append(grp)
                i += 1
                continue
            if RE_TEMP_DEW.match(t):
                m = RE_TEMP_DEW.match(t)
                def conv(v):
                    neg = v.startswith('M')
                    val = int(v[1:]) if neg else int(v)
                    return -val if neg else val
                result['temp_c'] = conv(m.group('temp'))
                result['dewpoint_c'] = conv(m.group('dew'))
                 # Добавляем расчет относительной влажности
                if result['temp_c'] is not None and result['dewpoint_c'] is not None:
                    result['relative_humidity'] = self.calculate_relative_humidity(
                    result['temp_c'],
                    result['dewpoint_c']
                    )
                i += 1
                continue
            if RE_PRESS.match(t):
                m = RE_PRESS.match(t)
                pref, val = m.group('prefix'), m.group('val')
                if pref == 'A':
                    inhg = float(val)/100.0
                    result['altimeter_inhg'] = inhg
                    result['altimeter_hpa'] = round(inhg * 33.8639, 1)
                else:
                    hpa = int(val)
                    result['altimeter_hpa'] = hpa
                    result['altimeter_inhg'] = round((hpa*3)/4, 2)
                i += 1
                continue
            if RE_TREND.match(t):
                trend_type = t
                result['trends'].append({'type': trend_type})
                i += 1
                continue  # i уже увеличен, продолжаем
            if RE_VIS_METERS.match(t):
                tr=RE_VIS_METERS.match(tokens[i])
                vis = int(tr.group('vis'))
                if vis == 9999:
                    vis = 10000
                result['trend_vis'] = {'meters': vis}
                i += 1
                continue
            if RE_WEATHER.match(t) and result.get('trends'):
                wet = RE_WEATHER.match(tokens[i]).groupdict()
                result['trend_weather'].append(wet)
                i += 1
                continue
            if RE_CLOUD.match(t) and result.get('trends'):
                m = RE_CLOUD.match(t)
                grp = m.groupdict()
                if grp.get('height'):
                    grp['height_ft'] = int(grp['height']) * 30
                result['trend_vngo'].append(grp)
                i += 1
                continue
            result.setdefault('unparsed', []).append(t)
            i += 1
        # --- разбор RMK ---
        if remarks:
            r_tokens = remarks.split()
            for rt in r_tokens:
                if RE_RMK_AO.match(rt):
                    result['remark_details']['тип станции'] = rt
                elif RE_RMK_SLP.match(rt):
                    val = RE_RMK_SLP.match(rt).group(1)
                    slp = 1000 + int(val)/10.0 if int(val) < 500 else 900 + int(val)/10.0
                    result['remark_details']['давление на уровне моря (гПа)'] = slp
                elif RE_RMK_T.match(rt):
                    parts = RE_RMK_T.match(rt).groups()
                    temps = []
                    for p in parts:
                        if p:
                            sign = -1 if p[0] == '1' else 1
                            temp = sign * (int(p[1:3]) + int(p[3])/10.0)
                            temps.append(temp)
                    result['remark_details']['дополнительные температуры'] = temps
        return result
        
    def pretty(self, decoded: dict) -> str:
        lines = [f"Исходный METAR: {decoded.get('raw')},"]
        if decoded.get('station'):
            lines.append(f"Станция: {decoded['station']}")
        if decoded.get('time'):
            t = decoded['time']
            lines.append(f"Время: {t['day']:02d} число, {t['hour']:02d}:{t['minute']:02d} UTC")
        if decoded.get('nil'):
            lines.append("Отчёт NIL (данные отсутствуют)")
            return '\n'.join(lines)
        if decoded.get('auto'):
            lines.append('Автоматическое наблюдение')
        if decoded.get('wind'):
            w = decoded['wind']
            gust = f", порывы {w['gust']}" if w['gust'] else ''
            unit = {'KT': 'узлы', 'MPS': 'м/с', 'KMH': 'км/ч'}.get(w['unit'], w['unit'])
            lines.append(f"Ветер: {w['dir']}° {w['speed']} {unit}{gust}")
        if decoded.get('wind_var'):
            lines.append(f"Ветер переменный {decoded['wind_var']['from']}°-{decoded['wind_var']['to']}°")
        if decoded.get('visibility'):
            vis = decoded['visibility']
            if vis.get('cavok'):
                lines.append("CAVOK: (Погода хорошая)")
            elif 'meters' in vis:
                lines.append(f"Видимость: {vis['meters']} м")
            if 'miles' in vis:
                lines.append(f"Видимость: {vis['miles']} миль (~{vis['meters']} м)")
        for rvr in decoded.get('runway_vis', []):
            vis_value = rvr['min']
            # Обработка специальных форматов RVR
            if '//' in vis_value:
                # Формат типа 12//60 - разделяем
                parts = vis_value.split('//')
                line = f"Дальность видимости на ВПП {rvr['runway']}: {parts[0]} м (данные: {parts[1]})"
            elif len(vis_value) > 4 and vis_value.isdigit():
                # Формат типа 450245 - возможно составное значение
                line = f"Дальность видимости на ВПП {rvr['runway']}: {vis_value} м"
            else:
                # Стандартный формат
                vis_clean = vis_value.replace('P', '>').replace('M', '<')
                line = f"Дальность видимости на ВПП {rvr['runway']}: {vis_clean} м"

            if rvr['max']:
                line += f" до {rvr['max']} м"
            if rvr['trend']:
                trend = {'U': 'увеличивается', 'D': 'уменьшается', 'N': 'без изменений'}.get(rvr['trend'], rvr['trend'])
                line += f" ({trend})"
            lines.append(line)
        for rc in decoded.get('runway_condition', []):
            line = f"Состояние ВПП {rc['runway']}:"
            contamination_type = RUNWAY_CONTAMINATION_TYPE.get(rc['type'], rc['type'])
            extent = RUNWAY_CONTAMINATION_EXTENT.get(rc['extent'], rc['extent'])
            depth = rc['depth']
            friction = rc['friction']

            line += f" {contamination_type}"
            if extent:
                line += f", покрытие {extent}"
            if depth and depth != '00' and depth != '//' and depth != '/':
                line += f", глубина {depth} мм"
            if friction and friction != '//' and friction != '/':
                # Коэффициент трения: 95+ = 0.95+, иначе 0.XX
                if friction.startswith('9') and int(friction) >= 95:
                    line += f", коэффициент сцепления 0.{friction}+"
                else:
                    line += f", коэффициент сцепления 0.{friction}"
            lines.append(line)
        if decoded.get('weather'):
            lines.append("Явления:")
            for w in decoded['weather']:
                text = self._translate_weather(w)
                lines.append(f"  - {text}")
        if decoded.get('clouds'):
            lines.append("Облачность:")
            for c in decoded['clouds']:
                ctype = CLOUD_TRANSLATION.get(c['type'], c['type'])
                qual = CLOUD_QUAL.get(c.get('qual'), c.get('qual',''))
                parts = [ctype]  # список частей строки
                if c.get('height_ft'):
                     parts.append(f"на {c['height_ft']} метров")
                if qual:  
                    parts.append(qual)
                lines.append("  - " + " ".join(parts))
        if decoded.get('temp_c') is not None:
            lines.append(f"Температура {decoded['temp_c']}°C\n Точка росы {decoded['dewpoint_c']}\n Относительная влажность {decoded['relative_humidity']}%")
        if decoded.get('altimeter_hpa'):
            lines.append(f"Давление: {decoded['altimeter_hpa']} гПа ({decoded['altimeter_inhg']} мм рт. ст.)")
        if decoded.get('trends'):
            for tr in decoded['trends']:
                trend_type = tr['type']
                if trend_type in TREND_TRANSLATION:
                    trend_text = TREND_TRANSLATION[trend_type]
                elif trend_type.startswith('FM'):
                    trend_text = f"с {trend_type[2:]} UTC"
                elif trend_type.startswith('TL'):
                    trend_text = f"с {trend_type[2:]} UTC"
                elif trend_type.startswith('AT'):
                    trend_text = f"с {trend_type[2:]} UTC"
                else:
                    trend_text = trend_type
            lines.append(trend_text)
        if decoded.get('trend_vis'):
            vistr = decoded['trend_vis']
            if 'meters' in vistr:
                lines.append(f"Видимость: {vistr['meters']} м")
        if decoded.get('trend_weather'):
            lines.append("Явления:")
            for w in decoded['trend_weather']:
                text = self._translate_weather(w)
                lines.append(f"  - {text}")
        if decoded.get('trend_vngo'):
            lines.append("Облачность:")
            for c in decoded['trend_vngo']:
                ctype = CLOUD_TRANSLATION.get(c['type'], c['type'])
                qual = CLOUD_QUAL.get(c.get('qual'), c.get('qual',''))
                parts = [ctype]
                if c.get('height_ft'):
                    parts.append(f"на {c['height_ft']} метров")
                if qual:
                    parts.append(qual)
                lines.append("  - " + " ".join(parts))
        if decoded.get('remarks'):
            lines.append(f"Замечания: {decoded['remarks']}")
            for k, v in decoded['remark_details'].items():
                lines.append(f"  - {k}: {v}")
        return '\n'.join(lines)


if __name__ == "__main__":
    # Тестовые примеры из USRR (Сургут)
    samples = [
        "METAR USRR 211730Z 23004MPS CAVOK M02/M04 Q1027 R25/12//60 RMK QFE765=",
        "METAR USRR 210230Z 22004MPS 170V240 9999 SCT024 M03/M03 Q1026 R25/32//50 RMK QFE764=",
        "METAR USRR 210200Z 21004MPS 9999 SCT024CB M03/M03 Q1026 R25/32//50 RMK QFE764=",
        "METAR USRR 201800Z 24002MPS 6000 SCT007 BKN025CB M01/M01 Q1024 R25/450245 RMK QFE762=",
        "UUWW 161630Z 22005MPS 9999 BKN007 OVC023 05/04 Q1014 R24/290047 NOSIG"
    ]

    decoder = MetarDecoder()
    for sample in samples:
        print("="*80)
        decoded = decoder.decode(sample)
        print(decoder.pretty(decoded))
        print()
