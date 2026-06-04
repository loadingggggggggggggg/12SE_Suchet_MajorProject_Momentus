from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent


def _load_local_env() -> None:
    for env_path in (PROJECT_DIR / ".env", BASE_DIR / ".env"):
        if not env_path.exists():
            continue
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("\"'")
            if key and key not in os.environ:
                os.environ[key] = value


def _env_value(*names: str) -> str:
    _load_local_env()
    for name in names:
        value = os.getenv(name, "").strip().strip("\"'")
        if value:
            return value
    return ""


def _gemini_url() -> str:
    model = _env_value("GEMINI_MODEL") or "gemini-2.5-flash"
    return f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

ALLOWED_MODES = {
    "extract_workout": "Extract workout notes into structured training data.",
    "analyse_training": "Analyse training load, consistency, progression, and fatigue patterns.",
    "analyse_recovery": "Analyse recovery using sleep, soreness, fatigue, mood, and recent training.",
    "analyse_nutrition": "Analyse broad nutrition and hydration patterns.",
    "weekly_summary": "Create a concise weekly training, nutrition, and recovery summary.",
}

WORKOUT_DRAFT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "date": {"type": "string"},
        "title": {"type": "string"},
        "notes": {"type": "string"},
        "exercises": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "muscle": {"type": "string"},
                    "sets": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "reps": {"type": "number"},
                                "weight": {"type": "number"},
                            },
                        },
                    },
                },
            },
        },
    },
}

MEAL_DRAFT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "date": {"type": "string"},
        "name": {"type": "string"},
        "calories": {"type": "number"},
        "protein": {"type": "number"},
        "carbs": {"type": "number"},
        "fat": {"type": "number"},
        "notes": {"type": "string"},
        "needs_confirmation": {"type": "array", "items": {"type": "string"}},
    },
}

ANALYSIS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "detected_type": {"type": "string"},
        "training_load": {"type": "string"},
        "recovery_risk": {"type": "string"},
        "nutrition_flags": {"type": "array", "items": {"type": "string"}},
        "recommendations": {"type": "array", "items": {"type": "string"}},
        "exercise_highlights": {"type": "array", "items": {"type": "string"}},
        "plateaus": {"type": "array", "items": {"type": "string"}},
        "training_modifications": {"type": "array", "items": {"type": "string"}},
        "workout_draft": WORKOUT_DRAFT_SCHEMA,
        "meal_draft": MEAL_DRAFT_SCHEMA,
        "confidence": {"type": "number"},
    },
    "required": [
        "summary",
        "detected_type",
        "training_load",
        "recovery_risk",
        "nutrition_flags",
        "recommendations",
        "exercise_highlights",
        "plateaus",
        "training_modifications",
        "confidence",
    ],
}

FALLBACK_RESULT: dict[str, Any] = {
    "summary": "",
    "detected_type": "unknown",
    "training_load": "not enough data",
    "recovery_risk": "unknown",
    "nutrition_flags": [],
    "recommendations": [],
    "exercise_highlights": [],
    "plateaus": [],
    "training_modifications": [],
    "workout_draft": None,
    "meal_draft": None,
    "confidence": 0,
}


class GeminiConfigurationError(RuntimeError):
    pass


class GeminiServiceError(RuntimeError):
    pass


