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

const getByIndex = async (storeName, indexName, value) => {
  const items = await getAll(storeName);
  return items.filter((item) => item?.[indexName] === value);
};

const put = async (storeName, item) => {
  const payload = { ...(item || {}) };
  const id = payload.id || makeId();
  payload.id = id;
  return requestJson(`${API_BASE}/${storeName}/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
};

const add = async (storeName, item) => put(storeName, item);

const remove = async (storeName, id) =>
  requestJson(`${API_BASE}/${storeName}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

const clear = async (storeName) => {
  const items = await getAll(storeName);
  await Promise.all(items.map((item) => remove(storeName, item.id)));
};

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
  getByIndex,
  put,
  add,
  remove,
  clear,
  bulkPut,
  makeId,
  seedIfNeeded,
};
