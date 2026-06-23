import { initRouter } from "./router.js";
import { renderLineChart, renderPieChart, renderRingChart } from "./charts.js";
import { renderCalendar } from "./calendar.js";
import {
  state,
  initState,
  todayISO,
  saveHabit,
  saveSession,
  deleteSession,
  importWorkoutRows,
  deleteAllTrainingData,
  saveMacroTargets,
  addHydration,
  saveSleepEntry,
  saveMeal,
  saveFood,
  deleteMeal,
  getHabitForDate,
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
  saveRecoveryNote,
  getRecoveryNoteForDate,
} from "./state.js";
import {
  changePassword,
  getAccountExportUrl,
  getCurrentUser,
  getOnboarding,
  analyseWithAi,
  logout,
  setUnauthorizedHandler,
  updateOnboarding,
  updateProfile,
} from "./storage.js?v=ai-coach-4";
import { ONBOARDING_STEPS, ONBOARDING_VERSION } from "./onboarding-config.js";

const setupSplash = () => {
  const splash = document.getElementById("splash");
  if (!splash) return;
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hideSplash = () => {
    splash.classList.add("splash--hide");
    const remove = () => splash.remove();
    splash.addEventListener("transitionend", remove, { once: true });
    setTimeout(remove, prefersReduced ? 0 : 900);
  };
  setTimeout(hideSplash, prefersReduced ? 0 : 600);
};

const setupDragAndDrop = () => {
  const grids = document.querySelectorAll("#screen-dashboard .bento-grid");
  const getCardAtPoint = (container, x, y) => {
    const elements = container.querySelectorAll(".card:not(.dragging)");
    let closest = null;
    let closestDist = Number.POSITIVE_INFINITY;
    elements.forEach((card) => {
      const rect = card.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dist = Math.hypot(cx - x, cy - y);
      if (dist < closestDist) {
        closestDist = dist;
        closest = card;
      }
    });
    return closest;
  };

  const slugify = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "card";

  grids.forEach((grid, index) => {
    const gridId = grid.closest(".screen")?.id || grid.dataset.gridId || `grid-${index}`;
    grid.dataset.gridId = gridId;
    const storageKey = `momentus:layout:${gridId}`;
    const cards = grid.querySelectorAll(".card");

    const assignCardIds = () => {
      const seen = new Set();
      cards.forEach((card, cardIndex) => {
        const existing = card.getAttribute("data-card-id") || card.id;
        if (existing) {
          card.dataset.cardId = existing;
          seen.add(existing);
          return;
        }
        const title = card.querySelector(".card-header h3")?.textContent || `card-${cardIndex}`;
        let slug = slugify(title);
        let suffix = 1;
        while (seen.has(slug)) {
          slug = `${slugify(title)}-${suffix}`;
          suffix += 1;
        }
        seen.add(slug);
        card.dataset.cardId = slug;
      });
    };

    const applySavedOrder = () => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        const order = JSON.parse(raw);
        if (!Array.isArray(order)) return;
        order.forEach((id) => {
          const card = grid.querySelector(`.card[data-card-id="${id}"]`);
          if (card) grid.appendChild(card);
        });
      } catch (error) {
        console.warn("Failed to restore layout", error);
      }
    };

    const saveOrder = () => {
      try {
        const order = Array.from(grid.querySelectorAll(".card"))
          .map((card) => card.dataset.cardId)
          .filter(Boolean);
        localStorage.setItem(storageKey, JSON.stringify(order));
      } catch (error) {
        console.warn("Failed to save layout", error);
      }
    };

    assignCardIds();
    applySavedOrder();

    cards.forEach((card) => {
      const header = card.querySelector(".card-header");
      if (header && !header.querySelector(".drag-handle")) {
        const handle = document.createElement("button");
        handle.type = "button";
        handle.className = "drag-handle";
        handle.setAttribute("aria-label", "Drag card");
        handle.textContent = "⋮⋮";
        header.prepend(handle);
        handle.addEventListener("pointerdown", () => {
          card.setAttribute("draggable", "true");
        });
        handle.addEventListener("pointerup", () => {
          card.setAttribute("draggable", "false");
        });
        handle.addEventListener("pointerleave", () => {
          card.setAttribute("draggable", "false");
        });
      }

      card.setAttribute("draggable", "false");
      card.addEventListener("dragstart", (event) => {
        card.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        lastTargetId = null;
        lastBefore = null;
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
        card.setAttribute("draggable", "false");
        saveOrder();
        lastTargetId = null;
        lastBefore = null;
      });
    });

    let lastTargetId = null;
    let lastBefore = null;

    grid.addEventListener("dragover", (event) => {
      event.preventDefault();
      const dragging = grid.querySelector(".dragging");
      if (!dragging) return;
      const target = getCardAtPoint(grid, event.clientX, event.clientY, dragging);
      if (!target || target === dragging) return;
      const rect = target.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      const targetId = target.dataset.cardId || target.id || "";
      if (targetId === lastTargetId && before === lastBefore) return;
      if (before && dragging.nextSibling === target) {
        lastTargetId = targetId;
        lastBefore = before;
        return;
      }
      if (!before && target.nextSibling === dragging) {
        lastTargetId = targetId;
        lastBefore = before;
        return;
      }
      if (before) {
        grid.insertBefore(dragging, target);
      } else {
        grid.insertBefore(dragging, target.nextSibling);
      }
      lastTargetId = targetId;
      lastBefore = before;
    });
  });
};

const ui = {
  todayLabel: document.getElementById("todayLabel"),
  calendarView: document.getElementById("calendarView"),
  weekSummary: document.getElementById("weekSummary"),
  habitCreatine: document.getElementById("habitCreatine"),
  habitElectrolytes: document.getElementById("habitElectrolytes"),
  habitStreak: document.getElementById("habitStreak"),
  habitDateLabel: document.getElementById("habitDateLabel"),
  saveHabitsButton: document.getElementById("saveHabitsButton"),
  metricSessions: document.getElementById("metricSessions"),
  metricSets: document.getElementById("metricSets"),
  metricVolume: document.getElementById("metricVolume"),
  metricPRs: document.getElementById("metricPRs"),
  progressChart: document.getElementById("progressChart"),
  progressExercise: document.getElementById("progressExercise"),
  progressRange: document.getElementById("progressRange"),
  exerciseOptions: document.getElementById("exerciseOptions"),
  volumeChart: document.getElementById("volumeChart"),
  muscleDistributionChart: document.getElementById("muscleDistributionChart"),
  dashboardSleepChart: document.getElementById("dashboardSleepChart"),
  dashboardCalendarMonth: document.getElementById("dashboardCalendarMonth"),
  trainingCalendarView: document.getElementById("trainingCalendarView"),
  trainingCalendarMonth: document.getElementById("trainingCalendarMonth"),
  trainingCalendarYear: document.getElementById("trainingCalendarYear"),
  macroDatePicker: document.getElementById("macroDatePicker"),
  macroPrevDay: document.getElementById("macroPrevDay"),
  macroNextDay: document.getElementById("macroNextDay"),
  sessionList: document.getElementById("sessionList"),
  importWorkoutsButton: document.getElementById("importWorkoutsButton"),
  deleteTrainingDataButton: document.getElementById("deleteTrainingDataButton"),
  workoutFileInput: document.getElementById("workoutFileInput"),
  importStatus: document.getElementById("importStatus"),
  addSessionButton: document.getElementById("addSessionButton"),
  sessionForm: document.getElementById("sessionForm"),
  sessionDate: document.getElementById("sessionDate"),
  sessionTitle: document.getElementById("sessionTitle"),
  sessionNotes: document.getElementById("sessionNotes"),
  addExerciseButton: document.getElementById("addExerciseButton"),
  resetSessionButton: document.getElementById("resetSessionButton"),
  exerciseBuilder: document.getElementById("exerciseBuilder"),
  macroTargetsForm: document.getElementById("macroTargetsForm"),
  targetCalories: document.getElementById("targetCalories"),
  targetProtein: document.getElementById("targetProtein"),
  targetCarbs: document.getElementById("targetCarbs"),
  targetFat: document.getElementById("targetFat"),
  targetHydration: document.getElementById("targetHydration"),
  macroChart: document.getElementById("macroChart"),
  macroChartCard: document.getElementById("macroChartCard"),
  hydrationTotal: document.getElementById("hydrationTotal"),
  hydrationGoal: document.getElementById("hydrationGoal"),
  hydrationProgress: document.getElementById("hydrationProgress"),
  addHydrationButton: document.getElementById("addHydrationButton"),
  removeHydrationButton: document.getElementById("removeHydrationButton"),
  mealForm: document.getElementById("mealForm"),
  mealDate: document.getElementById("mealDate"),
  mealName: document.getElementById("mealName"),
  mealCalories: document.getElementById("mealCalories"),
  mealProtein: document.getElementById("mealProtein"),
  mealCarbs: document.getElementById("mealCarbs"),
  mealFat: document.getElementById("mealFat"),
  mealNotes: document.getElementById("mealNotes"),
  mealList: document.getElementById("mealList"),
  foodSearchInput: document.getElementById("foodSearchInput"),
  foodSearchResults: document.getElementById("foodSearchResults"),
  sleepForm: document.getElementById("sleepForm"),
  sleepDate: document.getElementById("sleepDate"),
  sleepHours: document.getElementById("sleepHours"),
  sleepQuality: document.getElementById("sleepQuality"),
  sleepRange: document.getElementById("sleepRange"),
  sleepMetric: document.getElementById("sleepMetric"),
  sleepTrendSubtitle: document.getElementById("sleepTrendSubtitle"),
  sleepChart: document.getElementById("sleepChart"),
  recoveryNotesForm: document.getElementById("recoveryNotesForm"),
  recoveryNotesDate: document.getElementById("recoveryNotesDate"),
  recoveryNotesText: document.getElementById("recoveryNotesText"),
  recoveryTimelineList: document.getElementById("recoveryTimelineList"),
  greetingLabel: document.getElementById("greetingLabel"),
  syncStatus: document.getElementById("syncStatus"),
  landingButton: document.getElementById("landingButton"),
  logoutButton: document.getElementById("logoutButton"),
  profileForm: document.getElementById("profileForm"),
  profileDisplayName: document.getElementById("profileDisplayName"),
  profileEmail: document.getElementById("profileEmail"),
  profileStatus: document.getElementById("profileStatus"),
  accountOnboardingStatus: document.getElementById("accountOnboardingStatus"),
  accountOnboardingSummary: document.getElementById("accountOnboardingSummary"),
  resumeOnboardingButton: document.getElementById("resumeOnboardingButton"),
  restartOnboardingButton: document.getElementById("restartOnboardingButton"),
  passwordForm: document.getElementById("passwordForm"),
  currentPassword: document.getElementById("currentPassword"),
  newPassword: document.getElementById("newPassword"),
  confirmPassword: document.getElementById("confirmPassword"),
  passwordStatus: document.getElementById("passwordStatus"),
  exportDataButton: document.getElementById("exportDataButton"),
  accountDeleteTrainingDataButton: document.getElementById("accountDeleteTrainingDataButton"),
  accountDataStatus: document.getElementById("accountDataStatus"),
  mealSaveToFoods: document.getElementById("mealSaveToFoods"),
  aiCoachForm: document.getElementById("aiCoachForm"),
  aiMode: document.getElementById("aiMode"),
  aiNotes: document.getElementById("aiNotes"),
  aiAnalyseButton: document.getElementById("aiAnalyseButton"),
  aiStatus: document.getElementById("aiStatus"),
  aiResult: document.getElementById("aiResult"),
  aiCards: document.querySelectorAll("[data-ai-card]"),

};

