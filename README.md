# Momentus PWA (MVP)

A desktop-first Progressive Web App for strength-training athletes. This MVP focuses on a training log, progress charts, lightweight habits, and local-first storage backed by a Python API.

## Features

- Training log with sessions, exercises, sets, and notes
- Progress charts (weight/reps trend + weekly volume split)
- Calendar views (day/week/month) with goal status colors
- Daily habits (creatine + electrolytes checkboxes with streaks)
- Macro + sleep MVP forms
- SQLite storage via Python API
- Installable PWA (manifest + service worker)

## Project structure

- `web/` - PWA source (HTML/CSS/JS)
- `web/assets/` - icons and textures
- `backend/` - FastAPI server + SQLite

## Setup

You need a local web server (service workers require HTTP/S). The Python backend serves both the API and the PWA.

### Python (recommended)

1. Create and activate a virtual environment (optional but recommended).
2. Install backend dependencies:

```bash
pip install -r backend/requirements.txt
```

3. Start the server:

```bash
python -m uvicorn backend.main:app --reload
```

Open `http://localhost:8000/` in your browser.

## Notes

- Opening `web/index.html` directly will not register the service worker.
- All data is stored locally in SQLite; delete `backend/momentus.db` to reset.

## Manual test checklist

1. Create/edit/delete a training session; charts update.
2. Toggle creatine/electrolytes checkboxes; streak updates.
3. Switch calendar views; colors update.
4. Refresh page; data persists.
5. Install PWA; cached screens load offline.