def _coerce_result(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise GeminiServiceError("Gemini returned an invalid analysis format")

    result = {**FALLBACK_RESULT, **value}
    result["summary"] = str(result.get("summary") or "").strip()
    result["detected_type"] = str(result.get("detected_type") or "unknown").strip() or "unknown"
    result["training_load"] = str(result.get("training_load") or "not enough data").strip() or "not enough data"
    result["recovery_risk"] = str(result.get("recovery_risk") or "unknown").strip() or "unknown"

    nutrition_flags = result.get("nutrition_flags")
    result["nutrition_flags"] = [
        str(item).strip() for item in nutrition_flags if str(item).strip()
    ] if isinstance(nutrition_flags, list) else []

    recommendations = result.get("recommendations")
    result["recommendations"] = [
        str(item).strip() for item in recommendations if str(item).strip()
    ] if isinstance(recommendations, list) else []

    for key in ("exercise_highlights", "plateaus", "training_modifications"):
        values = result.get(key)
        result[key] = [
            str(item).strip() for item in values if str(item).strip()
        ] if isinstance(values, list) else []

    if not isinstance(result.get("workout_draft"), dict):
        result["workout_draft"] = None
    if not isinstance(result.get("meal_draft"), dict):
        result["meal_draft"] = None

    try:
        confidence = float(result.get("confidence", 0))
    except (TypeError, ValueError):
        confidence = 0
    result["confidence"] = max(0, min(1, confidence))
    return result


def _build_prompt(mode: str, user_text: str, context: dict[str, Any]) -> str:
    mode_goal = ALLOWED_MODES.get(mode, ALLOWED_MODES["weekly_summary"])
    compact_context = json.dumps(context or {}, ensure_ascii=True, separators=(",", ":"))[:18000]
    cleaned_text = (user_text or "").strip()[:12000]
    mode_rules = {
        "weekly_summary": """
Dashboard focus:
- Produce one holistic summary across training, nutrition, recovery, habits, and recent consistency.
- Keep workout_draft and meal_draft null.
- Avoid deep exercise programming unless it is a major weekly pattern.
""",
        "analyse_training": """
Training focus:
- Focus on training quality, progression, exercise-specific highlights, plateaus, volume balance, and practical programming changes.
- You may refer to nutrition/recovery only when it directly explains training performance.
- If workout images are attached, extract them into workout_draft using the app shape: date, title, notes, exercises, sets, reps, weight.
- If the image does not show a value, leave that field blank or zero rather than inventing it.
- Keep meal_draft null.
""",
        "extract_workout": """
Workout extraction focus:
- Extract visible workout details into workout_draft using the app shape: date, title, notes, exercises, sets, reps, weight.
- Mention uncertain fields in recommendations.
- Keep meal_draft null.
""",
        "analyse_nutrition": """
Nutrition focus:
- Focus on food, macro totals, hydration, meal timing, and how nutrition supports training/recovery.
- You may refer to training/recovery only when it affects fuelling needs.
- If a food label or food image is attached and the user gives grams/ml consumed, calculate the consumed macros.
- Return meal_draft when enough data exists for a meal log. Leave missing fields blank or zero and list missing details in needs_confirmation.
- If portion size or consumption is unclear, ask what grams/ml or percentage of the serving they ate.
- Keep workout_draft null.
""",
        "analyse_recovery": """
Recovery focus:
- Focus on sleep, fatigue, soreness, stress, recovery notes, and readiness adjustments.
- You may refer to training/nutrition only when it directly affects recovery.
- Keep workout_draft and meal_draft null.
""",
    }.get(mode, "")
    return f"""
You are Momentus AI Coach, a careful assistant for a strength-training tracker.
Goal: {mode_goal}

Rules:
- Return only JSON matching the requested schema.
- Give general training, nutrition, and recovery guidance only.
- Do not diagnose medical conditions or claim certainty.
- Prefer practical, short recommendations an athlete can act on this week.
- Highlight specific exercises when exercise data is available.
- Use the provided plateauCandidates to identify exercises whose best weight or reps have not improved for about 60 days.
- Suggest training modifications such as deloads, rep-range changes, volume changes, exercise variation, technique focus, rest changes, or recovery priorities.
- If workout images are attached, extract visible exercise names, sets, reps, weights, dates, and notes and display clearly. 
- If food images are attached, estimate likely foods and macro ranges, then ask the user to confirm portion size and how much they consumed when unclear.
- If data is incomplete, say what is missing and keep confidence low.
- Use Australian English spelling.

{mode_rules}

User notes:
{cleaned_text or "No direct notes provided."}

Momentus app data:
{compact_context}
""".strip()


def _image_parts(images: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = []
    for image in (images or [])[:4]:
        mime_type = str(image.get("mimeType") or image.get("mime_type") or "").strip()
        data = str(image.get("data") or "").strip()
        if not mime_type.startswith("image/") or not data:
            continue
        parts.append({"inline_data": {"mime_type": mime_type, "data": data}})
    return parts


def analyse_with_gemini(
    mode: str,
    user_text: str,
    context: dict[str, Any],
    images: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    credential = _env_value("GEMINI_API_KEY", "GOOGLE_API_KEY")
    if not credential:
        raise GeminiConfigurationError("GEMINI_API_KEY or GOOGLE_API_KEY is not configured on this server")
    if mode not in ALLOWED_MODES:
        raise GeminiServiceError("Unknown AI analysis mode")

    parts = [{"text": _build_prompt(mode, user_text, context)}]
    parts.extend(_image_parts(images))

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": parts,
            }
        ],
        "generationConfig": {
            "temperature": 0.25,
            "responseMimeType": "application/json",
            "responseSchema": ANALYSIS_SCHEMA,
        },
    }

    headers = {"Content-Type": "application/json"}
    if credential.lower().startswith("bearer "):
        headers["Authorization"] = credential
    else:
        headers["x-goog-api-key"] = credential

    request = urllib.request.Request(
        _gemini_url(),
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise GeminiServiceError(f"Gemini request failed: {error.code} {detail}") from error
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise GeminiServiceError("Could not reach Gemini right now") from error

    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(text)
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
        raise GeminiServiceError("Gemini returned a response Momentus could not parse") from error

    return _coerce_result(parsed)
