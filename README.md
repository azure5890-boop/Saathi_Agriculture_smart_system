# Saathi — AI Smart Agriculture (Flask + local Ollama)

Saathi is a local smart-farming dashboard with five focused pages: Dashboard, Crop Advisory & Plant Health, Weather, Irrigation, and Farmer AI Guide. It combines two Teachable Machine image models, plant-gated webcam scanning, OpenWeather data through Flask, transparent crop/irrigation rules, and local Ollama Qwen3. Context-aware Qwen actions are available directly in the crop, plant scan, weather and irrigation tools as well as in the guide chat.

## Security first
The OpenWeather key was pasted into chat. Treat it as exposed: revoke/regenerate it in your OpenWeather account, then place the replacement only in your local `.env` file. Do not paste it into HTML/JavaScript or commit `.env` to source control. The code does not contain the key.

## Local farmer guide: Ollama Qwen3

The Farmer AI Guide uses the local Ollama HTTP API, defaulting to `http://127.0.0.1:11434` and model `qwen3:1.7b`. The model download is about 1.4 GB; extra RAM and disk space are needed while it runs. It does not send the farmer-guide prompt to a hosted AI service, but live weather and browser-loaded plant models still require internet.

1. Install Ollama for your Linux environment using the official instructions: <https://docs.ollama.com/linux>. The standard Linux installer command is `curl -fsSL https://ollama.com/install.sh | sh`. Check the official instructions first if your Chromebook CPU/architecture is not supported.
2. In Linux Terminal run `ollama pull qwen3:1.7b` to download the model.
3. Make sure Ollama is running. If it is not already running as a service, run `ollama serve` in its own terminal and leave that terminal open.
4. Start Saathi as described below. Open `http://127.0.0.1:5000`, open **Farmer AI Guide**, and check its status.
5. Use context-aware AI action buttons from **Crop Advisory**, **Weather**, and **Irrigation**, or use one of the guide prompts or write a question. Qwen receives the selected crop, soil type, current weather if available, recent/forecast rainfall, crop stage, simulated soil moisture, and last plant result. The crop advice and irrigation calculations remain transparent rules; Qwen explains and contextualizes them rather than changing sensor data.

If the guide reports that Ollama is not reachable, run `ollama list` and confirm `qwen3:1.7b` is listed. The default settings can be changed in `.env` using `OLLAMA_BASE_URL` and `OLLAMA_MODEL`.

## Setup (Windows)
1. Install Python 3.10+ and extract this folder.
2. Open Command Prompt or PowerShell **inside this folder**.
3. Create and activate a virtual environment:
   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```
   If PowerShell blocks activation, use Command Prompt and run `.venv\Scripts\activate.bat`.
4. Install dependencies: `pip install -r requirements.txt`
5. Copy `.env.example` to a new file named `.env` and place your **replacement** OpenWeather key after the equals sign:
   ```text
   OPENWEATHER_API_KEY=your_new_key_here
   ```
6. Start the app with `python app.py` and keep the terminal open.
7. Open `http://127.0.0.1:5000` in Chrome. Webcam access should use this localhost address.

## Setup (Chromebook with Linux development environment)
1. Extract/copy the project into **Linux files**.
2. Open the Linux Terminal and `cd` into the `Saathi` project folder.
3. Copy the example config and edit it: `cp .env.example .env` then `nano .env`. Replace the placeholder with your **replacement** OpenWeather key. Save with Ctrl+O, Enter, then Ctrl+X.
4. Install Python tools if needed: `sudo apt update && sudo apt install -y python3-venv python3-pip`
5. Run `python3 -m venv .venv`, then `source .venv/bin/activate`, then `pip install -r requirements.txt`.
6. Run `python3 app.py`, keep Terminal open, and visit `http://127.0.0.1:5000` in Chrome.

## Dashboard features
- Dashboard with live snapshot, service availability, recent activity and a contextual farm-plan AI action
- Crop Advisory page combines plant disease screening and crop-care recommendations; upload an image or use webcam scanning
- Plant scanner loads both supplied Teachable Machine models automatically and uses COCO-SSD to require a recognizable potted plant during live webcam scanning
- A dedicated Weather page automatically requests device location, supports a manual town fallback, displays current readings, and offers a Qwen weather-to-field checklist
- A dedicated Irrigation page updates its demo recommendation as simulated soil moisture, forecast rain and crop stage change, plus an inline Qwen irrigation review
- Crop advice provides general actionable checks when no crop is selected, then becomes more tailored after the crop/soil/weather inputs change
- Local Farmer AI chat and context preview, plus AI actions embedded in the plant, crop, weather, irrigation and dashboard workflows
- Functional Reset inputs button clears the crop/soil/weather inputs and dependent recommendations, removes the selected leaf image and resets scan results; already-loaded live weather itself is preserved
- Model URLs and local Ollama setup instructions are not displayed in the visitor-facing UI

## Trained models
Saathi loads the supplied models automatically in the browser:
- Model 1 (health check): `https://teachablemachine.withgoogle.com/models/wtHi_ADSE/`
- Model 2 (disease class): `https://teachablemachine.withgoogle.com/models/oaObDgYx_/`

The model controls/URLs are hidden from exhibition visitors. The webcam plant gate uses COCO-SSD and needs a recognizable potted plant in view; the pre-trained COCO label set only includes a dedicated "potted plant" class, so it can miss a detached leaf or extreme close-up. For a future version that reliably recognizes standalone leaves, add/train a separate plant-versus-nonplant verifier model. If it cannot verify a plant, the disease models are not run for that frame. Health labels are inferred from class names such as Healthy/Unhealthy, Healthy/Diseased, or similar. For an automatic two-stage result, Model 1's classes need meaningful names that clearly distinguish healthy from unhealthy/diseased. Keep the internet connected because the Teachable Machine model files and browser libraries are fetched online. Webcam scanning runs while the live scanner is open and stops when it closes.

## Notes
- Automatic local weather prompts for browser location access. If permission is denied or unavailable, enter a town in the fallback field. Weather needs internet and an active OpenWeather API key. Flask loads `.env` from the same folder as `app.py` and the server must be restarted after changing it. The dashboard reports whether a key is present; OpenWeather must still accept it for live weather to work.
- The key shown in the user's screenshot/chat should be revoked or replaced. Never put the key in HTML/JavaScript or share the `.env` file.
- OpenWeather's free-plan availability and request limits depend on your account and current plan.
- The rain forecast sums the next eight 3-hour forecast periods, so it is approximate. The crop selector starts at Not set and no crop-specific advice is generated until a crop is selected.
- Crop and irrigation advice are transparent demo rules, not trained AI or guaranteed agricultural recommendations. Qwen may also make mistakes; use it for educational guidance and confirm important decisions with a local agriculture expert.
- Plant model predictions are not diagnoses; verify disease/treatment decisions with a local agricultural expert.


## Latest plant models and rainfall notes
- Plant health/detection model: https://teachablemachine.withgoogle.com/models/eySRbLEhO/
- Disease classification model: https://teachablemachine.withgoogle.com/models/iiypUy-Qu/
- The weather panel fetches current observed precipitation for the last hour when supplied by OpenWeather and sums the next eight 3-hour forecast periods for approximate next-24-hour forecast rainfall. The standard current-weather endpoint does not provide a full historical rainfall total; a missing `rain.1h` field means the provider did not return a measured/calculated amount for that period, not a guaranteed field-level measurement of zero.
