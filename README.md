# Momentus PWA

Momentus is a Progressive Web App for strength-training athletes. It tracks training, nutrition, recovery, habits, charts, and AI-assisted coaching feedback.

## Features

- Training log with sessions, exercises, sets, and notes
- Progress charts for weight, reps, volume, sleep, and macros
- Calendar views with training and habit status
- Daily habits, hydration, meals, sleep, and recovery notes
- SQLite storage through a FastAPI backend
- Gemini-powered AI Coach for workout extraction, training analysis, recovery analysis, nutrition analysis, and weekly summaries

## Project Structure

- `web/` - PWA HTML, CSS, JavaScript, manifest, service worker, and assets
- `backend/` - FastAPI server, SQLite database, analytics, auth, and Gemini AI endpoint

## Setup

Install the backend dependencies:

```bash
pip install -r backend/requirements.txt
```
 
Start the app:

```bash
python -m uvicorn backend.main:app --reload
```

Open:

```text
http://localhost:8000/
```

Do not open `web/index.html` directly. The PWA and API need the FastAPI server.

## Gemini AI Setup
(LOOK AT ATTACHED DOC FOR API KEY) 

to set the API key, the following command must be pasted into the terminal
```text
GEMINI_API_KEY=paste-your-key-here
```

Then start Momentus:

```bash
python -m uvicorn backend.main:app --reload
```

The `.env` file is ignored by git, so the key will not be committed.

Temporary terminal setup (paste each line one at a time):

PowerShell:

```powershell
$env:GEMINI_API_KEY="paste-your-key-here"
python -m uvicorn backend.main:app --reload
```


Momentus uses `gemini-2.5-flash` by default. To use another model, set `GEMINI_MODEL` before starting the server.

If Google AI Studio gives you a newer `AQ...` key format, still save it as `GEMINI_API_KEY`. Momentus sends it as an API key. If Google rejects it, generate a legacy Google Cloud API key from the Google Cloud Console Credentials page and use that as `GEMINI_API_KEY`.

## AI Coach

After logging in, use the **AI Coach** card on the dashboard. It supports:

- `Extract workout`
- `Analyse training`
- `Analyse recovery`
- `Analyse nutrition`
- `Weekly summary`

If `GEMINI_API_KEY` is missing, the AI Coach will show a setup error instead of crashing.

## Notes

- All user data is stored locally in `backend/momentus.db`.
- Delete `backend/momentus.db` only if you want to reset local data.
- After frontend changes, hard refresh the app with `Ctrl + Shift + R` if the PWA cache still shows old files.
