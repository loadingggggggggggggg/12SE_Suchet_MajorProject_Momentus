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

from backend.services import AnalyticsService, StoreRepository, to_local_iso

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


def get_repository() -> StoreRepository:
    ensure_db()
    return StoreRepository(str(DB_PATH))


def get_analytics() -> AnalyticsService:
    return AnalyticsService(get_repository())


def validate_store(store: str) -> str:
    if store not in ALLOWED_STORES:
        raise HTTPException(status_code=404, detail="Unknown store")
    return store


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


@app.get("/api/analytics/session-metrics")
def analytics_session_metrics(days: int = 7) -> dict[str, Any]:
    return get_analytics().compute_session_metrics(days)


@app.get("/api/analytics/volume-by-muscle")
def analytics_volume_by_muscle(days: int | None = None, range: str | None = None, date: str | None = None) -> dict[str, float]:
    analytics = get_analytics()
    if range:
        return analytics.compute_volume_by_muscle_range(range, date or to_local_iso(datetime.now()))
    return analytics.compute_volume_by_muscle(days or 7)


@app.post("/api/analytics/week-summary")
def analytics_week_summary(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    week_dates = payload.get("weekDates") or []
    return get_analytics().compute_week_summary(list(week_dates))


@app.get("/api/analytics/macro-progress")
def analytics_macro_progress(date: str) -> dict[str, Any]:
    return get_analytics().compute_macro_progress(date)


@app.get("/api/analytics/hydration-total")
def analytics_hydration_total(date: str) -> dict[str, Any]:
    return get_analytics().compute_hydration_total(date)


@app.get("/api/analytics/recovery-timeline")
def analytics_recovery_timeline(limit: int = 30) -> list[dict[str, Any]]:
    return get_analytics().build_recovery_timeline(limit)


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




# --- Server-side computation helpers and endpoints (non-breaking additions) ---
def parse_local_iso(iso: str):
    try:
        parts = iso.split("-")
        if len(parts) >= 3:
            y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
            return datetime(y, m, d)
    except Exception:
        return None
    return None


def load_store_items(store: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("SELECT data FROM items WHERE store = ?", (store,)).fetchall()
    items: list[dict] = []
    for row in rows:
        try:
            items.append(json.loads(row["data"]))
        except Exception:
            continue
    return items


def build_sessions_from_workout_sets(workout_sets: list[dict]) -> list[dict]:
    if not workout_sets:
        return []
    groups: dict[str, dict] = {}
    for row in workout_sets:
        key = row.get("workout_key") or build_workout_key(row.get("title"), row.get("start_time"))
        if key not in groups:
            groups[key] = {"id": key, "title": row.get("title") or "Workout", "start_time": row.get("start_time") or "", "end_time": row.get("end_time") or "", "description": row.get("description") or "", "rows": []}
        groups[key]["rows"].append(row)

    sessions: list[dict] = []
    for key, group in groups.items():
        first = group["rows"][0] if group["rows"] else {}
        iso = first.get("start_date") or ""
        date_iso = None
        if iso:
            date_obj = parse_local_iso(iso)
            if date_obj:
                date_iso = date_obj.strftime("%Y-%m-%d")
        if not date_iso:
            date_iso = datetime.now().strftime("%Y-%m-%d")

        exercises_map: dict[str, dict] = {}
        for row in group["rows"]:
            exercise_key = f"{row.get('exercise_title','Exercise')}__{row.get('superset_id','')}__{row.get('exercise_notes','')}"
            if exercise_key not in exercises_map:
                exercises_map[exercise_key] = {"id": str(uuid.uuid4()), "name": row.get("exercise_title") or "Exercise", "muscle": row.get("muscle") or "", "notes": row.get("exercise_notes") or "", "sets": []}
            exercises_map[exercise_key]["sets"].append({
                "id": row.get("id") or str(uuid.uuid4()),
                "name": f"Set {int(row.get('set_index', 0)) + 1}",
                "reps": int(row.get("reps") or 0) if row.get("reps") is not None else 0,
                "weight": float(row.get("weight_kg") or 0) if row.get("weight_kg") is not None else 0,
                "set_index": int(row.get("set_index") or 0),
            })

        exercises = []
        for ex in exercises_map.values():
            ex["sets"] = sorted(ex["sets"], key=lambda s: s.get("set_index", 0))
            exercises.append(ex)

        sessions.append({
            "id": key,
            "date": date_iso,
            "title": group.get("title"),
            "notes": group.get("description"),
            "start_time": group.get("start_time"),
            "end_time": group.get("end_time"),
            "exercises": exercises,
        })

    sessions.sort(key=lambda s: s.get("date", ""), reverse=True)
    return sessions


@app.get("/api/compute/session-metrics")
def api_compute_session_metrics(days: int = 7):
    workout_sets = load_store_items("workoutSets")
    sessions = build_sessions_from_workout_sets(workout_sets)
    from datetime import timedelta

    cutoff_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=(days - 1))

    recent = [s for s in sessions if parse_local_iso(s.get("date", "")) and parse_local_iso(s.get("date", "")) >= cutoff_date]
    sets = []
    for s in recent:
        for ex in s.get("exercises", []):
            sets.extend(ex.get("sets", []))
    volume = sum((int(set_.get("reps", 0)) * float(set_.get("weight", 0))) for set_ in sets)
    prs = 0
    for s in recent:
        top = 0
        for ex in s.get("exercises", []):
            for set_ in ex.get("sets", []):
                top = max(top, float(set_.get("weight", 0)))
        if top > 0:
            prs += 1
    return {"sessions": len(recent), "sets": len(sets), "volume": round(volume), "prs": prs}


@app.get("/api/compute/volume-by-muscle")
def api_compute_volume_by_muscle(days: int = 7):
    workout_sets = load_store_items("workoutSets")
    sessions = build_sessions_from_workout_sets(workout_sets)
    from datetime import timedelta
    cutoff_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=(days - 1))
    buckets: dict[str, int] = {}
    for s in sessions:
        d = parse_local_iso(s.get("date", ""))
        if not d or d < cutoff_date:
            continue
        for ex in s.get("exercises", []):
            count = len(ex.get("sets", []))
            if count == 0:
                continue
            muscle = ex.get("muscle") or "Other"
            buckets[muscle] = buckets.get(muscle, 0) + count
    return buckets