const calendarState = {
  view: "month",
  anchorDate: new Date(),
  month: new Date().getMonth(),
};

const trainingCalendarState = {
  view: "month",
  anchorDate: new Date(),
  month: new Date().getMonth(),
};

let editingSessionId = null;
let selectedHabitDate = todayISO();
let volumeRangeState = "7";
let muscleRangeState = "7";
let macroDate = todayISO();
let currentUser = null;
let accountOnboardingState = {
  status: "pending",
  currentStep: 0,
  answers: {},
  version: ONBOARDING_VERSION,
};

const setInlineFeedback = (element, message = "", tone = "") => {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("success-text", tone === "success");
  element.classList.toggle("error-text", tone === "error");
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const readAiImages = async (input) => {
  const files = Array.from(input?.files || []).slice(0, 4);
  const maxBytes = 4 * 1024 * 1024;
  const images = await Promise.all(
    files
      .filter((file) => file.type.startsWith("image/") && file.size <= maxBytes)
      .map(
        (file) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.addEventListener("load", () => {
              const dataUrl = String(reader.result || "");
              const [, data = ""] = dataUrl.split(",", 2);
              resolve({ mimeType: file.type, data });
            });
            reader.addEventListener("error", () => reject(reader.error));
            reader.readAsDataURL(file);
          })
      )
  );
  return images;
};

const setCurrentUser = (user) => {
  currentUser = user || null;
  const displayName = currentUser?.displayName || "Athlete";
  if (ui.greetingLabel) {
    ui.greetingLabel.textContent = `Hey, ${displayName}`;
  }
  if (ui.syncStatus) {
    ui.syncStatus.textContent = currentUser ? "Account Synced" : "Signed Out";
  }
};

const describeOnboardingStatus = (stateValue) => {
  const status = stateValue?.status || currentUser?.onboardingStatus || "pending";
  const step = Math.min(Math.max(Number(stateValue?.currentStep || 0), 0), ONBOARDING_STEPS.length - 1) + 1;
  if (status === "completed") {
    return {
      label: "Complete",
      summary: "Your setup is complete and can be updated anytime.",
      complete: true,
    };
  }
  if (status === "skipped") {
    return {
      label: "Skipped",
      summary: `Resume whenever you're ready. Your last saved step is ${step} of ${ONBOARDING_STEPS.length}.`,
      complete: false,
    };
  }
  return {
    label: "In Progress",
    summary: `Your answers save to your account. Continue from step ${step} of ${ONBOARDING_STEPS.length}.`,
    complete: false,
  };
};

const renderAccount = async () => {
  if (!currentUser) return;
  try {
    accountOnboardingState = await getOnboarding();
    if (ui.profileDisplayName) ui.profileDisplayName.value = currentUser.displayName || "";
    if (ui.profileEmail) ui.profileEmail.value = currentUser.email || "";
    const onboardingStatus = describeOnboardingStatus(accountOnboardingState);
    if (ui.accountOnboardingStatus) {
      ui.accountOnboardingStatus.textContent = onboardingStatus.label;
      ui.accountOnboardingStatus.classList.toggle("status-pill--complete", onboardingStatus.complete);
    }
    if (ui.accountOnboardingSummary) {
      ui.accountOnboardingSummary.textContent = onboardingStatus.summary;
    }
    if (ui.resumeOnboardingButton) {
      ui.resumeOnboardingButton.textContent =
        accountOnboardingState.status === "completed" ? "Edit Onboarding" : "Resume Onboarding";
    }
  } catch (error) {
    setInlineFeedback(ui.accountDataStatus, error.message || "Could not load account details.", "error");
  }
};

const deleteTrainingDataForAccount = async (statusTarget, emptyMessageTarget = statusTarget) => {
  if (state.workoutSets.length === 0 && state.legacySessions.length === 0) {
    setInlineFeedback(emptyMessageTarget, "No training data to delete.");
    updateTrainingDeleteControl();
    return;
  }
  const confirmed = window.confirm("Delete all training data from this account?");
  if (!confirmed) return;
  const deleted = await deleteAllTrainingData();
  const message = deleted > 0 ? `Deleted ${deleted} training records.` : "No training data to delete.";
  setInlineFeedback(statusTarget, message, deleted > 0 ? "success" : "");
  renderSessionsList();
  await updateDashboard();
  await renderCalendarView();
  await renderAccount();
};

const DEFAULT_MUSCLE_GROUPS = [
  "Abs",
  "Back",
  "Biceps",
  "Calves",
  "Chest",
  "Forearms",
  "Glutes",
  "Hamstrings",
  "Hip Flexors",
  "Lats",
  "Lower Back",
  "Quads",
  "Rear Delts",
  "Shoulders",
  "Traps",
  "Triceps",
  "Upper Back",
];

const populateYearSelect = (selectEl, selectedYear) => {
  if (!selectEl) return;
  const currentYear = new Date().getFullYear();
  selectEl.innerHTML = "";
  for (let y = currentYear; y >= currentYear - 5; y -= 1) {
    const option = document.createElement("option");
    option.value = String(y);
    option.textContent = String(y);
    if (y === selectedYear) option.selected = true;
    selectEl.appendChild(option);
  }
};

const setDefaultDates = () => {
  const today = todayISO();
  [ui.sessionDate, ui.mealDate, ui.sleepDate].forEach((input) => {
    if (input) input.value = today;
  });
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  calendarState.month = currentMonth;
  trainingCalendarState.month = currentMonth;
  if (ui.dashboardCalendarMonth) ui.dashboardCalendarMonth.value = String(currentMonth);
  if (ui.trainingCalendarMonth) ui.trainingCalendarMonth.value = String(currentMonth);
  populateYearSelect(ui.trainingCalendarYear, currentYear);
  if (ui.macroDatePicker) ui.macroDatePicker.value = today;
  macroDate = today;
  if (ui.sleepRange) ui.sleepRange.value = "14";
  if (ui.sleepMetric) ui.sleepMetric.value = "hours";
  volumeRangeState = "7";
  muscleRangeState = "7";
  if (ui.recoveryNotesDate) ui.recoveryNotesDate.value = today;
  if (ui.todayLabel) {
    const pretty = new Date().toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    ui.todayLabel.textContent = pretty;
  }
};

