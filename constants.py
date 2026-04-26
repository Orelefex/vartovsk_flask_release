"""
Константы и справочные данные для декодирования METAR/TAF
Этот модуль содержит все словари перевода, которые используются
в metar_decoder.py и taf_decoder.py
"""

# Словари для перевода погодных явлений
WEATHER_TRANSLATION = {
    'DZ': 'морось', 'RA': 'дождь', 'SN': 'снег', 'SG': 'снежные зёрна',
    'IC': 'ледяные кристаллы', 'PL': 'ледяной дождь', 'GR': 'град',
    'GS': 'мелкий град/ледяная крупа', 'UP': 'неизвестные осадки',
    'BR': 'дымка', 'FG': 'туман', 'FU': 'дым', 'VA': 'вулканический пепел',
    'DU': 'пыль', 'SA': 'песок', 'HZ': 'мгла', 'PY': 'брызги', 'SQ': 'шквалы',
    'FC': 'смерч/воронка', 'SS': 'песчаная буря', 'DS': 'пыльная буря',
    # Комбинированные явления
    'SNRA': 'снег с дождём', 'RASN': 'дождь со снегом',
    'SNPL': 'снег с ледяным дождём', 'DZRA': 'морось с дождём',
    'RADZ': 'дождь с моросью', 'SNDZ': 'снег с моросью',
    'SHSN': 'ливневой снег', 'SHRA': 'ливневой дождь', 'SHGR': 'ливневой град',
    'SHGS': 'ливневая ледяная крупа', 'SHPL': 'ливневой ледяной дождь',
    'SHSNRA': 'ливневой снег с дождём', 'SHRASN': 'ливневой дождь со снегом'
}

WEATHER_INTENSITY = {
    '-': 'слабый', '+': 'сильный', None: ''
}

WEATHER_DESC = {
    'MI': 'местами', 'PR': 'частичный', 'BC': 'область', 'DR': 'низовой',
    'BL': 'метель', 'SH': 'ливневый', 'TS': 'гроза', 'FZ': 'переохлаждённый',
    'VC': 'в окрестностях'
}

CLOUD_TRANSLATION = {
    'SKC': 'ясно', 'CLR': 'ясно (авто)', 'NSC': 'нет значимой облачности',
    'CAVOK': 'CAVOK',
    'FEW': 'малооблачно (1-3 балла)', 'SCT': 'рассеянные облака (3-6 балла)',
    'BKN': 'разорванные облака (6-9 баллов)', 'OVC': 'сплошная облачность (10 баллов)',
    'VV': 'вертикальная видимость'
}

CLOUD_QUAL = {
    'CB': 'кучево-дождевые', 'TCU': 'мощно-кучевые',
    'None': 'кучево-дождевой облачности нет'
}

TREND_TRANSLATION = {
    'BECMG': 'Ожидается изменение условий',
    'TEMPO': 'Прогноз на 3 часа',
    'PROB30': 'вероятность 30%',
    'PROB40': 'вероятность 40%',
    'NOSIG': 'Прогноз без изменений'
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

# Единицы измерения
WIND_UNITS = {
    'KT': 'узлы',
    'MPS': 'м/с',
    'KMH': 'км/ч'
}

# RVR тенденции
RVR_TREND = {
    'U': 'увеличивается',
    'D': 'уменьшается',
    'N': 'без изменений'
}

# Творительный падеж для погодных явлений (используется в грамматике)
INSTRUMENTAL_CASE = {
    'дождь': 'дождём',
    'снег': 'снегом',
    'морось': 'моросью',
    'град': 'градом',
    'туман': 'туманом',
    'дымка': 'дымкой'
}


def translate_weather(weather_dict: dict) -> str:
    """Переводит погодное явление на русский язык с правильной грамматикой"""
    intensity = weather_dict.get('intensity')
    desc = weather_dict.get('desc')
    phenomena = weather_dict.get('phenomena')

    if phenomena in WEATHER_TRANSLATION:
        base = WEATHER_TRANSLATION[phenomena]
    else:
        parts = []
        i = 0
        while i < len(phenomena):
            for length in [2]:
                code = phenomena[i:i+length]
                if code in WEATHER_TRANSLATION:
                    word = WEATHER_TRANSLATION[code]
                    word = INSTRUMENTAL_CASE.get(word, word)
                    parts.append(word)
                    i += length
                    break
            else:
                i += 1
        base = ' с '.join(parts) if parts else phenomena

    if desc:
        if desc == 'TS':
            base_instr = INSTRUMENTAL_CASE.get(base, base)
            if intensity == '+':
                return f"сильная гроза с {base_instr}"
            elif intensity == '-':
                return f"слабая гроза с {base_instr}"
            else:
                return f"гроза с {base_instr}"
        else:
            desc_text = WEATHER_DESC.get(desc, desc)
            if intensity == '+':
                return f"сильный {desc_text} {base}"
            elif intensity == '-':
                return f"слабый {desc_text} {base}"
            else:
                return f"{desc_text} {base}"

    if intensity == '+':
        return f"сильный {base}"
    elif intensity == '-':
        return f"слабый {base}"
    else:
        return base
