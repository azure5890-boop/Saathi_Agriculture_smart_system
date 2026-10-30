import json
import os
from datetime import datetime, timezone
from flask import Flask, jsonify, render_template, request
import requests
from dotenv import load_dotenv

# Always load the .env next to this file, regardless of the terminal's working directory.
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(dotenv_path=os.path.join(PROJECT_DIR, ".env"), override=True)

app = Flask(__name__, template_folder="templates", static_folder="static")
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "").strip()
OPENWEATHER_BASE = "https://api.openweathermap.org/data/2.5"
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").strip().rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:1.7b").strip() or "qwen3:1.7b"


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "weather_key_configured": bool(OPENWEATHER_API_KEY),
        "ollama_model": OLLAMA_MODEL,
    })


@app.get("/api/ollama/status")
def ollama_status():
    """Report local Ollama/model readiness without exposing any secrets."""
    try:
        response = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=2.5)
        response.raise_for_status()
        payload = response.json()
        models = payload.get("models", [])
        installed_names = [m.get("name", "") for m in models if isinstance(m, dict)]
        wanted = OLLAMA_MODEL
        installed = any(name == wanted or name.split(":")[0] == wanted.split(":")[0] and name.endswith(wanted.split(":")[-1]) for name in installed_names)
        # Ollama may report a canonical tag with :latest; normalize the common exact-tag case.
        installed = installed or wanted in installed_names or (wanted + ":latest") in installed_names
        return jsonify({
            "ok": bool(installed),
            "ollama_running": True,
            "model": wanted,
            "model_installed": bool(installed),
            "installed_models": installed_names[:30],
            "message": ("Farmer AI is ready." if installed else "Ollama is running, but the Farmer AI model is unavailable."),
        })
    except requests.RequestException:
        return jsonify({
            "ok": False,
            "ollama_running": False,
            "model": OLLAMA_MODEL,
            "model_installed": False,
            "message": "The local Farmer AI service is not reachable right now.",
        }), 503
    except (ValueError, TypeError):
        return jsonify({"ok": False, "ollama_running": True, "model": OLLAMA_MODEL,
                        "model_installed": False, "message": "Ollama returned an unexpected status response."}), 502


