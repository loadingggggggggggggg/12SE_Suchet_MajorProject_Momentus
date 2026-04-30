const API_BASE = "/api";

const STORES = {
  sessions: "sessions",
  workoutSets: "workoutSets",
  hydration: "hydration",
  habits: "habits",
  macros: "macros",
  meals: "meals",
  foods: "foods",
  sleep: "sleep",
  recoveryNotes: "recoveryNotes",
  settings: "settings",
};

const requestJson = async (path, options = {}) => {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
};

const getAll = async (storeName) =>
  requestJson(`${API_BASE}/${storeName}`);

const getSessionMetrics = async (days = 7) =>
  requestJson(`${API_BASE}/analytics/session-metrics?days=${encodeURIComponent(days)}`);

const getVolumeByMuscle = async ({ days, range, date } = {}) => {
  const params = new URLSearchParams();
  if (days !== undefined && days !== null) params.set("days", String(days));
  if (range) params.set("range", String(range));
  if (date) params.set("date", String(date));
  return requestJson(`${API_BASE}/analytics/volume-by-muscle?${params.toString()}`);
};

const getWeekSummary = async (weekDates) =>
  requestJson(`${API_BASE}/analytics/week-summary`, {
    method: "POST",
    body: JSON.stringify({ weekDates }),
  });

const getMacroProgress = async (date) =>
  requestJson(`${API_BASE}/analytics/macro-progress?date=${encodeURIComponent(date)}`);

const getHydrationTotal = async (date) =>
  requestJson(`${API_BASE}/analytics/hydration-total?date=${encodeURIComponent(date)}`);

const getRecoveryTimeline = async (limit = 30) =>
  requestJson(`${API_BASE}/analytics/recovery-timeline?limit=${encodeURIComponent(limit)}`);

const deleteTrainingData = async () =>
  requestJson(`${API_BASE}/training-data`, {
    method: "DELETE",
  });

const put = async (storeName, item) => {
  const payload = { ...(item || {}) };
  const id = payload.id || makeId();
  payload.id = id;
  return requestJson(`${API_BASE}/${storeName}/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
};

const remove = async (storeName, id) =>
  requestJson(`${API_BASE}/${storeName}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

const bulkPut = async (storeName, items) => {
  const payload = (items || []).map((item) => ({
    ...(item || {}),
    id: item?.id || makeId(),
  }));
  await requestJson(`${API_BASE}/${storeName}/bulk`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return payload;
};

const makeId = () => crypto.randomUUID();

const seedIfNeeded = async () => {
  try {
    return await requestJson(`${API_BASE}/seed`, { method: "POST" });
  } catch (error) {
    console.error("Seed failed:", error);
    return { seeded: false };
  }
};

export {
  STORES,
  getAll,
  getSessionMetrics,
  getVolumeByMuscle,
  getWeekSummary,
  getMacroProgress,
  getHydrationTotal,
  getRecoveryTimeline,
  deleteTrainingData,
  put,
  remove,
  bulkPut,
  makeId,
  seedIfNeeded,
};
