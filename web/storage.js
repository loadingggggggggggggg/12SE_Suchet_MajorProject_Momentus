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

let unauthorizedHandler = null;

const makeId = () => crypto.randomUUID();

const getCookie = (name) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
};

const buildHeaders = (method, body, extraHeaders = {}) => {
  const headers = { ...extraHeaders };
  if (body !== undefined && !(body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) {
    const csrfToken = getCookie("momentus_csrf");
    if (csrfToken && !headers["X-CSRF-Token"]) {
      headers["X-CSRF-Token"] = csrfToken;
    }
  }
  return headers;
};

const parseErrorMessage = async (response) => {
  try {
    const data = await response.clone().json();
    if (data?.detail) return String(data.detail);
  } catch {
    // fall through to text response
  }
  try {
    const text = await response.text();
    if (text) return text;
  } catch {
    // ignore
  }
  return `Request failed: ${response.status}`;
};

const createHttpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const requestJson = async (path, options = {}) => {
  const method = options.method || "GET";
  const body = options.body;
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    method,
    headers: buildHeaders(method, body, options.headers || {}),
    body: body instanceof FormData || typeof body === "string" ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const message = await parseErrorMessage(response);
    const error = createHttpError(response.status, message);
    if (response.status === 401 && unauthorizedHandler && !options.allowUnauthorized) {
      unauthorizedHandler(error);
    }
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
};

const setUnauthorizedHandler = (handler) => {
  unauthorizedHandler = typeof handler === "function" ? handler : null;
};

const getCurrentUser = async () => {
  try {
    return await requestJson(`${API_BASE}/auth/me`, { allowUnauthorized: true });
  } catch (error) {
    if (error.status === 401) return null;
    throw error;
  }
};

const signup = async ({ displayName, email, password }) =>
  requestJson(`${API_BASE}/auth/signup`, {
    method: "POST",
    body: { displayName, email, password },
  });

const login = async ({ email, password }) =>
  requestJson(`${API_BASE}/auth/login`, {
    method: "POST",
    body: { email, password },
  });

const logout = async () =>
  requestJson(`${API_BASE}/auth/logout`, {
    method: "POST",
  });

const changePassword = async ({ currentPassword, newPassword }) =>
  requestJson(`${API_BASE}/auth/change-password`, {
    method: "POST",
    body: { currentPassword, newPassword },
  });

const requestPasswordReset = async ({ email }) =>
  requestJson(`${API_BASE}/auth/forgot-password`, {
    method: "POST",
    body: { email },
    allowUnauthorized: true,
  });

const resetPassword = async ({ token, newPassword }) =>
  requestJson(`${API_BASE}/auth/reset-password`, {
    method: "POST",
    body: { token, newPassword },
    allowUnauthorized: true,
  });

const getProfile = async () => requestJson(`${API_BASE}/account/profile`);

const updateProfile = async ({ displayName, email }) =>
  requestJson(`${API_BASE}/account/profile`, {
    method: "PUT",
    body: { displayName, email },
  });

const getOnboarding = async () => requestJson(`${API_BASE}/account/onboarding`);

const updateOnboarding = async ({ status, currentStep, answers, version }) =>
  requestJson(`${API_BASE}/account/onboarding`, {
    method: "PUT",
    body: { status, currentStep, answers, version },
  });

const getAccountExportUrl = () => `${API_BASE}/account/export`;

const getAll = async (storeName) => requestJson(`${API_BASE}/${storeName}`);

const getSessionMetrics = async (days = 7) =>
  requestJson(`${API_BASE}/analytics/session-metrics?days=${encodeURIComponent(days)}`);

const getVolumeByMuscle = async ({ days, range, date } = {}) => {
  const params = new URLSearchParams();
  if (days !== undefined && days !== null) params.set("days", String(days));
  if (range) params.set("range", String(range));
  if (date) params.set("date", String(date));
  const query = params.toString();
  return requestJson(`${API_BASE}/analytics/volume-by-muscle${query ? `?${query}` : ""}`);
};

const getWeekSummary = async (weekDates) =>
  requestJson(`${API_BASE}/analytics/week-summary`, {
    method: "POST",
    body: { weekDates },
  });

const getMacroProgress = async (date) =>
  requestJson(`${API_BASE}/analytics/macro-progress?date=${encodeURIComponent(date)}`);

const getHydrationTotal = async (date) =>
  requestJson(`${API_BASE}/analytics/hydration-total?date=${encodeURIComponent(date)}`);

const getRecoveryTimeline = async (limit = 30) =>
  requestJson(`${API_BASE}/analytics/recovery-timeline?limit=${encodeURIComponent(limit)}`);

const analyseWithAi = async ({ mode, text, context, images }) =>
  requestJson(`${API_BASE}/ai/analyse`, {
    method: "POST",
    body: { mode, text, context, images: images || [] },
  });

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
    body: payload,
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
  return requestJson(`${API_BASE}/${storeName}/bulk`, {
    method: "POST",
    body: payload,
  });
};

export {
  STORES,
  setUnauthorizedHandler,
  getCurrentUser,
  signup,
  login,
  logout,
  changePassword,
  requestPasswordReset,
  resetPassword,
  getProfile,
  updateProfile,
  getOnboarding,
  updateOnboarding,
  getAccountExportUrl,
  getAll,
  getSessionMetrics,
  getVolumeByMuscle,
  getWeekSummary,
  getMacroProgress,
  getHydrationTotal,
  getRecoveryTimeline,
  analyseWithAi,
  deleteTrainingData,
  put,
  remove,
  bulkPut,
  makeId,
};
