from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any
from urllib.parse import quote

MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTH_INDEX = {label: index for index, label in enumerate(MONTH_LABELS)}


def to_local_iso(value: date | datetime) -> str:
    return value.strftime("%Y-%m-%d")


def parse_local_iso(value: str) -> date:
    year, month, day = [int(part) for part in value.split("-")]
    return date(year, month, day)


def parse_hevy_datetime(value: str) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
        return parsed
    except ValueError:
        pass
    for fmt in ("%b %d, %Y, %I:%M %p", "%B %d, %Y, %I:%M %p"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    parts = [part.strip() for part in value.split(",")]
    if not parts:
        return None
    date_part = parts[0]
    time_part = parts[1] if len(parts) > 1 else "00:00"
    try:
        day_str, month_label, year_str = date_part.split(" ")
    except ValueError:
        return None
    month = MONTH_INDEX.get(month_label)
    if month is None:
        return None
    hour_str, minute_str = (time_part.split(":") + ["0", "0"])[:2]
    try:
        return datetime(
            int(year_str),
            month + 1,
            int(day_str),
            int(hour_str),
            int(minute_str),
        )
    except ValueError:
        return None


def build_workout_key(title: str, start_time: str) -> str:
    return f"{quote(title or 'Workout')}__{quote(start_time or '')}"


def normalize_text(value: Any) -> str:
    text = "".join(ch.lower() if ch.isalnum() or ch.isspace() else " " for ch in str(value or ""))
    return " ".join(text.split())


@dataclass
class StoreRepository:
    db_path: str

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def list_store(self, store: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute("SELECT data FROM items WHERE store = ?", (store,)).fetchall()
        items: list[dict[str, Any]] = []
        for row in rows:
            try:
                items.append(json.loads(row["data"]))
            except json.JSONDecodeError:
                continue
        return items


class ExerciseRuleEngine:
    def __init__(self) -> None:
        self.rules = [
            (self._normalize_phrases([
                "bench press", "incline bench press", "decline bench press", "chest press", "hex press",
                "chest dip", "push up", "pushup", "bench dip"
            ]), {"Chest": 1, "Triceps": 0.5, "Shoulders": 0.5}),
            (self._normalize_phrases(["pec deck", "butterfly", "chest fly", "dumbbell fly", "cable fly"]), {"Chest": 1}),
            (self._normalize_phrases([
                "pull up", "pull-up", "chin up", "chin-up", "lat pulldown", "lat pull down", "lat prayer"
            ]), {"Lats": 1, "Biceps": 0.5}),
            (self._normalize_phrases([
                "iso lateral row", "iso-lateral row", "seated row", "seated cable row", "v grip row",
                "dumbbell row", "bent over row", "barbell row"
            ]), {"Upper Back": 1, "Biceps": 0.5}),
            (self._normalize_phrases(["shrug"]), {"Traps": 1}),
            (self._normalize_phrases(["face pull", "reverse fly", "reverse flye", "reverse pec deck"]), {"Rear Delts": 1, "Upper Back": 0.5}),
            (self._normalize_phrases(["shoulder press", "overhead press"]), {"Shoulders": 1, "Triceps": 0.5}),
            (self._normalize_phrases(["lateral raise", "side raise"]), {"Shoulders": 1}),
            (self._normalize_phrases(["front raise"]), {"Shoulders": 1}),
            (self._normalize_phrases([
                "bayesian curl", "bicep curl", "biceps curl", "hammer curl", "preacher curl",
                "concentration curl", "lying bicep curl"
            ]), {"Biceps": 1}),
            (self._normalize_phrases([
                "skullcrusher", "triceps pushdown", "tricep pushdown", "cable triceps extension",
                "machine triceps extension", "cable kickback", "triceps extension"
            ]), {"Triceps": 1}),
            (self._normalize_phrases(["wrist curl", "forearm curl"]), {"Forearms": 1}),
            (self._normalize_phrases(["decline crunch", "hanging leg raise", "hanging knee raise", "crunch"]), {"Abs": 1}),
            (self._normalize_phrases(["leg extension"]), {"Quads": 1}),
            (self._normalize_phrases(["leg curl"]), {"Hamstrings": 1}),
            (self._normalize_phrases(["calf raise"]), {"Calves": 1}),
            (self._normalize_phrases(["hip thrust"]), {"Glutes": 1, "Hamstrings": 0.5}),
            (self._normalize_phrases(["hip adduction"]), {"Adductors": 1}),
            (self._normalize_phrases(["hip abduction"]), {"Abductors": 1}),
            (self._normalize_phrases(["leg press"]), {"Quads": 1, "Glutes": 0.5, "Hamstrings": 0.5}),
            (self._normalize_phrases(["romanian deadlift", "rdl", "deadlift"]), {"Glutes": 1, "Hamstrings": 1, "Lower Back": 0.5, "Traps": 0.5}),
            (self._normalize_phrases(["bulgarian split squat", "hack squat", "jump squat", "squat"]), {"Quads": 1, "Glutes": 0.5, "Hamstrings": 0.5}),
        ]

    def _normalize_phrases(self, phrases: list[str]) -> list[str]:
        return [normalize_text(phrase) for phrase in phrases]

    def get_weights(self, exercise_name: str) -> dict[str, float] | None:
        normalized = normalize_text(exercise_name)
        if not normalized:
            return None
        for phrases, weights in self.rules:
            if any(phrase in normalized for phrase in phrases):
                return weights
        return None

    def group_buckets(self, buckets: dict[str, float]) -> dict[str, float]:
        grouped: dict[str, float] = {}
        for muscle, value in buckets.items():
            key = normalize_text(muscle)
            group = muscle
            if key in {"upper back", "lower back", "lats", "traps"}:
                group = "Back"
            elif key in {"adductors", "abductors"}:
                group = "Hip Flexors"
            elif key in {"rear delts", "rear deltoids", "shoulders", "delts", "deltoids"}:
                group = "Delts"
            grouped[group] = grouped.get(group, 0) + value
        return grouped


class AnalyticsService:
    def __init__(self, repository: StoreRepository) -> None:
        self.repository = repository
        self.rule_engine = ExerciseRuleEngine()

    def _state(self) -> dict[str, Any]:
        workout_sets = self.repository.list_store("workoutSets")
        meals = self.repository.list_store("meals")
        sleep = self.repository.list_store("sleep")
        hydration = self.repository.list_store("hydration")
        recovery_notes = self.repository.list_store("recoveryNotes")
        settings = self.repository.list_store("settings")
        return {
            "sessions": self._build_sessions_from_workout_sets(workout_sets),
            "meals": meals,
            "sleep": sleep,
            "hydration": hydration,
            "recoveryNotes": recovery_notes,
            "settings": {item["id"]: item for item in settings if isinstance(item, dict) and item.get("id")},
        }

    def _build_sessions_from_workout_sets(self, workout_sets: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not workout_sets:
            return []
        groups: dict[str, dict[str, Any]] = {}
        for row in workout_sets:
            key = row.get("workout_key") or build_workout_key(str(row.get("title") or "Workout"), str(row.get("start_time") or ""))
            if key not in groups:
                groups[key] = {
                    "id": key,
                    "title": row.get("title") or "Workout",
                    "start_time": row.get("start_time") or "",
                    "end_time": row.get("end_time") or "",
                    "description": row.get("description") or "",
                    "rows": [],
                }
            groups[key]["rows"].append(row)

        sessions: list[dict[str, Any]] = []
        for group in groups.values():
            workout_date = parse_hevy_datetime(group["start_time"])
            iso_date = to_local_iso(workout_date or datetime.now())
            exercises_map: dict[str, dict[str, Any]] = {}
            for row in group["rows"]:
                exercise_key = f"{row.get('exercise_title') or 'Exercise'}__{row.get('superset_id') or ''}__{row.get('exercise_notes') or ''}"
                if exercise_key not in exercises_map:
                    exercises_map[exercise_key] = {
                        "id": str(uuid.uuid4()),
                        "name": row.get("exercise_title") or "Exercise",
                        "muscle": row.get("muscle") or "",
                        "notes": row.get("exercise_notes") or "",
                        "sets": [],
                    }
                exercises_map[exercise_key]["sets"].append({
                    "id": row.get("id") or str(uuid.uuid4()),
                    "name": f"Set {int(row.get('set_index') or 0) + 1}",
                    "reps": int(row.get("reps") or 0),
                    "weight": float(row.get("weight_kg") or 0),
                    "set_index": int(row.get("set_index") or 0),
                    "set_type": row.get("set_type") or "normal",
                    "distance_km": row.get("distance_km"),
                    "duration_seconds": row.get("duration_seconds"),
                    "rpe": row.get("rpe"),
                })
            exercises = []
            for exercise in exercises_map.values():
                exercise["sets"] = sorted(exercise["sets"], key=lambda item: item.get("set_index", 0))
                exercises.append(exercise)
            sessions.append({
                "id": group["id"],
                "date": iso_date,
                "title": group["title"],
                "notes": group["description"],
                "start_time": group["start_time"],
                "end_time": group["end_time"],
                "exercises": exercises,
            })
        return sorted(sessions, key=lambda item: item.get("date", ""), reverse=True)

    def _meal_totals(self, meals: list[dict[str, Any]], date_iso: str) -> dict[str, float]:
        totals = {"calories": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0}
        for meal in meals:
            if meal.get("date") != date_iso:
                continue
            totals["calories"] += float(meal.get("calories") or 0)
            totals["protein"] += float(meal.get("protein") or 0)
            totals["carbs"] += float(meal.get("carbs") or 0)
            totals["fat"] += float(meal.get("fat") or 0)
        return totals

    def compute_session_metrics(self, days: int = 7) -> dict[str, int]:
        current = self._state()
        cutoff = parse_local_iso(to_local_iso(date.today())) - timedelta(days=max(days - 1, 0))
        recent = [session for session in current["sessions"] if parse_local_iso(session["date"]) >= cutoff]
        sets = [set_item for session in recent for exercise in session.get("exercises", []) for set_item in exercise.get("sets", [])]
        volume = sum(float(set_item.get("reps") or 0) * float(set_item.get("weight") or 0) for set_item in sets)
        prs = 0
        for session in recent:
            all_sets = [set_item for exercise in session.get("exercises", []) for set_item in exercise.get("sets", [])]
            top = max((float(set_item.get("weight") or 0) for set_item in all_sets), default=0)
            if top > 0:
                prs += 1
        return {"sessions": len(recent), "sets": len(sets), "volume": round(volume), "prs": prs}

    def compute_volume_by_muscle(self, days: int = 7) -> dict[str, float]:
        cutoff = parse_local_iso(to_local_iso(date.today())) - timedelta(days=max(days - 1, 0))
        current = self._state()
        sessions = [session for session in current["sessions"] if parse_local_iso(session["date"]) >= cutoff]
        return self._volume_buckets_for_sessions(sessions)

    def compute_volume_by_muscle_range(self, range_name: str, date_iso: str) -> dict[str, float]:
        current = self._state()
        base = parse_local_iso(date_iso or to_local_iso(date.today()))
        sessions = []
        for session in current["sessions"]:
            session_date = parse_local_iso(session.get("date", to_local_iso(date.today())))
            if range_name == "day" and session_date == base:
                sessions.append(session)
            elif range_name == "month" and session_date.year == base.year and session_date.month == base.month:
                sessions.append(session)
            elif range_name == "year" and session_date.year == base.year:
                sessions.append(session)
            elif range_name == "all":
                sessions.append(session)
        return self._volume_buckets_for_sessions(sessions)

    def _volume_buckets_for_sessions(self, sessions: list[dict[str, Any]]) -> dict[str, float]:
        buckets: dict[str, float] = {}
        for session in sessions:
            for exercise in session.get("exercises", []):
                set_count = len(exercise.get("sets", []))
                if set_count == 0:
                    continue
                weights = self.rule_engine.get_weights(str(exercise.get("name") or ""))
                if weights:
                    for muscle, weight in weights.items():
                        buckets[muscle] = buckets.get(muscle, 0) + set_count * weight
                else:
                    muscle = exercise.get("muscle") or "Other"
                    buckets[str(muscle)] = buckets.get(str(muscle), 0) + set_count
        return self.rule_engine.group_buckets(buckets)

    def compute_week_summary(self, week_dates: list[str]) -> dict[str, Any]:
        current = self._state()
        sessions_by_date = {session["date"]: session for session in current["sessions"]}
        sleep_by_date = {entry.get("date"): entry for entry in current["sleep"]}
        total_sets = 0
        calories = 0.0
        sleep_values: list[float] = []
        for date_iso in week_dates:
            session = sessions_by_date.get(date_iso)
            if session:
                total_sets += sum(len(exercise.get("sets", [])) for exercise in session.get("exercises", []))
            calories += self._meal_totals(current["meals"], date_iso)["calories"]
            sleep_entry = sleep_by_date.get(date_iso)
            if sleep_entry:
                sleep_values.append(float(sleep_entry.get("hours") or 0))
        avg_calories = round(calories / len(week_dates)) if week_dates else 0
        avg_sleep = f"{(sum(sleep_values) / len(sleep_values)):.1f}" if sleep_values else "0.0"
        return {"totalSets": total_sets, "avgCalories": avg_calories, "avgSleep": avg_sleep}

    def compute_macro_progress(self, date_iso: str) -> dict[str, dict[str, float]]:
        current = self._state()
        totals = self._meal_totals(current["meals"], date_iso)
        targets = current["settings"].get("macroTargets", {})
        return {
            "calories": {"value": totals["calories"], "target": float(targets.get("calories") or 0)},
            "protein": {"value": totals["protein"], "target": float(targets.get("protein") or 0)},
            "carbs": {"value": totals["carbs"], "target": float(targets.get("carbs") or 0)},
            "fat": {"value": totals["fat"], "target": float(targets.get("fat") or 0)},
        }

    def compute_hydration_total(self, date_iso: str) -> dict[str, float]:
        current = self._state()
        total = 0.0
        for entry in current["hydration"]:
            if entry.get("date") == date_iso:
                total += float(entry.get("amount_ml") or 0)
        return {"total": total}

    def build_recovery_timeline(self, limit: int = 30) -> list[dict[str, Any]]:
        current = self._state()
        sleep_map = {entry.get("date"): entry for entry in current["sleep"] if entry.get("date")}
        notes_map = {entry.get("date"): entry for entry in current["recoveryNotes"] if entry.get("date")}
        dates = sorted(set(sleep_map.keys()) | set(notes_map.keys()), reverse=True)
        timeline: list[dict[str, Any]] = []
        for date_iso in dates[:limit]:
            sleep = sleep_map.get(date_iso, {})
            note = notes_map.get(date_iso, {})
            timeline.append({
                "date": date_iso,
                "hours": float(sleep.get("hours") or 0) if sleep else None,
                "quality": int(sleep.get("quality") or 0) if sleep else None,
                "notes": str(note.get("notes") or "").strip(),
            })
        return timeline
