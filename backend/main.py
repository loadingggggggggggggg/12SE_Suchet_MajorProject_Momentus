from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import Body, FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR.parent / "web"
DB_PATH = BASE_DIR / "momentus.db"
FOODS_SEED_PATH = BASE_DIR / "foods_seed.json"

ALLOWED_STORES = {
    "sessions",
    "workoutSets",
    "hydration",
    "habits",
    "macros",
    "meals",
    "foods",
    "sleep",
    "recoveryNotes",
    "settings",
}

MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

app = FastAPI(title="Momentus API")


def ensure_db() -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS items (
              store TEXT NOT NULL,
              id TEXT NOT NULL,
              data TEXT NOT NULL,
              PRIMARY KEY (store, id)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_items_store ON items(store)")


def get_conn() -> sqlite3.Connection:
    ensure_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def validate_store(store: str) -> str:
    if store not in ALLOWED_STORES:
        raise HTTPException(status_code=404, detail="Unknown store")
    return store


def to_local_iso(date: datetime) -> str:
    return date.strftime("%Y-%m-%d")


def format_hevy_datetime(date: datetime) -> str:
    return f"{date.day} {MONTH_LABELS[date.month - 1]} {date.year}, {date:%H:%M}"


def build_workout_key(title: str, start_time: str) -> str:
    return f"{quote(title or 'Workout')}__{quote(start_time or '')}"

def make_food_id(name: str) -> str:
    slug = "".join(ch.lower() if ch.isalnum() else "_" for ch in (name or "")).strip("_")
    slug = "_".join(filter(None, slug.split("_")))
    return f"food_{slug or uuid.uuid4().hex}"


def upsert_items(store: str, items: list[dict[str, Any]]) -> None:
    with get_conn() as conn:
        for item in items:
            payload = dict(item)
            item_id = payload.get("id") or str(uuid.uuid4())
            payload["id"] = item_id
            conn.execute(
                """
                INSERT INTO items (store, id, data)
                VALUES (?, ?, ?)
                ON CONFLICT(store, id) DO UPDATE SET data=excluded.data
                """,
                (store, item_id, json.dumps(payload)),
            )

def load_food_seed() -> list[dict[str, Any]]:
    if FOODS_SEED_PATH.exists():
        try:
            data = json.loads(FOODS_SEED_PATH.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return data
        except json.JSONDecodeError:
            return []
    return []

def store_has_data(store: str) -> bool:
    with get_conn() as conn:
        row = conn.execute("SELECT 1 FROM items WHERE store = ? LIMIT 1", (store,)).fetchone()
    return bool(row)

def get_existing_food_names() -> set[str]:
    with get_conn() as conn:
        rows = conn.execute("SELECT data FROM items WHERE store = ?", ("foods",)).fetchall()
    names = set()
    for row in rows:
        try:
            payload = json.loads(row["data"])
            name = str(payload.get("name", "")).strip().lower()
            if name:
                names.add(name)
        except json.JSONDecodeError:
            continue
    return names


@app.get("/api/{store}")
def list_store(store: str) -> list[dict[str, Any]]:
    store = validate_store(store)
    with get_conn() as conn:
        rows = conn.execute("SELECT data FROM items WHERE store = ?", (store,)).fetchall()
    return [json.loads(row["data"]) for row in rows]


@app.put("/api/{store}/{item_id}")
def upsert_store_item(store: str, item_id: str, payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    store = validate_store(store)
    item = dict(payload or {})
    item["id"] = item_id
    upsert_items(store, [item])
    return item


@app.delete("/api/{store}/{item_id}")
def delete_store_item(store: str, item_id: str) -> dict[str, Any]:
    store = validate_store(store)
    with get_conn() as conn:
        conn.execute("DELETE FROM items WHERE store = ? AND id = ?", (store, item_id))
    return {"ok": True}


@app.post("/api/{store}/bulk")
def bulk_upsert(store: str, items: list[dict[str, Any]] = Body(...)) -> dict[str, Any]:
    store = validate_store(store)
    payload = list(items or [])
    upsert_items(store, payload)
    return {"count": len(payload)}


@app.post("/api/seed")
def seed_if_needed() -> dict[str, Any]:
    seeded = False

    start = datetime.now().replace(hour=6, minute=30, second=0, microsecond=0)
    end = start.replace(hour=7, minute=20)
    start_time = format_hevy_datetime(start)
    end_time = format_hevy_datetime(end)
    workout_key = build_workout_key("Push Session", start_time)

    workout_sets = [
        {
            "id": str(uuid.uuid4()),
            "workout_key": workout_key,
            "title": "Push Session",
            "start_time": start_time,
            "end_time": end_time,
            "description": "Felt strong on bench. Keep elbows tucked.",
            "exercise_title": "Bench Press",
            "superset_id": "",
            "exercise_notes": "",
            "set_index": 0,
            "set_type": "normal",
            "weight_kg": 80,
            "reps": 8,
            "distance_km": None,
            "duration_seconds": None,
            "rpe": None,
        },
        {
            "id": str(uuid.uuid4()),
            "workout_key": workout_key,
            "title": "Push Session",
            "start_time": start_time,
            "end_time": end_time,
            "description": "Felt strong on bench. Keep elbows tucked.",
            "exercise_title": "Bench Press",
            "superset_id": "",
            "exercise_notes": "",
            "set_index": 1,
            "set_type": "normal",
            "weight_kg": 85,
            "reps": 6,
            "distance_km": None,
            "duration_seconds": None,
            "rpe": None,
        },
        {
            "id": str(uuid.uuid4()),
            "workout_key": workout_key,
            "title": "Push Session",
            "start_time": start_time,
            "end_time": end_time,
            "description": "Felt strong on bench. Keep elbows tucked.",
            "exercise_title": "Overhead Press",
            "superset_id": "",
            "exercise_notes": "",
            "set_index": 0,
            "set_type": "normal",
            "weight_kg": 40,
            "reps": 8,
            "distance_km": None,
            "duration_seconds": None,
            "rpe": None,
        },
    ]

    foods = load_food_seed()
    if not foods:
        foods = [
            {"name": "Chicken breast", "calories": 165, "protein": 31, "carbs": 0, "fat": 3.6},
            {"name": "Greek yogurt", "calories": 130, "protein": 23, "carbs": 9, "fat": 0},
            {"name": "Brown rice", "calories": 216, "protein": 5, "carbs": 45, "fat": 2},
            {"name": "Avocado", "calories": 160, "protein": 2, "carbs": 9, "fat": 15},
        ]
    foods = [{**food, "id": food.get("id") or make_food_id(food.get("name", ""))} for food in foods]

    settings = [
        {
            "id": "macroTargets",
            "calories": 2600,
            "protein": 180,
            "carbs": 250,
            "fat": 70,
            "hydration": 2500,
        }
    ]

    meals = [
        {
            "id": str(uuid.uuid4()),
            "date": to_local_iso(datetime.now()),
            "name": "Chicken rice bowl",
            "calories": 620,
            "protein": 45,
            "carbs": 62,
            "fat": 14,
            "notes": "Post-workout meal",
        }
    ]

    if not store_has_data("workoutSets"):
        upsert_items("workoutSets", workout_sets)
        seeded = True
    existing_food_names = get_existing_food_names() if store_has_data("foods") else set()
    foods_to_add = [
        food for food in foods if str(food.get("name", "")).strip().lower() not in existing_food_names
    ]
    if foods_to_add:
        upsert_items("foods", foods_to_add)
        seeded = True
    if not store_has_data("settings"):
        upsert_items("settings", settings)
        seeded = True
    if not store_has_data("meals"):
        upsert_items("meals", meals)
        seeded = True

    return {"seeded": seeded}


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