@app.get("/api/compute/habit-streak")
def api_compute_habit_streak():
    from datetime import timedelta

    habits = load_store_items("habits")
    sorted_habits = sorted(habits, key=lambda h: h.get("date", ""), reverse=True)
    streak = 0
    cursor = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    cursor_iso = cursor.strftime("%Y-%m-%d")
    for entry in sorted_habits:
        if entry.get("date") != cursor_iso:
            break
        electrolytes = entry.get("electrolytes") or entry.get("protein") or False
        if entry.get("creatine") or electrolytes:
            streak += 1
        else:
            break
        cursor = cursor - timedelta(days=1)
        cursor_iso = cursor.strftime("%Y-%m-%d")
    return {"streak": streak}


@app.post("/api/compute/week-summary")
def api_compute_week_summary(body: dict):
    week_dates = body.get("weekDates") or []
    meals = load_store_items("meals")
    sleep = load_store_items("sleep")
    sessions = build_sessions_from_workout_sets(load_store_items("workoutSets"))

    def get_session_for_date(d):
        for s in sessions:
            if s.get("date") == d:
                return s
        return None

    def get_sleep_for_date(d):
        for s in sleep:
            if s.get("date") == d:
                return s
        return None

    total_sets = 0
    calories = 0
    sleep_entries = []
    for d in week_dates:
        s = get_session_for_date(d)
        if s:
            for ex in s.get("exercises", []):
                total_sets += len(ex.get("sets", []))
        meals_for_day = [m for m in meals if m.get("date") == d]
        calories += sum(int(m.get("calories", 0)) for m in meals_for_day)
        se = get_sleep_for_date(d)
        if se:
            sleep_entries.append(se)

    avg_calories = round(calories / len(week_dates)) if week_dates else 0
    avg_sleep = (
        round(sum(float(s.get("hours", 0)) for s in sleep_entries) / len(sleep_entries), 1)
        if sleep_entries
        else "0.0"
    )
    return {"totalSets": total_sets, "avgCalories": avg_calories, "avgSleep": avg_sleep}

@app.get("/api/compute/meal-totals")
def api_compute_meal_totals(date: str):
    meals = load_store_items("meals")
    totals = {"calories": 0, "protein": 0, "carbs": 0, "fat": 0}
    for m in meals:
        if m.get("date") == date:
            totals["calories"] += int(m.get("calories", 0))
            totals["protein"] += int(m.get("protein", 0))
            totals["carbs"] += int(m.get("carbs", 0))
            totals["fat"] += int(m.get("fat", 0))
    return totals


@app.get("/api/compute/macro-progress")
def api_compute_macro_progress(date: str):
    settings = load_store_items("settings")
    macro_targets = {"calories": 0, "protein": 0, "carbs": 0, "fat": 0, "hydration": 0}
    for s in settings:
        if s.get("id") == "macroTargets":
            macro_targets = {**macro_targets, **s}
            break
    totals = api_compute_meal_totals(date)
    return {
        "calories": {"value": totals["calories"], "target": macro_targets.get("calories", 0)},
        "protein": {"value": totals["protein"], "target": macro_targets.get("protein", 0)},
        "carbs": {"value": totals["carbs"], "target": macro_targets.get("carbs", 0)},
        "fat": {"value": totals["fat"], "target": macro_targets.get("fat", 0)},
    }