@app.post("/api/farmer-guide")
def farmer_guide():
    """Ask the locally running Qwen model for context-aware farmer guidance."""
    body = request.get_json(silent=True) or {}
    question = str(body.get("question", "")).strip()
    if not question:
        return jsonify({"error": "Please enter a question for Saathi."}), 400
    if len(question) > 1800:
        return jsonify({"error": "Please keep the question under 1,800 characters."}), 413

    raw_context = body.get("context", {})
    if not isinstance(raw_context, dict):
        raw_context = {}
    allowed_context = (
        "crop", "soil", "temperature_c", "recent_rain_mm", "forecast_rain_mm",
        "current_weather", "humidity_percent", "wind_kmh", "soil_moisture_percent",
        "crop_stage", "last_plant_result", "plant_confidence_note", "location", "note",
    )
    context = {key: raw_context.get(key) for key in allowed_context if raw_context.get(key) is not None}

    raw_history = body.get("history", [])
    history = []
    if isinstance(raw_history, list):
        for item in raw_history[-8:]:
            if not isinstance(item, dict):
                continue
            role = item.get("role")
            content = str(item.get("content", "")).strip()
            if role in ("user", "assistant") and content:
                history.append({"role": role, "content": content[:1200]})

    try:
        # Quickly check that Ollama responds, then make a single non-streaming chat request.
        response = requests.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "stream": False,
                "think": False,
                "keep_alive": "10m",
                "messages": [
                    {"role": "system", "content": (
                        "You are Saathi, an adaptive farm decision-support guide for small farms, especially in India. "
                        "Do NOT give a generic repeated template. First interpret the actual question, then use the specific "
                        "values in the current context to produce a tailored answer. Explicitly mention the relevant measured, "
                        "forecast, simulated, or AI-predicted values when useful; explain what they imply and give 2-5 concrete "
                        "next steps in priority order. If moisture is available, interpret it cautiously with crop stage, soil, "
                        "and rainfall rather than using a universal watering threshold. If weather is available, relate rain, "
                        "temperature, humidity, and wind to field tasks. If a recent plant scan is available, discuss that exact "
                        "predicted label and uncertainty, and suggest symptom checks; never call it a confirmed diagnosis. If the "
                        "user asks about an uploaded image, use the latest plant scan result included in context and say if none "
                        "is available. Do not claim to see image pixels: only the image-model prediction is provided to you. "
                        "If data is missing, say which value is missing and still provide useful general guidance. Avoid repeating "
                        "the same answer across different questions; answer the specific question directly. Use simple language. "
                        "Prefer low-cost, environmentally responsible integrated pest management and locally suitable practices. "
                        "Do not prescribe specific pesticide dosages or tank mixes; recommend label directions and local expert advice. "
                        "Never invent local weather, treat simulated moisture as a sensor measurement, guarantee yield or cures, or "
                        "replace a local Krishi Vigyan Kendra (KVK), extension worker, or plant pathologist. Keep replies concise "
                        "(usually 100-220 words), practical, and clear about uncertainty.\n\n"
                        "Current Saathi farm context (may include simulated fields): "
                        + json.dumps(context, ensure_ascii=False)
                    )},
                    *history,
                    {"role": "user", "content": question},
                ],
                "options": {"temperature": 0.65, "top_p": 0.9, "repeat_penalty": 1.12, "num_predict": 500},
            },
            timeout=(4, 100),
        )
        if response.status_code == 404:
            return jsonify({"error": "The local Farmer AI model is currently unavailable."}), 503
        response.raise_for_status()
        data = response.json()
        answer = str((data.get("message") or {}).get("content", "")).strip()
        if not answer:
            return jsonify({"error": "Ollama returned an empty reply. Please try again."}), 502
        return jsonify({"answer": answer, "model": OLLAMA_MODEL, "source": "local Ollama model"})
    except requests.Timeout:
        return jsonify({"error": "Farmer AI is taking longer than expected. Try a shorter request."}), 504
    except requests.ConnectionError:
        return jsonify({"error": "The local Farmer AI service is not reachable right now."}), 503
    except requests.RequestException:
        app.logger.exception("Ollama farmer-guide request failed")
        return jsonify({"error": "Farmer AI could not complete this request. Please try again shortly."}), 502
    except (ValueError, TypeError):
        app.logger.exception("Unexpected Ollama response")
        return jsonify({"error": "Ollama returned an unexpected response."}), 502


