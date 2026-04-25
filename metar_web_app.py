"""
Flask веб-приложение для декодирования METAR/TAF с автоматической загрузкой данных
и построения аэрологических диаграмм
"""

import csv
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from flask import Flask, jsonify, render_template, request

from aero_data import fetch_sounding, get_stations
from config import config
from history_storage import get_cached, get_history_range, init_db, save_records
from logger_config import setup_logging
from metar_decoder import MetarDecoder
from ogimet_parser import OgimetParser
from taf_decoder import TAFDecoder
from validators import validate_date_range

logger = setup_logging(__name__)

app = Flask(__name__)
init_db()
metar_decoder = MetarDecoder()
taf_decoder = TAFDecoder()
ogimet_parser = OgimetParser()

SEARCH_RESULTS_LIMIT = 10


# --- Вспомогательные функции ---


def _get_time_from_report(report):
    """Извлекает время (день и час) из METAR/TAF отчета"""
    if not isinstance(report, str):
        return -1, -1
    match = re.search(r"\s(\d{2})(\d{2})(\d{2})Z", report)
    if match:
        day = int(match.group(1))
        hour = int(match.group(2))
        return day, hour
    return -1, -1


def _select_latest_report(reports_dict):
    """
    Выбирает самый свежий отчёт из словаря {источник: отчёт}.
    Возвращает строку отчёта или None.
    """
    if not reports_dict:
        return None

    sources = ["avia-meteo", "ogimet"]
    latest_time = (-1, -1)
    latest_source = None

    for source in sources:
        if reports_dict.get(source):
            day, hour = _get_time_from_report(reports_dict[source])
            current_time = (day, hour)
            if current_time > latest_time:
                latest_time = current_time
                latest_source = source

    if latest_source:
        return reports_dict[latest_source]

    # Fallback: вернуть первый доступный
    for source in sources:
        if reports_dict.get(source):
            return reports_dict[source]

    return None


def _decode_metar_history(metars):
    """Декодирует список METAR-отчётов, возвращает список словарей."""
    history = []
    for metar_data in metars:
        try:
            decoded = metar_decoder.decode(metar_data["message"])
            pretty = metar_decoder.pretty(decoded)
            history.append(
                {
                    "timestamp": metar_data["timestamp"],
                    "type": metar_data["type"],
                    "raw": metar_data["message"],
                    "decoded": decoded,
                    "pretty": pretty,
                }
            )
        except Exception as e:
            logger.warning(
                "Ошибка декодирования METAR %s: %s", metar_data["message"], e
            )
            continue
    return history


def _decode_taf_history(tafs):
    """Декодирует список TAF-отчётов, возвращает список словарей."""
    history = []
    for taf_data in tafs:
        try:
            decoded = taf_decoder.decode(taf_data["full_message"])
            pretty = taf_decoder.pretty(decoded)
            history.append(
                {
                    "timestamp": taf_data["timestamp"],
                    "raw": taf_data["full_message"],
                    "decoded": decoded,
                    "pretty": pretty,
                }
            )
        except Exception as e:
            logger.warning(
                "Ошибка декодирования TAF %s: %s", taf_data["full_message"], e
            )
            continue
    return history


# --- Загрузка данных аэропортов ---