const formatHabitDateLabel = (iso) => {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const updateHabitsUI = (date = selectedHabitDate) => {
  selectedHabitDate = date;
  const habit = getHabitForDate(date);
  ui.habitCreatine.checked = habit?.creatine || false;
  ui.habitElectrolytes.checked = habit?.electrolytes ?? habit?.protein ?? false;
  ui.habitStreak.textContent = `Streak: ${computeHabitStreak()} days`;
  if (ui.habitDateLabel) {
    ui.habitDateLabel.textContent = date === todayISO() ? "Today" : formatHabitDateLabel(date);
  }
};

const renderWeekSummary = async (weekDates) => {
  const summary = await computeWeekSummary(weekDates);
  ui.weekSummary.innerHTML = `
    <div>Total sets: <strong>${summary.totalSets}</strong></div>
    <div>Avg calories: <strong>${summary.avgCalories}</strong></div>
    <div>Avg sleep: <strong>${summary.avgSleep}h</strong></div>
  `;
};

const buildSortedVolumeData = (volumeByMuscle) => {
  const entries = Object.entries(volumeByMuscle || {}).map(([label, value]) => ({
    label,
    value: Number(value || 0),
  }));
  const filtered = entries.filter((item) => item.value > 0);
  if (!filtered.length) return [{ label: "No data", value: 1 }];
  return filtered.sort((a, b) => b.value - a.value);
};

const categorizeMuscle = (label) => {
  const key = String(label || "").toLowerCase();
  if (
    key.includes("chest") ||
    key.includes("triceps") ||
    key.includes("tricep") ||
    key.includes("delts") ||
    key.includes("shoulder")
  ) {
    return "push";
  }
  if (
    key.includes("back") ||
    key.includes("lats") ||
    key.includes("biceps") ||
    key.includes("forearm") ||
    key.includes("traps")
  ) {
    return "pull";
  }
  if (
    key.includes("quad") ||
    key.includes("hamstring") ||
    key.includes("glute") ||
    key.includes("calf") ||
    key.includes("hip flexor") ||
    key.includes("adductor") ||
    key.includes("abductor")
  ) {
    return "legs";
  }
  if (key.includes("abs") || key.includes("core")) return "core";
  return "other";
};

const buildMuscleColors = (data) => {
  const palettes = {
    push: ["#d65a31", "#e66f3f", "#f08a52", "#f4a46e"],
    pull: ["#355c9b", "#4a73b7", "#5f8ad0", "#7ba3e5"],
    legs: ["#2d8f5b", "#3fa56d", "#57b982", "#73cd9a"],
    core: ["#7a7f87", "#9499a1"],
    other: ["#9aa0a6", "#b0b5bb"],
  };
  const counters = {
    push: 0,
    pull: 0,
    legs: 0,
    core: 0,
    other: 0,
  };
  return data.map((slice) => {
    if (slice.label === "No data") return palettes.other[0];
    const category = categorizeMuscle(slice.label);
    const palette = palettes[category] || palettes.other;
    const index = counters[category] % palette.length;
    counters[category] += 1;
    return palette[index];
  });
};

const normalizeSessionDate = (session) => {
  if (!session) return null;
  const rawDate = session.date;
  if (rawDate instanceof Date) {
    const year = rawDate.getFullYear();
    const month = String(rawDate.getMonth() + 1).padStart(2, "0");
    const day = String(rawDate.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  if (typeof rawDate === "string" && rawDate.length >= 10) {
    return rawDate.slice(0, 10);
  }
  if (typeof session.start_time === "string" && session.start_time) {
    const parsed = new Date(session.start_time);
    if (!Number.isNaN(parsed.getTime())) {
      const year = parsed.getFullYear();
      const month = String(parsed.getMonth() + 1).padStart(2, "0");
      const day = String(parsed.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
    const match = session.start_time.match(/(\d{1,2})\s([A-Za-z]{3})\s(\d{4})/);
    if (match) {
      const [, dayStr, monthLabel, yearStr] = match;
      const monthIndex = MONTH_INDEX?.[monthLabel];
      if (monthIndex !== undefined) {
        const year = Number(yearStr);
        const month = String(monthIndex + 1).padStart(2, "0");
        const day = String(Number(dayStr)).padStart(2, "0");
        return `${year}-${month}-${day}`;
      }
    }
  }
  return null;
};

const getWorkoutLabelsForDate = (iso) => {
  const workouts = state.sessions
    .filter((session) => normalizeSessionDate(session) === iso)
    .map((session) => {
      const title = (session.title || "Workout").toString();
      const cleaned = title.replace(/session/gi, "").replace(/workout/gi, "").replace(/\s+/g, " ").trim();
      return cleaned || "Workout";
    });
  if (workouts.length <= 3) return workouts;
  return [...workouts.slice(0, 3), `+${workouts.length - 3} more`];
};

const buildCalendarFilter = (month) => {
  const monthValue =
    month === "all" || month === "" || month === null || month === undefined ? null : Number(month);
  const hasMonth = Number.isFinite(monthValue);
  if (!hasMonth) return null;
  return (date) => {
    if (hasMonth && date.getMonth() !== monthValue) return false;
    return true;
  };
};

const updateCalendarMonth = (stateObj, monthValue) => {
  const month = Number(monthValue);
  if (Number.isNaN(month)) return;
  stateObj.month = month;
  const year = stateObj.anchorDate.getFullYear();
  stateObj.anchorDate = new Date(year, month, 1);
};

const updateCalendarYear = (stateObj, yearValue) => {
  const year = Number(yearValue);
  if (Number.isNaN(year)) return;
  stateObj.anchorDate = new Date(year, stateObj.anchorDate.getMonth(), 1);
};

const renderDashboardCalendar = async () => {
  const { weekDates } = renderCalendar(ui.calendarView, {
    view: calendarState.view,
    anchorDate: calendarState.anchorDate,
    getDayStatus,
    getDayContent: (iso) => getWorkoutLabelsForDate(iso),
    dayFilter: buildCalendarFilter(calendarState.month),
    onSelectDate: (iso) => updateHabitsUI(iso),
  }) || { weekDates: [] };
  if (weekDates.length) await renderWeekSummary(weekDates);
};

const renderTrainingCalendar = () => {
  renderCalendar(ui.trainingCalendarView, {
    view: trainingCalendarState.view,
    anchorDate: trainingCalendarState.anchorDate,
    getDayStatus,
    getDayContent: (iso) => getWorkoutLabelsForDate(iso),
    dayFilter: buildCalendarFilter(trainingCalendarState.month),
  });
};

const updateDashboard = async () => {
  const metrics = await computeSessionMetrics(7);
  ui.metricSessions.textContent = metrics.sessions;
  ui.metricSets.textContent = metrics.sets;
  ui.metricVolume.textContent = metrics.volume;
  ui.metricPRs.textContent = metrics.prs;

  renderProgressChart();

  const volumeRangeValue = volumeRangeState || "7";
  const volumeByMuscle =
    volumeRangeValue === "all"
      ? await computeVolumeByMuscleRange("all", todayISO())
      : await computeVolumeByMuscle(Number(volumeRangeValue) || 7);
  const volumeData = buildSortedVolumeData(volumeByMuscle);
  renderPieChart(ui.volumeChart, volumeData, buildMuscleColors(volumeData));

  await renderMuscleDistribution();
  renderDashboardSleepChart();
};

const renderCalendarView = async () => {
  await renderDashboardCalendar();
  renderTrainingCalendar();
};

const updateTrainingDeleteControl = () => {
  if (!ui.deleteTrainingDataButton) return;
  ui.deleteTrainingDataButton.disabled = state.workoutSets.length === 0 && state.legacySessions.length === 0;
};

const renderSessionsList = () => {
  updateTrainingDeleteControl();
  ui.sessionList.innerHTML = "";
  if (state.sessions.length === 0) {
    ui.sessionList.innerHTML = "<div class=\"muted\">No sessions logged yet.</div>";
    return;
  }
  state.sessions.forEach((session) => {
    const item = document.createElement("div");
    item.className = "list-item session-item";
    item.innerHTML = `
      <div class="session-meta">
        <strong>${session.title}</strong>
        <div class="muted">${session.date}</div>
        <div class="session-exercises">
          ${(session.exercises || [])
            .map(
              (exercise) =>
                `${exercise.name} · ${(exercise.sets || []).length} sets ${exercise.muscle ? `· ${exercise.muscle}` : ""}`
            )
            .join("<br />")}
        </div>
        <div class="muted">${session.notes || "No notes"}</div>
      </div>
      <div class="session-actions">
        <span class="badge">${session.exercises?.length || 0} exercises</span>
        <button class="ghost-button" type="button" data-action="delete">Delete</button>
      </div>
    `;
    item.querySelector("[data-action=\"delete\"]").addEventListener("click", async () => {
      await deleteSession(session.id);
      renderSessionsList();
      await updateDashboard();
      await renderCalendarView();
    });
    ui.sessionList.appendChild(item);
  });
};

const renderMuscleDistribution = async () => {
  if (!ui.muscleDistributionChart) return;
  const range = muscleRangeState || "7";
  const volumeByMuscle =
    range === "all"
      ? await computeVolumeByMuscleRange("all", todayISO())
      : await computeVolumeByMuscle(Number(range) || 7);
  const data = buildSortedVolumeData(volumeByMuscle);
  renderPieChart(ui.muscleDistributionChart, data, buildMuscleColors(data));
};

const renderDashboardSleepChart = () => {
  if (!ui.dashboardSleepChart) return;
  const days = 7;
  const cutoff = parseLocalISO(todayISO());
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const entries = state.sleep
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((entry) => parseLocalISO(entry.date) >= cutoff);
  const series = entries.map((entry) => ({
    label: entry.date.slice(5),
    date: entry.date,
    value: Number(entry.hours || 0),
  }));
  renderLineChart(
    ui.dashboardSleepChart,
    series.length ? series : [{ label: "--", value: 0 }],
    ["value"],
    ["#6e8bd8"],
    { showYAxis: true, yAxisLabel: "Hours" }
  );
};

const createSetRow = () => {
  const row = document.createElement("div");
  row.className = "set-row";
  row.innerHTML = `
    <input type="text" placeholder="Set name" />
    <input type="number" placeholder="Reps" min="0" step="0.1" />
    <input type="number" placeholder="Weight" min="0" step="0.1" />
    <button type="button" class="ghost-button">Remove</button>
  `;
  row.querySelector("button").addEventListener("click", () => row.remove());
  return row;
};

const getMuscleGroupOptions = (selectedValue = "") => {
  const options = new Map();
  const registerOption = (value) => {
    const label = String(value || "").trim();
    if (!label) return;
    const key = label.toLowerCase();
    if (!options.has(key)) options.set(key, label);
  };

  DEFAULT_MUSCLE_GROUPS.forEach(registerOption);
  state.workoutSets.forEach((row) => registerOption(row.muscle));
  state.sessions.forEach((session) => {
    (session.exercises || []).forEach((exercise) => registerOption(exercise.muscle));
  });
  registerOption(selectedValue);

  const renderedOptions = Array.from(options.values())
    .sort((a, b) => a.localeCompare(b))
    .map((label) => {
      const isSelected = label === selectedValue ? " selected" : "";
      return `<option value="${label}"${isSelected}>${label}</option>`;
    })
    .join("");

  return `<option value="">Select muscle group</option>${renderedOptions}`;
};

const createExerciseBlock = (selectedMuscle = "") => {
  const block = document.createElement("div");
  block.className = "exercise-block";
  block.innerHTML = `
    <div class="form-row exercise-meta">
      <label>
        <span>Exercise</span>
        <input class="exercise-name" type="text" placeholder="Bench Press" required />
      </label>
      <label>
        <span>Muscle Group</span>
        <select class="exercise-muscle">
          ${getMuscleGroupOptions(selectedMuscle)}
        </select>
      </label>
    </div>
    <div class="set-list"></div>
    <button type="button" class="ghost-button">Add Set</button>
  `;
  const setList = block.querySelector(".set-list");
  const addSetButton = block.querySelector("button");
  addSetButton.addEventListener("click", () => setList.appendChild(createSetRow()));
  setList.appendChild(createSetRow());
  return block;
};

const resetSessionForm = () => {
  ui.sessionForm.reset();
  ui.sessionDate.value = todayISO();
  ui.exerciseBuilder.innerHTML = "";
  ui.exerciseBuilder.appendChild(createExerciseBlock());
  editingSessionId = null;
};

const loadSessionIntoForm = (session) => {
  editingSessionId = session.id;
  ui.sessionDate.value = session.date;
  ui.sessionTitle.value = session.title;
  ui.sessionNotes.value = session.notes || "";
  ui.exerciseBuilder.innerHTML = "";
  (session.exercises || []).forEach((exercise) => {
    const block = createExerciseBlock(exercise.muscle || "");
    block.querySelector(".exercise-name").value = exercise.name;
    const setList = block.querySelector(".set-list");
    setList.innerHTML = "";
    (exercise.sets || []).forEach((set) => {
      const row = createSetRow();
      const inputs = row.querySelectorAll("input");
      inputs[0].value = set.name || "Set";
      inputs[1].value = set.reps || 0;
      inputs[2].value = set.weight || 0;
      setList.appendChild(row);
    });
    ui.exerciseBuilder.appendChild(block);
  });
};

const handleSessionSubmit = async (event) => {
  event.preventDefault();
  const exercises = Array.from(ui.exerciseBuilder.children).map((block) => {
    const nameInput = block.querySelector(".exercise-name");
    const muscleInput = block.querySelector(".exercise-muscle");
    const setRows = block.querySelectorAll(".set-row");
    const sets = Array.from(setRows).map((row) => {
      const inputs = row.querySelectorAll("input");
      return {
        id: crypto.randomUUID(),
        name: inputs[0].value || "Set",
        reps: Number(inputs[1].value || 0),
        weight: Number(inputs[2].value || 0),
      };
    });
    return {
      id: crypto.randomUUID(),
      name: nameInput?.value || "Exercise",
      muscle: muscleInput?.value || "",
      sets,
    };
  });

  const session = {
    id: editingSessionId || undefined,
    date: ui.sessionDate.value,
    title: ui.sessionTitle.value,
    notes: ui.sessionNotes.value,
    exercises,
  };
  await saveSession(session);
  renderSessionsList();
  await updateDashboard();
  await renderCalendarView();
  resetSessionForm();
};

const renderMeals = () => {
  ui.mealList.innerHTML = "";
  const mealsForDate = state.meals.filter((meal) => meal.date === macroDate);
  if (mealsForDate.length === 0) {
    ui.mealList.innerHTML = "<div class=\"muted\">No meals logged for this day.</div>";
    return;
  }
  mealsForDate.forEach((meal) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div>
        <strong>${meal.name || "Meal"}</strong>
        <div class="muted">
          ${meal.date} · ${meal.calories || 0} kcal ·
          <strong class="macro-strong">${meal.protein || 0}p</strong>
          <strong class="macro-strong">${meal.carbs || 0}c</strong>
          <strong class="macro-strong">${meal.fat || 0}f</strong>
        </div>
        <div class="muted">${meal.notes || "No notes"}</div>
      </div>
      <div class="session-actions">
        <span class="badge">Meal</span>
        <button class="ghost-button" type="button" data-action="delete">Delete</button>
      </div>
    `;
    item.querySelector("[data-action=\"delete\"]").addEventListener("click", async () => {
      await deleteMeal(meal.id);
      renderMeals();
      await renderMacroChart();
      await renderCalendarView();
    });
    ui.mealList.appendChild(item);
  });
};

const addMealFromFood = async (food) => {
  if (!food) return;
  await saveMeal({
    date: ui.mealDate?.value || todayISO(),
    name: food.name || "Food",
    calories: Number(food.calories || 0),
    protein: Number(food.protein || 0),
    carbs: Number(food.carbs || 0),
    fat: Number(food.fat || 0),
    notes: "Added from food search",
  });
  renderMeals();
  await renderMacroChart();
  await renderCalendarView();
};

const renderFoodSearch = (query) => {
  if (!ui.foodSearchResults) return;
  const q = (query ?? ui.foodSearchInput?.value ?? "").trim().toLowerCase();
  const foods = state.foods || [];
  const results = q ? foods.filter((food) => (food.name || "").toLowerCase().includes(q)) : foods;

  ui.foodSearchResults.innerHTML = "";
  if (results.length === 0) {
    ui.foodSearchResults.innerHTML = "<div class=\"muted\">No foods found.</div>";
    return;
  }
  results.forEach((food) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div>
        <strong>${food.name || "Food"}</strong>
        <div class="muted">
          ${food.calories || 0} kcal ·
          <strong class="macro-strong">${food.protein || 0}p</strong>
          <strong class="macro-strong">${food.carbs || 0}c</strong>
          <strong class="macro-strong">${food.fat || 0}f</strong>
        </div>
      </div>
      <div class="session-actions">
        <button class="ghost-button small" type="button">Add to log</button>
      </div>
    `;
    const button = item.querySelector("button");
    button.addEventListener("click", async () => {
      await addMealFromFood(food);
    });
    ui.foodSearchResults.appendChild(item);
  });
};

const renderMacroTargets = () => {
  const targets = getMacroTargets();
  ui.targetCalories.value = targets.calories || "";
  ui.targetProtein.value = targets.protein || "";
  ui.targetCarbs.value = targets.carbs || "";
  ui.targetFat.value = targets.fat || "";
  ui.targetHydration.value = targets.hydration || "";
};

const renderMacroChart = async (date = macroDate) => {
  const progress = await computeMacroProgress(date);
  const rings = {
    Protein: progress.protein,
    Carbs: progress.carbs,
    Fat: progress.fat,
  };
  const centerText = `${progress.calories.value}/${progress.calories.target} cal`;
  renderRingChart(ui.macroChart, rings, { centerText });
};

const renderHydration = async () => {
  const targets = getMacroTargets();
  const total = await computeHydrationTotal(todayISO());
  const goal = Number(targets.hydration || 0);
  if (ui.hydrationTotal) ui.hydrationTotal.textContent = total;
  if (ui.hydrationGoal) ui.hydrationGoal.textContent = goal;
  if (ui.hydrationProgress) {
    const pct = goal > 0 ? Math.min((total / goal) * 100, 100) : 0;
    ui.hydrationProgress.style.width = `${pct}%`;
  }
};

const renderSleepChart = () => {
  const metric = ui.sleepMetric?.value || "hours";
  const range = ui.sleepRange?.value || "14";
  if (ui.sleepTrendSubtitle) {
    const metricLabel = metric === "quality" ? "Quality" : "Hours";
    const rangeLabel = range === "all" ? "All time" : `Last ${range} days`;
    ui.sleepTrendSubtitle.textContent = `${rangeLabel} · ${metricLabel}`;
  }
  let entries = state.sleep.slice().sort((a, b) => a.date.localeCompare(b.date));
  if (range !== "all") {
    const days = Number(range);
    if (Number.isFinite(days) && days > 0) {
      const cutoff = parseLocalISO(todayISO());
      cutoff.setDate(cutoff.getDate() - (days - 1));
      entries = entries.filter((entry) => parseLocalISO(entry.date) >= cutoff);
    }
  }
  const series = entries.map((entry) => ({
    label: entry.date.slice(5),
    date: entry.date,
    value: metric === "quality" ? Number(entry.quality || 0) : Number(entry.hours || 0),
  }));
  const chartOptions = {};
  if (range === "all") {
    chartOptions.labelFilter = (point, index, list) => {
      if (!point?.date) return true;
      if (index === 0) return true;
      const prev = list[index - 1];
      return !prev?.date || prev.date.slice(0, 7) !== point.date.slice(0, 7);
    };
    chartOptions.labelFormatter = (point) => (point.date ? formatMonthLabel(point.date) : point.label || "");
  }
  const color = metric === "quality" ? "#ef9d38" : "#6e8bd8";
  renderLineChart(ui.sleepChart, series.length ? series : [{ label: "--", value: 0 }], ["value"], [color], {
    ...chartOptions,
    showYAxis: true,
    yAxisLabel: metric === "quality" ? "Quality" : "Hours",
  });
};

const renderRecoveryNotes = (date = ui.recoveryNotesDate?.value || todayISO()) => {
  if (!ui.recoveryNotesText) return;
  const note = getRecoveryNoteForDate(date);
  ui.recoveryNotesText.value = note?.notes || "";
};

const renderRecoveryTimeline = async () => {
  if (!ui.recoveryTimelineList) return;
  const timeline = await computeRecoveryTimeline(30);

  ui.recoveryTimelineList.innerHTML = "";
  if (!timeline.length) {
    ui.recoveryTimelineList.innerHTML = "<div class=\"muted\">No recovery entries yet.</div>";
    return;
  }

  timeline.forEach((entry) => {
    const hours = entry?.hours || null;
    const quality = entry?.quality || null;
    const noteText = entry?.notes?.trim() || "No notes";
    const date = entry?.date || todayISO();
    const dateLabel = parseLocalISO(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });

    const item = document.createElement("div");
    item.className = "timeline-item";
    item.innerHTML = `
      <div class="timeline-meta">
        <span>${dateLabel}</span>
        <span>Sleep: <strong>${hours !== null ? `${hours}h` : "—"}</strong></span>
        <span>Rating: <strong>${quality ? `${quality}/5` : "—"}</strong></span>
      </div>
      <div>${noteText}</div>
    `;
    ui.recoveryTimelineList.appendChild(item);
  });
};

const normaliseExerciseName = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const buildExerciseProgress = () => {
  const byExercise = new Map();
  state.sessions.forEach((session) => {
    const date = normalizeSessionDate(session) || session.date;
    if (!date) return;
    (session.exercises || []).forEach((exercise) => {
      const key = normaliseExerciseName(exercise.name);
      if (!key) return;
      if (!byExercise.has(key)) {
        byExercise.set(key, {
          exercise: exercise.name || "Exercise",
          muscle: exercise.muscle || "",
          entries: [],
        });
      }
      const sets = exercise.sets || [];
      const bestWeight = sets.reduce((max, set) => Math.max(max, Number(set.weight || 0)), 0);
      const bestReps = sets.reduce((max, set) => Math.max(max, Number(set.reps || 0)), 0);
      const volume = sets.reduce(
        (sum, set) => sum + Number(set.weight || 0) * Number(set.reps || 0),
        0
      );
      byExercise.get(key).entries.push({
        date,
        bestWeight,
        bestReps,
        sets: sets.length,
        volume,
      });
    });
  });

  return Array.from(byExercise.values()).map((item) => ({
    ...item,
    entries: item.entries.sort((a, b) => a.date.localeCompare(b.date)),
  }));
};

const detectPlateauCandidates = () => {
  const cutoff = parseLocalISO(todayISO());
  cutoff.setDate(cutoff.getDate() - 60);
  return buildExerciseProgress()
    .map((item) => {
      const recent = item.entries.filter((entry) => parseLocalISO(entry.date) >= cutoff);
      if (recent.length < 2) return null;
      const first = recent[0];
      const last = recent[recent.length - 1];
      const maxWeight = recent.reduce((max, entry) => Math.max(max, Number(entry.bestWeight || 0)), 0);
      const maxReps = recent.reduce((max, entry) => Math.max(max, Number(entry.bestReps || 0)), 0);
      const improvedWeight = Number(last.bestWeight || 0) > Number(first.bestWeight || 0);
      const improvedReps = Number(last.bestReps || 0) > Number(first.bestReps || 0);
      if (improvedWeight || improvedReps) return null;
      return {
        exercise: item.exercise,
        muscle: item.muscle,
        sessionsTracked: recent.length,
        since: first.date,
        latest: last.date,
        firstBestWeight: Number(first.bestWeight || 0),
        latestBestWeight: Number(last.bestWeight || 0),
        maxWeight,
        firstBestReps: Number(first.bestReps || 0),
        latestBestReps: Number(last.bestReps || 0),
        maxReps,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.sessionsTracked - a.sessionsTracked)
    .slice(0, 8);
};

const buildExerciseHighlights = () =>
  buildExerciseProgress()
    .map((item) => {
      const latest = item.entries[item.entries.length - 1];
      if (!latest) return null;
      const totalSets = item.entries.reduce((sum, entry) => sum + Number(entry.sets || 0), 0);
      const maxWeight = item.entries.reduce((max, entry) => Math.max(max, Number(entry.bestWeight || 0)), 0);
      const maxReps = item.entries.reduce((max, entry) => Math.max(max, Number(entry.bestReps || 0)), 0);
      return {
        exercise: item.exercise,
        muscle: item.muscle,
        sessionsTracked: item.entries.length,
        totalSets,
        latestDate: latest.date,
        latestBestWeight: Number(latest.bestWeight || 0),
        latestBestReps: Number(latest.bestReps || 0),
        maxWeight,
        maxReps,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.sessionsTracked - a.sessionsTracked)
    .slice(0, 12);

const buildAiContext = () => {
  const recentSessions = state.sessions
    .slice()
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 12);
  const recentMeals = state.meals
    .slice()
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 20);
  const recentSleep = state.sleep
    .slice()
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 14);
  const recentRecoveryNotes = state.recoveryNotes
    .slice()
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 14);

  return {
    today: todayISO(),
    macroTargets: getMacroTargets(),
    exerciseHighlights: buildExerciseHighlights(),
    plateauCandidates: detectPlateauCandidates(),
    recentSessions,
    recentMeals,
    recentSleep,
    recentRecoveryNotes,
  };
};

const numberOrBlank = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? String(Math.round(number * 100) / 100) : "";
};

const applyMealDraftToForm = (draft) => {
  if (!draft) return;
  if (ui.mealDate) ui.mealDate.value = draft.date || todayISO();
  if (ui.mealName) ui.mealName.value = draft.name || "";
  if (ui.mealCalories) ui.mealCalories.value = numberOrBlank(draft.calories);
  if (ui.mealProtein) ui.mealProtein.value = numberOrBlank(draft.protein);
  if (ui.mealCarbs) ui.mealCarbs.value = numberOrBlank(draft.carbs);
  if (ui.mealFat) ui.mealFat.value = numberOrBlank(draft.fat);
  if (ui.mealNotes) {
    const missing = Array.isArray(draft.needs_confirmation) && draft.needs_confirmation.length
      ? `\nConfirm: ${draft.needs_confirmation.join(", ")}`
      : "";
    ui.mealNotes.value = `${draft.notes || "Estimated by AI from nutrition input."}${missing}`.trim();
  }
  document.querySelector("[data-route=\"nutrition\"]")?.click();
  ui.mealForm?.scrollIntoView({ behavior: "smooth", block: "start" });
};

const applyWorkoutDraftToForm = (draft) => {
  if (!draft) return;
  resetSessionForm();
  if (ui.sessionDate) ui.sessionDate.value = draft.date || todayISO();
  if (ui.sessionTitle) ui.sessionTitle.value = draft.title || "AI extracted workout";
  if (ui.sessionNotes) ui.sessionNotes.value = draft.notes || "Extracted by AI from workout input.";
  if (ui.exerciseBuilder) {
    ui.exerciseBuilder.innerHTML = "";
    const exercises = Array.isArray(draft.exercises) && draft.exercises.length
      ? draft.exercises
      : [{ name: "", muscle: "", sets: [{}] }];
    exercises.forEach((exercise) => {
      const block = createExerciseBlock(exercise.muscle || "");
      const nameInput = block.querySelector(".exercise-name");
      if (nameInput) nameInput.value = exercise.name || "";
      const setList = block.querySelector(".set-list");
      setList.innerHTML = "";
      const sets = Array.isArray(exercise.sets) && exercise.sets.length ? exercise.sets : [{}];
      sets.forEach((set, index) => {
        const row = createSetRow();
        const inputs = row.querySelectorAll("input");
        inputs[0].value = set.name || `Set ${index + 1}`;
        inputs[1].value = numberOrBlank(set.reps);
        inputs[2].value = numberOrBlank(set.weight);
        setList.appendChild(row);
      });
      ui.exerciseBuilder.appendChild(block);
    });
  }
  document.querySelector("[data-route=\"training\"]")?.click();
  ui.sessionForm?.scrollIntoView({ behavior: "smooth", block: "start" });
};

const renderAiResult = (analysis, target = ui.aiResult) => {
  if (!target) return;
  const result = analysis?.result || {};
  const recommendations = Array.isArray(result.recommendations) ? result.recommendations : [];
  const nutritionFlags = Array.isArray(result.nutrition_flags) ? result.nutrition_flags : [];
  const exerciseHighlights = Array.isArray(result.exercise_highlights) ? result.exercise_highlights : [];
  const plateaus = Array.isArray(result.plateaus) ? result.plateaus : [];
  const trainingModifications = Array.isArray(result.training_modifications) ? result.training_modifications : [];
  const mealDraft = result.meal_draft && typeof result.meal_draft === "object" ? result.meal_draft : null;
  const workoutDraft = result.workout_draft && typeof result.workout_draft === "object" ? result.workout_draft : null;
  const confidence = Math.round(Number(result.confidence || 0) * 100);
  const resultMode = target.closest("[data-ai-card]")?.dataset.aiMode || "weekly_summary";
  const listSection = (title, items, emptyText) => `
    <div>
      <div class="muted">${title}</div>
      ${
        items.length
          ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
          : `<p class="muted">${emptyText}</p>`
      }
    </div>
  `;
  const columnsHtml = (() => {
    if (resultMode === "analyse_training" || resultMode === "extract_workout") {
      return [
        listSection("Exercise highlights", exerciseHighlights, "No exercise highlights returned."),
        listSection("Plateaus", plateaus, "No clear plateaus detected."),
        listSection("Training modifications", trainingModifications, "No training modifications returned."),
        listSection("Recommendations", recommendations, "No recommendations returned."),
      ].join("");
    }
    if (resultMode === "analyse_nutrition") {
      return [
        listSection("Nutrition flags", nutritionFlags, "No clear nutrition flags."),
        listSection("Recommendations", recommendations, "No recommendations returned."),
      ].join("");
    }
    if (resultMode === "analyse_recovery") {
      return [
        listSection("Recovery signals", recommendations, "No recovery recommendations returned."),
      ].join("");
    }
    return [
      listSection("Exercise highlights", exerciseHighlights, "No exercise highlights returned."),
      listSection("Plateaus", plateaus, "No clear plateaus detected."),
      listSection("Nutrition flags", nutritionFlags, "No clear nutrition flags."),
      listSection("Recommendations", recommendations, "No recommendations returned."),
    ].join("");
  })();
  const metricHtml = (() => {
    if (resultMode === "analyse_training" || resultMode === "extract_workout") {
      return `
        <div><span class="muted">Type</span><strong>${escapeHtml(result.detected_type || "training")}</strong></div>
        <div><span class="muted">Load</span><strong>${escapeHtml(result.training_load || "not enough data")}</strong></div>
        <div><span class="muted">Plateaus</span><strong>${plateaus.length}</strong></div>
        <div><span class="muted">Confidence</span><strong>${confidence}%</strong></div>
      `;
    }
    if (resultMode === "analyse_nutrition") {
      return `
        <div><span class="muted">Type</span><strong>${escapeHtml(result.detected_type || "nutrition")}</strong></div>
        <div><span class="muted">Flags</span><strong>${nutritionFlags.length}</strong></div>
        <div><span class="muted">Meal Draft</span><strong>${mealDraft ? "Ready" : "No"}</strong></div>
        <div><span class="muted">Confidence</span><strong>${confidence}%</strong></div>
      `;
    }
    if (resultMode === "analyse_recovery") {
      return `
        <div><span class="muted">Type</span><strong>${escapeHtml(result.detected_type || "recovery")}</strong></div>
        <div><span class="muted">Recovery</span><strong>${escapeHtml(result.recovery_risk || "unknown")}</strong></div>
        <div><span class="muted">Load</span><strong>${escapeHtml(result.training_load || "not enough data")}</strong></div>
        <div><span class="muted">Confidence</span><strong>${confidence}%</strong></div>
      `;
    }
    return `
      <div><span class="muted">Type</span><strong>${escapeHtml(result.detected_type || "unknown")}</strong></div>
      <div><span class="muted">Load</span><strong>${escapeHtml(result.training_load || "not enough data")}</strong></div>
      <div><span class="muted">Recovery</span><strong>${escapeHtml(result.recovery_risk || "unknown")}</strong></div>
      <div><span class="muted">Confidence</span><strong>${confidence}%</strong></div>
    `;
  })();
  const canUseMeal = resultMode === "analyse_nutrition" && mealDraft;
  const canUseWorkout = (resultMode === "analyse_training" || resultMode === "extract_workout") && workoutDraft;
  target._mealDraft = canUseMeal ? mealDraft : null;
  target._workoutDraft = canUseWorkout ? workoutDraft : null;
  target.classList.remove("empty");
  target.innerHTML = `
    <div class="ai-summary">${escapeHtml(result.summary || "No summary returned.")}</div>
    ${
      canUseMeal || canUseWorkout
        ? `<div class="ai-draft-actions">
            ${canUseMeal ? "<button class=\"ghost-button\" type=\"button\" data-ai-use-meal>Use as Meal</button>" : ""}
            ${canUseWorkout ? "<button class=\"ghost-button\" type=\"button\" data-ai-use-workout>Use as Workout</button>" : ""}
          </div>`
        : ""
    }
    <div class="ai-grid">
      ${metricHtml}
    </div>
    <div class="ai-columns">
      ${columnsHtml}
    </div>
    <div class="muted">${escapeHtml(analysis?.disclaimer || "")}</div>
  `;
  target.querySelector("[data-ai-use-meal]")?.addEventListener("click", () => {
    applyMealDraftToForm(target._mealDraft);
  });
  target.querySelector("[data-ai-use-workout]")?.addEventListener("click", () => {
    applyWorkoutDraftToForm(target._workoutDraft);
  });
};

const handleAiAnalyse = async (event, card = null) => {
  event.preventDefault();
  const root = card || event.currentTarget?.closest("[data-ai-card]");
  const button = root?.querySelector("[data-ai-button]") || ui.aiAnalyseButton;
  const status = root?.querySelector("[data-ai-status]") || ui.aiStatus;
  const resultTarget = root?.querySelector("[data-ai-result]") || ui.aiResult;
  const notes = root?.querySelector("[data-ai-notes]")?.value || ui.aiNotes?.value || "";
  const imageInput = root?.querySelector("[data-ai-images]");
  const mode =
    root?.querySelector("[data-ai-mode-select]")?.value ||
    root?.dataset.aiMode ||
    ui.aiMode?.value ||
    "weekly_summary";
  if (!button) return;
  const originalLabel = button.textContent;
  button.disabled = true;
  button.classList.add("is-loading");
  setInlineFeedback(status, "Analysing your recent logs...", "");
  try {
    const images = await readAiImages(imageInput);
    if (imageInput?.files?.length && images.length === 0) {
      setInlineFeedback(status, "Image was too large or unsupported. Try a PNG/JPG under 4 MB.", "error");
      return;
    }
    const analysis = await analyseWithAi({
      mode,
      text: notes,
      context: buildAiContext(),
      images,
    });
    renderAiResult(analysis, resultTarget);
    setInlineFeedback(status, "Analysis complete.", "success");
  } catch (error) {
    setInlineFeedback(
      status,
      error.message || "AI analysis failed. Check the server setup and try again.",
      "error"
    );
  } finally {
    button.disabled = false;
    button.classList.remove("is-loading");
    button.textContent = originalLabel;
  }
};

const parseLocalISO = (iso) => {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const formatLocalISO = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const shiftLocalISO = (iso, deltaDays) => {
  const next = parseLocalISO(iso);
  next.setDate(next.getDate() + deltaDays);
  return formatLocalISO(next);
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_INDEX = MONTH_LABELS.reduce((acc, label, index) => {
  acc[label] = index;
  return acc;
}, {});

const formatMonthLabel = (iso) => {
  const [year, month] = iso.split("-").map(Number);
  const label = MONTH_LABELS[(month || 1) - 1] || "";
  return `${label} ${String(year).slice(-2)}`;
};

const collectExerciseNames = () => {
  const names = new Set();
  state.sessions.forEach((session) => {
    (session.exercises || []).forEach((exercise) => {
      if (exercise.name) names.add(exercise.name);
    });
  });
  return Array.from(names).sort((a, b) => a.localeCompare(b));
};

const updateExerciseOptions = () => {
  if (!ui.exerciseOptions) return;
  ui.exerciseOptions.innerHTML = "";
  collectExerciseNames().forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    ui.exerciseOptions.appendChild(option);
  });
};

const buildProgressSeries = (exerciseName, rangeValue) => {
  let sessions = state.sessions.slice().sort((a, b) => a.date.localeCompare(b.date));
  if (rangeValue && rangeValue !== "all") {
    const days = Number(rangeValue);
    if (Number.isFinite(days) && days > 0) {
      const cutoff = parseLocalISO(todayISO());
      cutoff.setDate(cutoff.getDate() - (days - 1));
      sessions = sessions.filter((session) => parseLocalISO(session.date) >= cutoff);
    }
  }

  const exerciseKey = (exerciseName || "").trim().toLowerCase();
  const series = [];
  sessions.forEach((session) => {
    let sets = [];
    if (exerciseKey) {
      (session.exercises || [])
        .filter((exercise) => exercise.name?.toLowerCase() === exerciseKey)
        .forEach((exercise) => {
          sets = sets.concat(exercise.sets || []);
        });
    } else {
      sets = (session.exercises || []).flatMap((exercise) => exercise.sets || []);
    }

    if (sets.length === 0) return;
    const bestSet = sets.reduce(
      (best, set) => (set.weight > (best?.weight || 0) ? set : best),
      null
    );
    series.push({
      label: session.date.slice(5),
      date: session.date,
      weight: bestSet?.weight || 0,
      reps: bestSet?.reps || 0,
    });
  });

  return series.length ? series : [{ label: "--", weight: 0, reps: 0 }];
};

const renderProgressChart = () => {
  updateExerciseOptions();
  const exerciseName = ui.progressExercise?.value || "";
  const rangeValue = ui.progressRange?.value || "30";
  const progressSeries = buildProgressSeries(exerciseName, rangeValue);
  const chartOptions = {
    showValues: true,
    valueFormatter: (value) => `${Math.round(value)}`,
  };
  if (rangeValue === "all") {
    chartOptions.labelFilter = (point, index, series) => {
      if (!point?.date) return true;
      if (index === 0) return true;
      const prev = series[index - 1];
      return !prev?.date || prev.date.slice(0, 7) !== point.date.slice(0, 7);
    };
    chartOptions.labelFormatter = (point) => (point.date ? formatMonthLabel(point.date) : point.label || "");
  }
  renderLineChart(
    ui.progressChart,
    progressSeries,
    ["weight", "reps"],
    ["#d65a31", "#6e8bd8"],
    chartOptions
  );
};

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === "\"") {
        if (text[i + 1] === "\"") {
          current += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === "\"") {
      inQuotes = true;
    } else if (char === ",") {
      row.push(current);
      current = "";
    } else if (char === "\n") {
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
    } else if (char !== "\r") {
      current += char;
    }
  }
  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }
  return rows;
};