@app.get("/api/weather")
def weather():
    city = (request.args.get("city") or "").strip()
    lat_raw = request.args.get("lat")
    lon_raw = request.args.get("lon")
    use_coordinates = lat_raw is not None and lon_raw is not None
    if not use_coordinates and not city:
        return jsonify({"error": "Provide browser location coordinates or a city name."}), 400
    if not OPENWEATHER_API_KEY:
        return jsonify({
            "error": "OpenWeather API key is not configured. Add OPENWEATHER_API_KEY to the .env file beside app.py and restart Flask."
        }), 503

    try:
        if use_coordinates:
            try:
                lat, lon = float(lat_raw), float(lon_raw)
            except (TypeError, ValueError):
                return jsonify({"error": "Location coordinates are invalid. Allow location access and retry."}), 400
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                return jsonify({"error": "Location coordinates are outside valid limits."}), 400
            current_params = {"lat": lat, "lon": lon, "appid": OPENWEATHER_API_KEY, "units": "metric"}
        else:
            current_params = {"q": city, "appid": OPENWEATHER_API_KEY, "units": "metric"}

        current_resp = requests.get(
            f"{OPENWEATHER_BASE}/weather", params=current_params, timeout=10
        )
        if current_resp.status_code == 401:
            return jsonify({"error": "OpenWeather rejected the API key. Create/activate a replacement key, put it in the project's .env file, and restart Flask."}), 502
        if current_resp.status_code == 429:
            return jsonify({"error": "OpenWeather request limit reached. Check your plan or retry later."}), 502
        if current_resp.status_code == 404:
            return jsonify({"error": f"Location '{city}' was not found. Try a nearby larger town."}), 404
        current_resp.raise_for_status()
        current_data = current_resp.json()
        actual_lat = current_data["coord"]["lat"]
        actual_lon = current_data["coord"]["lon"]

        forecast_resp = requests.get(
            f"{OPENWEATHER_BASE}/forecast",
            params={
                "lat": actual_lat,
                "lon": actual_lon,
                "appid": OPENWEATHER_API_KEY,
                "units": "metric",
                "cnt": 8,
            },
            timeout=10,
        )
        if forecast_resp.status_code == 401:
            return jsonify({"error": "OpenWeather rejected the API key on the forecast request. Replace it with a valid key and restart Flask."}), 502
        if forecast_resp.status_code == 429:
            return jsonify({"error": "OpenWeather request limit reached. Check your plan or retry later."}), 502
        forecast_resp.raise_for_status()
        forecast_data = forecast_resp.json()

        rain_1h = (current_data.get("rain") or {}).get("1h", 0) or 0
        forecast_rain = sum(
            (item.get("rain") or {}).get("3h", 0) or 0
            for item in forecast_data.get("list", [])
        )
        current = {
            "temp": current_data["main"]["temp"],
            "feels_like": current_data["main"].get("feels_like"),
            "humidity": current_data["main"]["humidity"],
            "description": current_data.get("weather", [{}])[0].get("description", "Current conditions").capitalize(),
            "icon": current_data.get("weather", [{}])[0].get("icon", ""),
            "icon_emoji": _weather_emoji(current_data.get("weather", [{}])[0].get("icon", "")),
            "wind_speed_kmh": round((current_data.get("wind", {}).get("speed", 0) or 0) * 3.6, 1),
            "observed_at": datetime.fromtimestamp(
                current_data.get("dt", datetime.now(timezone.utc).timestamp()), timezone.utc
            ).strftime("%H:%M UTC"),
        }
        return jsonify({
            "location": {
                "name": current_data.get("name") or (city if city else "Your location"),
                "country": current_data.get("sys", {}).get("country", ""),
                "state": "",
                "latitude": actual_lat,
                "longitude": actual_lon,
            },
            "current": current,
            "rain_1h_mm": round(float(rain_1h), 2),
            "rain_next_24h_mm": round(float(forecast_rain), 2),
            "forecast_note": "Forecast rainfall is estimated from the next eight 3-hour forecast periods; it is not a field measurement.",
            "source": "OpenWeather",
        })
    except requests.Timeout:
        return jsonify({"error": "Weather service timed out. Please try again."}), 504
    except requests.RequestException:
        app.logger.exception("OpenWeather request failed")
        return jsonify({"error": "Could not reach OpenWeather. Check your internet connection and API plan."}), 502
    except (KeyError, ValueError, TypeError):
        app.logger.exception("Unexpected OpenWeather response")
        return jsonify({"error": "The weather provider returned an unexpected response."}), 502


def _weather_emoji(icon_code):
    if not icon_code:
        return "🌦️"
    prefix = icon_code[:2]
    return {
        "01": "☀️", "02": "🌤️", "03": "⛅", "04": "☁️",
        "09": "🌧️", "10": "🌦️", "11": "⛈️", "13": "❄️", "50": "🌫️",
    }.get(prefix, "🌦️")


if __name__ == "__main__":
    # Local exhibition/demo server only. Do not use Flask's debug server for public deployment.
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "5000")), debug=False)
