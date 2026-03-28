import {
  STORES,
  getAll,
  getSessionMetrics as fetchSessionMetrics,
  getVolumeByMuscle as fetchVolumeByMuscle,
  getWeekSummary as fetchWeekSummary,
  getMacroProgress as fetchMacroProgress,
  getHydrationTotal as fetchHydrationTotal,
  getRecoveryTimeline as fetchRecoveryTimeline,
  put,
  remove,
  bulkPut,
  makeId,
  seedIfNeeded,
} from "./storage.js";

const state = {
  sessions: [],
  workoutSets: [],
  legacySessions: [],
  hydration: [],
  habits: [],
  macros: [],
  meals: [],
  foods: [],
  sleep: [],
  recoveryNotes: [],
  settings: {},
};

const toLocalISO = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseLocalISO = (iso) => {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_INDEX = MONTH_LABELS.reduce((acc, label, index) => {
  acc[label] = index;
  return acc;
}, {});

const parseHevyDateTime = (value) => {
  if (!value) return null;
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;
  const [datePart, timePart] = value.split(",").map((part) => part.trim());
  if (!datePart) return null;
  const [dayStr, monthStr, yearStr] = datePart.split(" ");
  const month = MONTH_INDEX[monthStr];
  if (month === undefined) return null;
  const [hourStr = "0", minuteStr = "0"] = (timePart || "0:0").split(":");
  const year = Number(yearStr);
  const day = Number(dayStr);
  const hours = Number(hourStr);
  const minutes = Number(minuteStr);
  if (Number.isNaN(year) || Number.isNaN(day)) return null;
  return new Date(year, month, day, hours, minutes);
};

const formatHevyDateTimeFromISO = (isoDate, time = "00:00") => {
  const [year, month, day] = isoDate.split("-").map(Number);
  const [hourStr = "0", minuteStr = "0"] = time.split(":");
  const hours = Number(hourStr);
  const minutes = Number(minuteStr);
  const date = new Date(year, (month || 1) - 1, day || 1, hours, minutes);
  const label = MONTH_LABELS[date.getMonth()];
  return `${date.getDate()} ${label} ${date.getFullYear()}, ${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
};

const buildWorkoutKey = (title, startTime) =>
  `${encodeURIComponent(title || "Workout")}__${encodeURIComponent(startTime || "")}`;

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
};

const normalizeWorkoutRow = (row) => {
  const title = row.title || "Workout";
  const startTime = row.start_time || "";
  const workoutKey = row.workout_key || buildWorkoutKey(title, startTime);
  const startDate = parseHevyDateTime(startTime);
  return {
    id: row.id || makeId(),
    workout_key: workoutKey,
    title,
    start_time: startTime,
    end_time: row.end_time || "",
    description: row.description || "",
    exercise_title: row.exercise_title || "Exercise",
    superset_id: row.superset_id || "",
    exercise_notes: row.exercise_notes || "",
    muscle: row.muscle || "",
    set_index: Number.isFinite(Number(row.set_index)) ? Number(row.set_index) : 0,
    set_type: row.set_type || "normal",
    weight_kg: toNumberOrNull(row.weight_kg),
    reps: toNumberOrNull(row.reps),
    distance_km: toNumberOrNull(row.distance_km),
    duration_seconds: toNumberOrNull(row.duration_seconds),
    rpe: toNumberOrNull(row.rpe),
    start_date: startDate ? toLocalISO(startDate) : "",
  };
};

const buildSessionsFromWorkoutSets = (workoutSets) => {
  if (!workoutSets.length) return [];
  const groups = new Map();
  workoutSets.forEach((row) => {
    const key = row.workout_key || buildWorkoutKey(row.title, row.start_time);
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        title: row.title || "Workout",
        start_time: row.start_time || "",
        end_time: row.end_time || "",
        description: row.description || "",
        rows: [],
      });
    }
    groups.get(key).rows.push(row);
  });

  const sessions = Array.from(groups.values()).map((group) => {
    const workoutDate = parseHevyDateTime(group.start_time);
    const date = workoutDate ? toLocalISO(workoutDate) : todayISO();
    const exercisesMap = new Map();
    group.rows.forEach((row) => {
      const exerciseKey = `${row.exercise_title || "Exercise"}__${row.superset_id || ""}__${row.exercise_notes || ""}`;
      if (!exercisesMap.has(exerciseKey)) {
        exercisesMap.set(exerciseKey, {
          id: makeId(),
          name: row.exercise_title || "Exercise",
          muscle: row.muscle || "",
          notes: row.exercise_notes || "",
          sets: [],
        });
      }
      exercisesMap.get(exerciseKey).sets.push({
        id: row.id || makeId(),
        name: `Set ${Number(row.set_index || 0) + 1}`,
        reps: Number(row.reps || 0),
        weight: Number(row.weight_kg || 0),
        set_index: Number(row.set_index || 0),
        set_type: row.set_type || "normal",
        distance_km: row.distance_km ?? null,
        duration_seconds: row.duration_seconds ?? null,
        rpe: row.rpe ?? null,
      });
    });

    const exercises = Array.from(exercisesMap.values()).map((exercise) => ({
      ...exercise,
      sets: exercise.sets.sort((a, b) => a.set_index - b.set_index),
    }));

    return {
      id: group.id,
      date,
      title: group.title,
      notes: group.description,
      start_time: group.start_time,
      end_time: group.end_time,
      exercises,
    };
  });

  return sessions.sort((a, b) => b.date.localeCompare(a.date));
};

const todayISO = () => toLocalISO(new Date());

const initState = async () => {
  await seedIfNeeded();
  await loadAll();
  if (state.workoutSets.length === 0 && state.legacySessions.length > 0) {
    await importLegacySessions(state.legacySessions);
    await loadAll();
  }
  return state;
};

const loadAll = async () => {
  const [sessions, workoutSets, hydration, habits, macros, meals, foods, sleep, recoveryNotes, settings] = await Promise.all([
    getAll(STORES.sessions),
    getAll(STORES.workoutSets),
    getAll(STORES.hydration),
    getAll(STORES.habits),
    getAll(STORES.macros),
    getAll(STORES.meals),
    getAll(STORES.foods),
    getAll(STORES.sleep),
    getAll(STORES.recoveryNotes),
    getAll(STORES.settings),
  ]);
  state.workoutSets = workoutSets;
  state.hydration = hydration;
  state.legacySessions = sessions;
  const derivedSessions = buildSessionsFromWorkoutSets(workoutSets);
  state.sessions = derivedSessions.length
    ? derivedSessions
    : sessions.sort((a, b) => b.date.localeCompare(a.date));
  state.habits = habits;
  state.macros = macros;
  state.meals = meals;
  state.foods = foods;
  state.sleep = sleep;
  state.recoveryNotes = recoveryNotes;
  state.settings = settings.reduce((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {});
};

const deleteWorkoutByKey = async (workoutKey) => {
  const targetKey = workoutKey || "";
  const matches = state.workoutSets.filter((row) => {
    const key = row.workout_key || buildWorkoutKey(row.title, row.start_time);
    return key === targetKey;
  });
  if (matches.length === 0) return;
  await Promise.all(matches.map((row) => remove(STORES.workoutSets, row.id)));
};

const importWorkoutRows = async (rows) => {
  if (!rows.length) return 0;
  const normalized = rows.map((row) => normalizeWorkoutRow(row));
  await bulkPut(STORES.workoutSets, normalized);
  await loadAll();
  return normalized.length;
};

const importLegacySessions = async (sessions) => {
  if (!sessions.length) return 0;
  const rows = [];
  sessions.forEach((session) => {
    const isoDate = session.date || todayISO();
    const startTime = formatHevyDateTimeFromISO(isoDate);
    const endTime = startTime;
    const workoutKey = buildWorkoutKey(session.title || "Workout", startTime);
    (session.exercises || []).forEach((exercise) => {
      (exercise.sets || []).forEach((set, index) => {
        rows.push(
          normalizeWorkoutRow({
            id: set.id || makeId(),
            workout_key: workoutKey,
            title: session.title || "Workout",
            start_time: startTime,
            end_time: endTime,
            description: session.notes || "",
            exercise_title: exercise.name || "Exercise",
            superset_id: "",
            exercise_notes: exercise.notes || "",
            muscle: exercise.muscle || "",
            set_index: index,
            set_type: "normal",
            weight_kg: Number(set.weight || 0),
            reps: Number(set.reps || 0),
            distance_km: null,
            duration_seconds: null,
            rpe: null,
          })
        );
      });
    });
  });
  if (rows.length > 0) {
    await bulkPut(STORES.workoutSets, rows);
  }
  return rows.length;
};

const saveHabit = async (date, data) => {
  const existing = state.habits.find((h) => h.date === date);
  const entry = {
    id: existing?.id || makeId(),
    date,
    creatine: !!data.creatine,
    electrolytes: data.electrolytes ?? data.protein ?? false,
  };
  await put(STORES.habits, entry);
  await loadAll();
  return entry;
};

const saveSession = async (session) => {
  const isoDate = session.date || todayISO();
  const startTime = session.start_time || formatHevyDateTimeFromISO(isoDate);
  const endTime = session.end_time || startTime;
  const workoutKey = buildWorkoutKey(session.title || "Workout", startTime);

  if (session.id) {
    await deleteWorkoutByKey(session.id);
  }

  const rows = [];
  (session.exercises || []).forEach((exercise) => {
    (exercise.sets || []).forEach((set, index) => {
      rows.push(
        normalizeWorkoutRow({
          id: set.id || makeId(),
          workout_key: workoutKey,
          title: session.title || "Workout",
          start_time: startTime,
          end_time: endTime,
          description: session.notes || "",
          exercise_title: exercise.name || "Exercise",
          superset_id: "",
          exercise_notes: exercise.notes || "",
          muscle: exercise.muscle || "",
          set_index: index,
          set_type: "normal",
          weight_kg: Number(set.weight || 0),
          reps: Number(set.reps || 0),
          distance_km: null,
          duration_seconds: null,
          rpe: null,
        })
      );
    });
  });

  if (rows.length > 0) {
    await bulkPut(STORES.workoutSets, rows);
  }
  await loadAll();
  return { ...session, id: workoutKey };
};

const deleteSession = async (id) => {
  await deleteWorkoutByKey(id);
  await loadAll();
};

const saveMacroTargets = async (targets) => {
  const entry = { id: "macroTargets", ...targets };
  await put(STORES.settings, entry);
  await loadAll();
  return entry;
};

const addHydration = async (date, amountMl) => {
  const existing = state.hydration.find((entry) => entry.date === date);
  const current = Number(existing?.amount_ml || 0);
  const next = Math.max(0, current + Number(amountMl || 0));
  const entry = {
    id: existing?.id || makeId(),
    date,
    amount_ml: next,
  };
  await put(STORES.hydration, entry);
  await loadAll();
  return entry;
};

const saveSleepEntry = async (entry) => {
  const item = { id: entry.id || makeId(), ...entry };
  await put(STORES.sleep, item);
  await loadAll();
  return item;
};

const saveRecoveryNote = async (date, notes) => {
  const existing = state.recoveryNotes.find((entry) => entry.date === date);
  const item = {
    id: existing?.id || `note-${date}`,
    date,
    notes: notes || "",
  };
  await put(STORES.recoveryNotes, item);
  await loadAll();
  return item;
};

const saveMeal = async (entry) => {
  const item = { id: entry.id || makeId(), ...entry };
  await put(STORES.meals, item);
  await loadAll();
  return item;
};

const deleteMeal = async (id) => {
  await remove(STORES.meals, id);
  await loadAll();
};

const getHabitForDate = (date) => state.habits.find((h) => h.date === date);

const getSessionForDate = (date) => state.sessions.find((s) => s.date === date);

const getRecoveryNoteForDate = (date) => state.recoveryNotes.find((entry) => entry.date === date);

const getMacroTargets = () =>
  state.settings.macroTargets || { calories: 0, protein: 0, carbs: 0, fat: 0, hydration: 0 };

const computeHydrationTotal = async (date) => {
  const result = await fetchHydrationTotal(date);
  return Number(result?.total || 0);
};

const computeSessionMetrics = async (days = 7) => fetchSessionMetrics(days);

const computeVolumeByMuscle = async (days = 7) => fetchVolumeByMuscle({ days });

const computeVolumeByMuscleRange = async (range, dateISO) => fetchVolumeByMuscle({ range, date: dateISO });

const computeHabitStreak = () => {
  const sorted = state.habits.slice().sort((a, b) => b.date.localeCompare(a.date));
  let streak = 0;
  let cursor = parseLocalISO(todayISO());
  let cursorISO = toLocalISO(cursor);
  for (let i = 0; i < sorted.length; i += 1) {
    const entry = sorted[i];
    if (entry.date !== cursorISO) {
      break;
    }
    const electrolytes = entry.electrolytes ?? entry.protein ?? false;
    if (entry.creatine || electrolytes) {
      streak += 1;
    } else {
      break;
    }
    cursor.setDate(cursor.getDate() - 1);
    cursorISO = toLocalISO(cursor);
  }
  return streak;
};

const getDayStatus = (date) => {
  const session = getSessionForDate(date);
  const habit = getHabitForDate(date);
  const electrolytes = habit?.electrolytes ?? habit?.protein ?? false;
  const score = (session ? 1 : 0) + (habit?.creatine ? 1 : 0) + (electrolytes ? 1 : 0);
  if (score >= 3) return "good";
  if (score >= 1) return "mid";
  return "miss";
};

const computeWeekSummary = async (weekDates) => fetchWeekSummary(weekDates);

const computeMacroProgress = async (date) => fetchMacroProgress(date);

const computeRecoveryTimeline = async (limit = 30) => fetchRecoveryTimeline(limit);

export {
  state,
  initState,
  loadAll,
  todayISO,
  saveHabit,
  saveSession,
  deleteSession,
  importWorkoutRows,
  saveMacroTargets,
  addHydration,
  saveSleepEntry,
  saveRecoveryNote,
  saveMeal,
  deleteMeal,
  getHabitForDate,
  getRecoveryNoteForDate,
  getMacroTargets,
  computeSessionMetrics,
  computeVolumeByMuscle,
  computeVolumeByMuscleRange,
  computeHabitStreak,
  getDayStatus,
  computeWeekSummary,
  computeMacroProgress,
  computeHydrationTotal,
  computeRecoveryTimeline,
};