const csvRowsToObjects = (rows) => {
  if (!rows.length) return [];
  const [header, ...dataRows] = rows;
  return dataRows
    .filter((row) => row.some((cell) => cell && cell.trim() !== ""))
    .map((row) => {
      const record = {};
      header.forEach((key, index) => {
        record[key] = row[index] ?? "";
      });
      return record;
    });
};

const bindEvents = () => {
  if (ui.importWorkoutsButton && ui.workoutFileInput) {
    ui.importWorkoutsButton.addEventListener("click", () => {
      ui.workoutFileInput.click();
    });
    ui.workoutFileInput.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const rows = csvRowsToObjects(parseCsv(text));
        const imported = await importWorkoutRows(rows);
        if (ui.importStatus) {
          ui.importStatus.textContent = `Imported ${imported} sets from ${file.name}.`;
        }
        renderSessionsList();
        await updateDashboard();
        await renderCalendarView();
      } catch (error) {
        if (ui.importStatus) {
          ui.importStatus.textContent = "Import failed. Please check the CSV format.";
        }
        console.error(error);
      } finally {
        ui.workoutFileInput.value = "";
      }
    });
  }

  if (ui.deleteTrainingDataButton) {
    ui.deleteTrainingDataButton.addEventListener("click", async () => {
      await deleteTrainingDataForAccount(ui.importStatus, ui.importStatus);
    });
  }

  ui.landingButton?.addEventListener("click", () => {
    window.location.href = "/";
  });

  ui.logoutButton?.addEventListener("click", async () => {
    try {
      await logout();
    } catch (error) {
      if (error?.status !== 401) {
        console.error(error);
      }
    } finally {
      window.location.replace("/login");
    }
  });

  ui.profileForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setInlineFeedback(ui.profileStatus, "");
    try {
      const updatedUser = await updateProfile({
        displayName: ui.profileDisplayName?.value.trim() || "",
        email: ui.profileEmail?.value.trim() || "",
      });
      setCurrentUser(updatedUser);
      await renderAccount();
      setInlineFeedback(ui.profileStatus, "Profile updated.", "success");
    } catch (error) {
      setInlineFeedback(ui.profileStatus, error.message || "Could not save profile.", "error");
    }
  });

  ui.passwordForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setInlineFeedback(ui.passwordStatus, "");
    if ((ui.newPassword?.value || "") !== (ui.confirmPassword?.value || "")) {
      setInlineFeedback(ui.passwordStatus, "New passwords do not match.", "error");
      return;
    }
    try {
      const result = await changePassword({
        currentPassword: ui.currentPassword?.value || "",
        newPassword: ui.newPassword?.value || "",
      });
      setCurrentUser(result.user);
      ui.passwordForm?.reset();
      setInlineFeedback(ui.passwordStatus, "Password updated.", "success");
    } catch (error) {
      setInlineFeedback(ui.passwordStatus, error.message || "Could not update password.", "error");
    }
  });

  ui.exportDataButton?.addEventListener("click", () => {
    window.open(getAccountExportUrl(), "_blank", "noopener");
  });

  ui.resumeOnboardingButton?.addEventListener("click", () => {
    window.location.href = "/onboarding";
  });

  ui.restartOnboardingButton?.addEventListener("click", async () => {
    const confirmed = window.confirm("Restart onboarding from step 1?");
    if (!confirmed) return;
    try {
      accountOnboardingState = await updateOnboarding({
        status: "pending",
        currentStep: 0,
        answers: {},
        version: accountOnboardingState.version || ONBOARDING_VERSION,
      });
      if (currentUser) currentUser.onboardingStatus = "pending";
      window.location.href = "/onboarding";
    } catch (error) {
      setInlineFeedback(ui.accountDataStatus, error.message || "Could not restart onboarding.", "error");
    }
  });

  ui.accountDeleteTrainingDataButton?.addEventListener("click", async () => {
    await deleteTrainingDataForAccount(ui.accountDataStatus, ui.accountDataStatus);
  });

  document.querySelectorAll(".segment").forEach((segment) => {
    segment.addEventListener("click", async () => {
      const group = segment.dataset.group || "dashboard";
      document
        .querySelectorAll(`.segment[data-group="${group}"]`)
        .forEach((btn) => btn.classList.remove("active"));
      segment.classList.add("active");
      if (group === "training") {
        trainingCalendarState.view = segment.dataset.view;
        renderTrainingCalendar();
      } else if (group === "volume") {
        volumeRangeState = segment.dataset.range || "7";
        await updateDashboard();
      } else if (group === "muscle") {
        muscleRangeState = segment.dataset.range || "7";
        await renderMuscleDistribution();
      } else {
        calendarState.view = segment.dataset.view;
        await renderDashboardCalendar();
      }
    });
  });

  if (ui.dashboardCalendarMonth) {
    ui.dashboardCalendarMonth.addEventListener("change", async (event) => {
      updateCalendarMonth(calendarState, event.target.value);
      await renderDashboardCalendar();
    });
  }

  if (ui.trainingCalendarMonth) {
    ui.trainingCalendarMonth.addEventListener("change", (event) => {
      updateCalendarMonth(trainingCalendarState, event.target.value);
      renderTrainingCalendar();
    });
  }

  if (ui.trainingCalendarYear) {
    ui.trainingCalendarYear.addEventListener("change", (event) => {
      updateCalendarYear(trainingCalendarState, event.target.value);
      renderTrainingCalendar();
    });
  }

  if (ui.macroDatePicker) {
    ui.macroDatePicker.addEventListener("change", async (event) => {
      macroDate = event.target.value;
      await renderMacroChart();
      renderMeals();
    });
  }

  if (ui.macroPrevDay) {
    ui.macroPrevDay.addEventListener("click", async () => {
      macroDate = shiftLocalISO(macroDate, -1);
      if (ui.macroDatePicker) ui.macroDatePicker.value = macroDate;
      await renderMacroChart();
      renderMeals();
    });
  }

  if (ui.macroNextDay) {
    ui.macroNextDay.addEventListener("click", async () => {
      macroDate = shiftLocalISO(macroDate, 1);
      if (ui.macroDatePicker) ui.macroDatePicker.value = macroDate;
      await renderMacroChart();
      renderMeals();
    });
  }

  ui.saveHabitsButton.addEventListener("click", async () => {
    await saveHabit(selectedHabitDate, {
      creatine: ui.habitCreatine.checked,
      electrolytes: ui.habitElectrolytes.checked,
    });
    updateHabitsUI(selectedHabitDate);
    await renderCalendarView();
  });

  if (ui.progressExercise) {
    ui.progressExercise.addEventListener("input", renderProgressChart);
  }
  if (ui.progressRange) {
    ui.progressRange.addEventListener("change", renderProgressChart);
  }
  if (ui.foodSearchInput) {
    ui.foodSearchInput.addEventListener("input", () => renderFoodSearch());
  }

  if (ui.sleepRange) {
    ui.sleepRange.addEventListener("change", renderSleepChart);
  }
  if (ui.sleepMetric) {
    ui.sleepMetric.addEventListener("change", renderSleepChart);
  }

  if (ui.recoveryNotesDate) {
    ui.recoveryNotesDate.addEventListener("change", (event) => {
      renderRecoveryNotes(event.target.value);
    });
  }
  if (ui.recoveryNotesForm) {
    ui.recoveryNotesForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const date = ui.recoveryNotesDate?.value || todayISO();
      const notes = ui.recoveryNotesText?.value || "";
      await saveRecoveryNote(date, notes);
      renderRecoveryNotes(date);
      await renderRecoveryTimeline();
    });
  }
  document.querySelectorAll("[data-ai-form]").forEach((form) => {
    form.addEventListener("submit", (event) => handleAiAnalyse(event, form.closest("[data-ai-card]")));
  });
  ui.addExerciseButton.addEventListener("click", () => {
    ui.exerciseBuilder.appendChild(createExerciseBlock());
  });

  ui.resetSessionButton.addEventListener("click", resetSessionForm);
  ui.sessionForm.addEventListener("submit", handleSessionSubmit);
  ui.addSessionButton.addEventListener("click", () => {
    resetSessionForm();
    ui.sessionForm.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  ui.macroTargetsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveMacroTargets({
      calories: Number(ui.targetCalories.value || 0),
      protein: Number(ui.targetProtein.value || 0),
      carbs: Number(ui.targetCarbs.value || 0),
      fat: Number(ui.targetFat.value || 0),
      hydration: Number(ui.targetHydration.value || 0),
    });
    await renderMacroChart();
    await renderHydration();
  });

   ui.mealForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const mealName = ui.mealName.value;
    const calories = Number(ui.mealCalories.value || 0);
    const protein = Number(ui.mealProtein.value || 0);
    const carbs = Number(ui.mealCarbs.value || 0);
    const fat = Number(ui.mealFat.value || 0);

    await saveMeal({
      date: ui.mealDate.value,
      name: mealName,
      calories,
      protein,
      carbs,
      fat,
      notes: ui.mealNotes.value,
    });

    if (ui.mealSaveToFoods?.checked && mealName.trim()) {
      await saveFood({ name: mealName, calories, protein, carbs, fat });
      ui.mealSaveToFoods.checked = false;
    }

    renderMeals();
    await renderMacroChart();
    renderFoodSearch();
    ui.mealName.value = "";
    ui.mealCalories.value = "";
    ui.mealProtein.value = "";
    ui.mealCarbs.value = "";
    ui.mealFat.value = "";
    ui.mealNotes.value = "";
  });

  if (ui.addHydrationButton) {
    ui.addHydrationButton.addEventListener("click", async () => {
      await addHydration(todayISO(), 250);
      await renderHydration();
    });
  }
  if (ui.removeHydrationButton) {
    ui.removeHydrationButton.addEventListener("click", async () => {
      await addHydration(todayISO(), -250);
      await renderHydration();
    });
  }

  ui.sleepForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveSleepEntry({
      date: ui.sleepDate.value,
      hours: Number(ui.sleepHours.value || 0),
      quality: Number(ui.sleepQuality.value || 3),
    });
    renderSleepChart();
    await renderRecoveryTimeline();
    await renderCalendarView();
  });
};

