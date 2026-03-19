import {
  STORES,
  getAll,
  add,
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

const normalizeText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizePhrases = (phrases) => phrases.map((phrase) => normalizeText(phrase));

const EXERCISE_RULES = [
  {
    phrases: normalizePhrases([
      "bench press",
      "incline bench press",
      "decline bench press",
      "chest press",
      "hex press",
      "chest dip",
      "push up",
      "pushup",
      "bench dip",
    ]),
    muscles: { Chest: 1, Triceps: 0.5, Shoulders: 0.5 },
  },
  {
    phrases: normalizePhrases(["pec deck", "butterfly", "chest fly", "dumbbell fly", "cable fly"]),
    muscles: { Chest: 1 },
  },
  {
    phrases: normalizePhrases([
      "pull up",
      "pull-up",
      "chin up",
      "chin-up",
      "lat pulldown",
      "lat pull down",
      "lat prayer",
    ]),
    muscles: { Lats: 1, Biceps: 0.5 },
  },
  {
    phrases: normalizePhrases([
      "iso lateral row",
      "iso-lateral row",
      "seated row",
      "seated cable row",
      "v grip row",
      "dumbbell row",
      "bent over row",
      "barbell row",
    ]),
    muscles: { "Upper Back": 1, Biceps: 0.5 },
  },
  {
    phrases: normalizePhrases(["shrug"]),
    muscles: { Traps: 1 },
  },
  {
    phrases: normalizePhrases(["face pull", "reverse fly", "reverse flye", "reverse pec deck"]),
    muscles: { "Rear Delts": 1, "Upper Back": 0.5 },
  },
  {
    phrases: normalizePhrases(["shoulder press", "overhead press"]),
    muscles: { Shoulders: 1, Triceps: 0.5 },
  },
  {
    phrases: normalizePhrases(["lateral raise", "side raise"]),
    muscles: { Shoulders: 1 },
  },
  {
    phrases: normalizePhrases(["front raise"]),
    muscles: { Shoulders: 1 },
  },
  {
    phrases: normalizePhrases([
      "bayesian curl",
      "bicep curl",
      "biceps curl",
      "hammer curl",
      "preacher curl",
      "concentration curl",
      "lying bicep curl",
    ]),
    muscles: { Biceps: 1 },
  },
  {
    phrases: normalizePhrases([
      "skullcrusher",
      "triceps pushdown",
      "tricep pushdown",
      "cable triceps extension",
      "machine triceps extension",
      "cable kickback",
      "triceps extension",
    ]),
    muscles: { Triceps: 1 },
  },
  {
    phrases: normalizePhrases(["wrist curl", "forearm curl"]),
    muscles: { Forearms: 1 },
  },
  {
    phrases: normalizePhrases(["decline crunch", "hanging leg raise", "hanging knee raise", "crunch"]),
    muscles: { Abs: 1 },
  },
  {
    phrases: normalizePhrases(["leg extension"]),
    muscles: { Quads: 1 },
  },
  {
    phrases: normalizePhrases(["leg curl"]),
    muscles: { Hamstrings: 1 },
  },
  {
    phrases: normalizePhrases(["calf raise"]),
    muscles: { Calves: 1 },
  },
  {
    phrases: normalizePhrases(["hip thrust"]),
    muscles: { Glutes: 1, Hamstrings: 0.5 },
  },
  {
    phrases: normalizePhrases(["hip adduction"]),
    muscles: { Adductors: 1 },
  },
  {
    phrases: normalizePhrases(["hip abduction"]),
    muscles: { Abductors: 1 },
  },
  {
    phrases: normalizePhrases(["leg press"]),
    muscles: { Quads: 1, Glutes: 0.5, Hamstrings: 0.5 },
  },
  {
    phrases: normalizePhrases(["romanian deadlift", "rdl", "deadlift"]),
    muscles: { Glutes: 1, Hamstrings: 1, "Lower Back": 0.5, Traps: 0.5 },
  },
  {
    phrases: normalizePhrases(["bulgarian split squat", "hack squat", "jump squat", "squat"]),
    muscles: { Quads: 1, Glutes: 0.5, Hamstrings: 0.5 },
  },
];

const getExerciseMuscleWeights = (name) => {
  const normalized = normalizeText(name);
  if (!normalized) return null;
  for (const rule of EXERCISE_RULES) {
    if (rule.phrases.some((phrase) => normalized.includes(phrase))) {
      return rule.muscles;
    }
  }
  return null;
};

const accumulateMuscleVolume = (buckets, weights, setCount) => {
  Object.entries(weights).forEach(([muscle, weight]) => {
    buckets[muscle] = (buckets[muscle] || 0) + setCount * weight;
  });
};

const groupMuscleBuckets = (buckets) => {
  const grouped = {};
  Object.entries(buckets).forEach(([muscle, value]) => {
    const key = normalizeText(muscle);
    let group = muscle;
    if (["upper back", "lower back", "lats", "traps"].includes(key)) {
      group = "Back";
    } else if (["adductors", "abductors"].includes(key)) {
      group = "Hip Flexors";
    } else if (["rear delts", "rear deltoids", "shoulders", "delts", "deltoids"].includes(key)) {
      group = "Delts";
    }
    grouped[group] = (grouped[group] || 0) + value;
  });
  return grouped;
};

const filterSessionsByRange = (range, dateISO) => {
  if (!range) return state.sessions;
  const base = parseLocalISO(dateISO || todayISO());
  return state.sessions.filter((session) => {
    const date = parseLocalISO(session.date || todayISO());
    if (range === "day") {
      return date.toDateString() === base.toDateString();
    }
    if (range === "month") {
      return date.getFullYear() === base.getFullYear() && date.getMonth() === base.getMonth();
    }
    if (range === "year") {
      return date.getFullYear() === base.getFullYear();
    }
    return true;
  });
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

const saveMacroEntry = async (entry) => {
  const item = { id: entry.id || makeId(), ...entry };
  await put(STORES.macros, item);
  await loadAll();
  return item;
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

const getSleepForDate = (date) => state.sleep.find((s) => s.date === date);

const getSessionForDate = (date) => state.sessions.find((s) => s.date === date);

const getRecoveryNoteForDate = (date) => state.recoveryNotes.find((entry) => entry.date === date);

const getMacroTargets = () =>
  state.settings.macroTargets || { calories: 0, protein: 0, carbs: 0, fat: 0, hydration: 0 };

const computeHydrationTotal = (date) => {
  const entry = state.hydration.find((item) => item.date === date);
  return Number(entry?.amount_ml || 0);
};

const computeSessionMetrics = (days = 7) => {
  const cutoff = parseLocalISO(todayISO());
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const recent = state.sessions.filter((session) => parseLocalISO(session.date) >= cutoff);
  const sets = recent.flatMap((session) => session.exercises || []).flatMap((ex) => ex.sets || []);
  const volume = sets.reduce((sum, set) => sum + Number(set.reps || 0) * Number(set.weight || 0), 0);
  const prs = recent.reduce((count, session) => {
    const top = session.exercises?.flatMap((ex) => ex.sets || []).reduce((max, set) => Math.max(max, set.weight || 0), 0) || 0;
    return count + (top > 0 ? 1 : 0);
  }, 0);
  return {
    sessions: recent.length,
    sets: sets.length,
    volume: Math.round(volume),
    prs,
  };
};

const computeVolumeByMuscle = (days = 7) => {
  const cutoff = parseLocalISO(todayISO());
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const buckets = {};
  state.sessions
    .filter((session) => parseLocalISO(session.date) >= cutoff)
    .forEach((session) => {
      (session.exercises || []).forEach((exercise) => {
        const count = (exercise.sets || []).length;
        if (count === 0) return;
        const weights = getExerciseMuscleWeights(exercise.name);
        if (weights) {
          accumulateMuscleVolume(buckets, weights, count);
          return;
        }
        const muscle = exercise.muscle || "Other";
        buckets[muscle] = (buckets[muscle] || 0) + count;
      });
    });
  return groupMuscleBuckets(buckets);
};

const computeVolumeByMuscleRange = (range, dateISO) => {
  const buckets = {};
  filterSessionsByRange(range, dateISO).forEach((session) => {
    (session.exercises || []).forEach((exercise) => {
      const count = (exercise.sets || []).length;
      if (count === 0) return;
      const weights = getExerciseMuscleWeights(exercise.name);
      if (weights) {
        accumulateMuscleVolume(buckets, weights, count);
        return;
      }
      const muscle = exercise.muscle || "Other";
      buckets[muscle] = (buckets[muscle] || 0) + count;
    });
  });
  return groupMuscleBuckets(buckets);
};

const computeProgressSeries = () => {
  const series = state.sessions
    .slice()
    .reverse()
    .map((session) => {
      const sets = session.exercises?.flatMap((ex) => ex.sets || []) || [];
      const bestSet = sets.reduce(
        (best, set) => (set.weight > (best?.weight || 0) ? set : best),
        null
      );
      return {
        label: session.date.slice(5),
        weight: bestSet?.weight || 0,
        reps: bestSet?.reps || 0,
      };
    });
  return series.length ? series : [{ label: "--", weight: 0, reps: 0 }];
};

const computeVolumeTrend = (weeks = 6) => {
  const results = [];
  const now = parseLocalISO(todayISO());
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = new Date(now);
    start.setDate(now.getDate() - i * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const volume = state.sessions
      .filter((session) => {
        const date = parseLocalISO(session.date);
        return date >= start && date <= end;
      })
      .flatMap((session) => session.exercises || [])
      .flatMap((ex) => ex.sets || [])
      .reduce((sum, set) => sum + Number(set.reps || 0) * Number(set.weight || 0), 0);
    results.push({
      label: `${start.getMonth() + 1}/${start.getDate()}`,
      value: Math.round(volume),
    });
  }
  return results;
};

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

const computeMealTotals = (date) => {
  const meals = state.meals.filter((meal) => meal.date === date);
  return meals.reduce(
    (totals, meal) => ({
      calories: totals.calories + Number(meal.calories || 0),
      protein: totals.protein + Number(meal.protein || 0),
      carbs: totals.carbs + Number(meal.carbs || 0),
      fat: totals.fat + Number(meal.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
};

const computeWeekSummary = (weekDates) => {
  const sessions = weekDates
    .map((d) => getSessionForDate(d))
    .filter(Boolean);
  const sets = sessions.flatMap((session) => session.exercises || []).flatMap((ex) => ex.sets || []);
  const totalSets = sets.length;
  const calories = weekDates.reduce((sum, date) => sum + computeMealTotals(date).calories, 0);
  const sleepEntries = weekDates
    .map((d) => getSleepForDate(d))
    .filter(Boolean);
  const avgCalories = weekDates.length ? Math.round(calories / weekDates.length) : 0;
  const avgSleep = sleepEntries.length
    ? (sleepEntries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0) / sleepEntries.length).toFixed(1)
    : "0.0";
  return {
    totalSets,
    avgCalories,
    avgSleep,
  };
};

const computeMacroProgress = (date) => {
  const targets = getMacroTargets();
  const entry = computeMealTotals(date);
  return {
    calories: { value: entry.calories || 0, target: targets.calories || 0 },
    protein: { value: entry.protein || 0, target: targets.protein || 0 },
    carbs: { value: entry.carbs || 0, target: targets.carbs || 0 },
    fat: { value: entry.fat || 0, target: targets.fat || 0 },
  };
};

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
  saveMacroEntry,
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
  computeProgressSeries,
  computeVolumeTrend,
  computeHabitStreak,
  getDayStatus,
  computeWeekSummary,
  computeMealTotals,
  computeMacroProgress,
  computeHydrationTotal,
};