@app.get("/api/compute/hydration-total")
def api_compute_hydration_total(date: str):
    hydration = load_store_items("hydration")
    total = 0
    for h in hydration:
        if h.get("date") == date:
            total += int(h.get("amount_ml", 0))
    return {"amount_ml": total}


@app.get("/api/compute/progress-series")
def api_compute_progress_series(exercise: str = "", range: str = "30"):
    # exercise: name filter (case-insensitive exact match); range: number of days or 'all'
    sessions = build_sessions_from_workout_sets(load_store_items("workoutSets"))
    series = []
    from datetime import timedelta
    cutoff = None
    if range != "all":
        try:
            days = int(range)
            cutoff = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=(days - 1))
        except Exception:
            cutoff = None

    for s in sorted(sessions, key=lambda x: x.get("date", "")):
        d = parse_local_iso(s.get("date", ""))
        if cutoff and (not d or d < cutoff):
            continue
        sets = []
        key = (exercise or "").strip().lower()
        if key:
            for ex in s.get("exercises", []):
                if ex.get("name", "").strip().lower() == key:
                    sets.extend(ex.get("sets", []))
        else:
            for ex in s.get("exercises", []):
                sets.extend(ex.get("sets", []))
        if not sets:
            continue
        best = max(sets, key=lambda st: float(st.get("weight", 0)))
        series.append({"label": s.get("date", "")[5:], "date": s.get("date", ""), "weight": best.get("weight", 0), "reps": best.get("reps", 0)})
    return series if series else [{"label": "--", "weight": 0, "reps": 0}]


@app.get("/api/compute/volume-by-muscle-range")
def api_compute_volume_by_muscle_range(range: str = "all", dateISO: str | None = None):
    sessions = build_sessions_from_workout_sets(load_store_items("workoutSets"))
    def in_range(sdate: str) -> bool:
        if range in (None, "", "all"):
            return True
        d = parse_local_iso(sdate)
        if not d:
            return False
        base = parse_local_iso(dateISO) if dateISO else datetime.now()
        if range == "day":
            return d.date() == base.date()
        if range == "month":
            return d.year == base.year and d.month == base.month
        if range == "year":
            return d.year == base.year
        return True

    buckets: dict[str, int] = {}
    for s in sessions:
        if not in_range(s.get("date", "")):
            continue
        for ex in s.get("exercises", []):
            count = len(ex.get("sets", []))
            if count == 0:
                continue
            muscle = ex.get("muscle") or "Other"
            buckets[muscle] = buckets.get(muscle, 0) + count
    return buckets


@app.get("/api/compute/volume-trend")
def api_compute_volume_trend(weeks: int = 6):
    sessions = build_sessions_from_workout_sets(load_store_items("workoutSets"))
    from datetime import timedelta
    results = []
    now = datetime.now()
    start_of_week = now
    for i in range(weeks - 1, -1, -1):
        start = (now - timedelta(days=i * 7)).replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=6)
        volume = 0
        for s in sessions:
            d = parse_local_iso(s.get("date", ""))
            if not d:
                continue
            if d >= start and d <= end:
                for ex in s.get("exercises", []):
                    for st in ex.get("sets", []):
                        volume += int(st.get("reps", 0)) * float(st.get("weight", 0))
        results.append({"label": f"{start.month}/{start.day}", "value": round(volume)})
    return results


@app.get("/api/compute/get-habit")
def api_get_habit(date: str):
    habits = load_store_items("habits")
    for h in habits:
        if h.get("date") == date:
            return h
    return None


@app.get("/api/compute/get-recovery-note")
def api_get_recovery_note(date: str):
    notes = load_store_items("recoveryNotes")
    for n in notes:
        if n.get("date") == date:
            return n
    return None


@app.get("/api/compute/day-status")
def api_get_day_status(date: str):
    # score: session + creatine + electrolytes
    sessions = build_sessions_from_workout_sets(load_store_items("workoutSets"))
    has_session = any(s.get("date") == date for s in sessions)
    habit = api_get_habit(date)
    electrolytes = (habit and (habit.get("electrolytes") or habit.get("protein"))) or False
    score = (1 if has_session else 0) + (1 if (habit and habit.get("creatine")) else 0) + (1 if electrolytes else 0)
    if score >= 3:
        return "good"
    if score >= 1:
        return "mid"
    return "miss"


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