const registerServiceWorker = () => {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js");
    });
  }
};

const setupInstallPrompt = () => {
  let deferredPrompt = null;
  const button = document.getElementById("installButton");
  button.disabled = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    button.disabled = false;
  });

  button.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  });
};

const init = async () => {
  setUnauthorizedHandler(() => {
    window.location.replace("/login");
  });
  const authenticatedUser = await getCurrentUser();
  if (!authenticatedUser) {
    window.location.replace("/login");
    return;
  }
  setCurrentUser(authenticatedUser);
  setupDragAndDrop();
  await initState();
  setDefaultDates();
  updateHabitsUI();
  await renderCalendarView();
  await updateDashboard();
  renderSessionsList();
  renderMeals();
  renderFoodSearch();
  renderMacroTargets();
  await renderMacroChart();
  await renderHydration();
  renderSleepChart();
  renderRecoveryNotes();
  await renderRecoveryTimeline();
  await renderAccount();
  resetSessionForm();

  bindEvents();
  initRouter((route) => {
    requestAnimationFrame(async () => {
      if (route === "dashboard" || route === "training") await updateDashboard();
      if (route === "nutrition") {
        await renderMacroChart();
        await renderHydration();
        renderFoodSearch();
      }
      if (route === "recovery") {
        renderSleepChart();
        renderRecoveryNotes();
        await renderRecoveryTimeline();
      }
      if (route === "account") {
        await renderAccount();
      }
    });
  });
  registerServiceWorker();
  setupInstallPrompt();

  window.addEventListener("resize", () => {
    void updateDashboard();
    void renderMacroChart();
    void renderHydration();
    renderSleepChart();
  });
};

setupSplash();
init().catch((error) => {
  console.error(error);
  if (ui.syncStatus) {
    ui.syncStatus.textContent = "Load failed";
  }
});