def load_airport_data():
    """Загружает данные аэропортов из ICAO.csv включая курсы ВПП"""
    airport_data = {}
    icao_file = Path(config.ICAO_CSV_FILE)

    if not icao_file.exists():
        return airport_data

    try:
        with open(icao_file, "r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f, delimiter=";")
            for row in reader:
                icao = row.get("icao_code", "").strip()
                name_rus = row.get("name_rus", "").strip()
                runway_headings = row.get("runway_headings", "").strip()

                if icao:
                    airport_data[icao] = {
                        "name": name_rus,
                        "runway_headings": runway_headings,
                    }
    except Exception as e:
        logger.error("Ошибка при загрузке ICAO.csv: %s", e)

    return airport_data


AIRPORT_DATA = load_airport_data()


# --- Получение METAR/TAF ---


def get_metar_taf_from_sources(icao):
    """
    Получает METAR и TAF с внешних источников и выбирает самый свежий
    """
    metar_data = {}
    taf_data = {}

    # Источник 1: avia-meteo.ru
    try:
        response_metar = requests.get(
            config.AVIA_METEO_METAR_URL, timeout=config.AVIA_METEO_TIMEOUT
        )
        if response_metar.status_code == 200:
            for line in response_metar.text.splitlines():
                if line.startswith(icao):
                    metar_data["avia-meteo"] = line
                    break

        # TAF из avia-meteo.ru - собираем полный многострочный TAF
        response_taf = requests.get(
            config.AVIA_METEO_TAF_URL, timeout=config.AVIA_METEO_TIMEOUT
        )
        if response_taf.status_code == 200:
            lines = response_taf.text.splitlines()
            taf_lines = []
            collecting = False
            for line in lines:
                if line.startswith(icao):
                    taf_lines.append(line)
                    collecting = True
                elif collecting and line.startswith(
                    "   "
                ):  # Продолжение TAF (с отступом)
                    taf_lines.append(line.strip())
                elif collecting:
                    break  # Новый TAF для другого аэропорта

            if taf_lines:
                full_taf = " ".join(taf_lines)
                if full_taf.endswith("="):
                    full_taf = full_taf[:-1].strip()
                taf_data["avia-meteo"] = full_taf
    except Exception as e:
        logger.warning("Ошибка avia-meteo.ru для %s: %s", icao, e)

    # Источник 2: OGIMET
    try:
        metar_ogimet, taf_ogimet = ogimet_parser.get_metar_and_taf(icao)
        if metar_ogimet:
            metar_data["ogimet"] = metar_ogimet
        if taf_ogimet:
            taf_data["ogimet"] = taf_ogimet
    except Exception as e:
        logger.warning("Ошибка OGIMET для %s: %s", icao, e)

    # Выбор самого свежего отчета
    final_metar = _select_latest_report(metar_data)
    final_taf = _select_latest_report(taf_data)

    return final_metar, final_taf


# --- Routes ---


@app.route("/")
def index():
    """Главная страница"""
    return render_template("index.html")


@app.route("/aero")
def aero():
    """Страница аэрологических диаграмм"""
    return render_template("aero.html")


@app.route("/archive")
def archive():
    """Страница архива METAR/TAF"""
    return render_template("archive.html")


@app.route("/airports/search", methods=["GET"])
def search_airports():
    """API endpoint для поиска аэропортов по коду ICAO или названию"""
    query = request.args.get("q", "").strip().upper()

    if not query or len(query) < 2:
        return jsonify({"results": []})

    results = []
    for icao, data in AIRPORT_DATA.items():
        name = data["name"] if isinstance(data, dict) else data
        if query in icao or query.lower() in name.lower():
            runway_info = (
                data.get("runway_headings", "") if isinstance(data, dict) else ""
            )
            results.append({"icao": icao, "name": name, "runway_headings": runway_info})
            if len(results) >= SEARCH_RESULTS_LIMIT:
                break

    return jsonify({"results": results})


@app.route("/fetch", methods=["POST"])
def fetch_metar_taf():
    """API endpoint для получения METAR/TAF с внешних источников"""
    try:
        icao = request.json.get("icao", "").strip().upper()

        if not icao or len(icao) != 4:
            return jsonify({"error": "Неверный код ICAO"}), 400

        metar, taf = get_metar_taf_from_sources(icao)
        airport_info = AIRPORT_DATA.get(icao, {})

        if isinstance(airport_info, dict):
            airport_name = airport_info.get("name", "Неизвестный аэропорт")
            runway_headings = airport_info.get("runway_headings", "")
        else:
            airport_name = airport_info if airport_info else "Неизвестный аэропорт"
            runway_headings = ""

        return jsonify(
            {
                "success": True,
                "icao": icao,
                "airport_name": airport_name,
                "runway_headings": runway_headings,
                "metar": metar,
                "taf": taf,
            }
        )

    except Exception as e:
        return jsonify(
            {"success": False, "error": f"Ошибка при получении данных: {str(e)}"}
        ), 500


@app.route("/decode", methods=["POST"])
def decode_metar():
    """API endpoint для декодирования METAR"""
    try:
        metar_code = request.json.get("metar", "").strip()

        if not metar_code:
            return jsonify({"error": "METAR код не может быть пустым"}), 400

        decoded = metar_decoder.decode(metar_code)
        pretty_output = metar_decoder.pretty(decoded)

        return jsonify({"success": True, "decoded": decoded, "pretty": pretty_output})

    except Exception as e:
        return jsonify(
            {"success": False, "error": f"Ошибка при декодировании: {str(e)}"}
        ), 500


@app.route("/decode-taf", methods=["POST"])
def decode_taf():
    """API endpoint для декодирования TAF"""
    try:
        taf_code = request.json.get("taf", "").strip()

        if not taf_code:
            return jsonify({"error": "TAF код не может быть пустым"}), 400

        decoded = taf_decoder.decode(taf_code)
        pretty_output = taf_decoder.pretty(decoded)

        return jsonify({"success": True, "decoded": decoded, "pretty": pretty_output})

    except Exception as e:
        return jsonify(
            {"success": False, "error": f"Ошибка при декодировании: {str(e)}"}
        ), 500


@app.route("/metar-history", methods=["POST"])
def get_metar_history():
    try:
        icao = request.json.get("icao", "").strip().upper()
        hours = request.json.get("hours", 12)

        if not icao or len(icao) != 4:
            return jsonify({"error": "Неверный код ICAO"}), 400

        # Сначала пробуем кэш
        metars = get_cached(icao, hours)

        if metars is None:
            # Кэш устарел — идём в Ogimet
            logger.info("Кэш устарел для %s, запрашиваем Ogimet", icao)
            metars = ogimet_parser.get_metar_history(icao, hours)

            if metars:
                save_records(icao, metars)
        else:
            logger.info("Отдаём историю %s из кэша (%d записей)", icao, len(metars))

        if not metars:
            return jsonify({"success": False, "error": "История METAR не найдена"}), 404

        history = _decode_metar_history(metars)
        return jsonify(
            {
                "success": True,
                "icao": icao,
                "count": len(history),
                "history": history,
            }
        )

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/taf-history", methods=["POST"])
def get_taf_history():
    """API endpoint для получения истории TAF"""
    try:
        icao = request.json.get("icao", "").strip().upper()
        hours = request.json.get("hours", 48)

        if not icao or len(icao) != 4:
            return jsonify({"error": "Неверный код ICAO"}), 400

        tafs = ogimet_parser.get_taf_history(icao, hours)

        if not tafs:
            return jsonify({"success": False, "error": "История TAF не найдена"}), 404

        history = _decode_taf_history(tafs)

        return jsonify(
            {"success": True, "icao": icao, "count": len(history), "history": history}
        )

    except Exception as e:
        return jsonify(
            {"success": False, "error": f"Ошибка при получении истории TAF: {str(e)}"}
        ), 500


@app.route("/metar-archive", methods=["POST"])
def get_metar_archive():
    """API endpoint для получения архива METAR по датам"""
    try:
        icao = request.json.get("icao", "").strip().upper()
        date_from = request.json.get("dateFrom", "")
        date_to = request.json.get("dateTo", "")

        if not icao or len(icao) != 4:
            return jsonify({"error": "Неверный код ICAO"}), 400

        try:
            start_time, end_time = validate_date_range(date_from, date_to)
        except Exception as e:
            return jsonify({"error": str(e)}), 400

        metars = ogimet_parser.get_metar_history_by_dates(icao, start_time, end_time)

        if not metars:
            return jsonify({"success": False, "error": "Архив METAR не найден"}), 404

        history = _decode_metar_history(metars)

        return jsonify(
            {"success": True, "icao": icao, "count": len(history), "history": history}
        )

    except Exception as e:
        return jsonify(
            {"success": False, "error": f"Ошибка при получении архива: {str(e)}"}
        ), 500


@app.route("/taf-archive", methods=["POST"])
def get_taf_archive():
    """API endpoint для получения архива TAF по датам"""
    try:
        icao = request.json.get("icao", "").strip().upper()
        date_from = request.json.get("dateFrom", "")
        date_to = request.json.get("dateTo", "")

        if not icao or len(icao) != 4:
            return jsonify({"error": "Неверный код ICAO"}), 400

        try:
            start_time, end_time = validate_date_range(date_from, date_to)
        except Exception as e:
            return jsonify({"error": str(e)}), 400

        tafs = ogimet_parser.get_taf_history_by_dates(icao, start_time, end_time)

        if not tafs:
            return jsonify({"success": False, "error": "Архив TAF не найден"}), 404

        history = _decode_taf_history(tafs)

        return jsonify(
            {"success": True, "icao": icao, "count": len(history), "history": history}
        )

    except Exception as e:
        return jsonify(
            {"success": False, "error": f"Ошибка при получении архива: {str(e)}"}
        ), 500


# API endpoints для аэрологических диаграмм


@app.route("/aero/stations", methods=["GET"])
def get_aero_stations():
    """API endpoint для получения списка станций радиозондирования"""
    try:
        stations = get_stations()
        return jsonify({"success": True, "stations": stations})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/aero/fetch", methods=["POST"])
def fetch_aero_data():
    """API endpoint для получения данных радиозондирования"""
    try:
        station_id = request.json.get("station_id", "").strip()
        date = request.json.get("date", "")  # Формат: YYYYMMDD
        hour = request.json.get("hour", "00")  # '00' или '12'

        if not station_id or not date:
            return jsonify({"error": "Необходимо указать станцию и дату"}), 400

        sounding_data, error_message = fetch_sounding(station_id, date, hour)

        if error_message:
            return jsonify({"success": False, "error": error_message}), 404

        # Рассчитываем индексы неустойчивости
        from aero_data import get_fetcher

        fetcher = get_fetcher()
        indices = fetcher.calculate_stability_indices(sounding_data)

        # Добавляем индексы к данным
        sounding_data["indices"] = indices

        return jsonify({"success": True, "data": sounding_data})

    except Exception as e:
        return jsonify(
            {"success": False, "error": f"Ошибка при получении данных: {str(e)}"}
        ), 500


if __name__ == "__main__":
    app.run(debug=config.FLASK_DEBUG, host=config.FLASK_HOST, port=config.FLASK_PORT)
