const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const toISO = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const fromISO = (iso) => {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const startOfWeek = (date) => {
  const copy = new Date(date);
  const day = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - day);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const getWeekDates = (date) => {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return toISO(d);
  });
};

const getMonthGrid = (date) => {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const start = startOfWeek(first);
  const days = [];
  const cursor = new Date(start);
  while (cursor <= last || days.length % 7 !== 0) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
};

const renderCalendar = (
  container,
  {
    view,
    anchorDate,
    getDayStatus,
    onSelectDate,
    getDayContent,
    dayFilter,
  }
) => {
  if (!container) return null;
  container.innerHTML = "";

  if (view === "day") {
    const iso = toISO(anchorDate);
    const status = getDayStatus ? getDayStatus(iso) : "";
    const cell = document.createElement("div");
    cell.className = `calendar-day day-${status}`;
    const dateLabel = document.createElement("div");
    dateLabel.className = "calendar-date";
    dateLabel.textContent = anchorDate.toDateString();
    cell.appendChild(dateLabel);
    const content = getDayContent ? getDayContent(iso, anchorDate) : null;
    if (Array.isArray(content) && content.length) {
      const list = document.createElement("div");
      list.className = "calendar-workouts";
      content.forEach((label) => {
        const item = document.createElement("span");
        item.className = "calendar-workout";
        item.textContent = label;
        list.appendChild(item);
      });
      cell.appendChild(list);
    }
    if (dayFilter && !dayFilter(anchorDate, iso)) {
      cell.classList.add("day-filtered");
    }
    if (onSelectDate) {
      cell.classList.add("calendar-selectable");
      cell.addEventListener("click", () => onSelectDate(iso));
    }
    container.appendChild(cell);
    return { weekDates: getWeekDates(anchorDate) };
  }

  const header = document.createElement("div");
  header.className = "calendar-grid";
  WEEKDAY_LABELS.forEach((day) => {
    const cell = document.createElement("div");
    cell.className = "calendar-day";
    cell.innerHTML = `<span>${day}</span>`;
    header.appendChild(cell);
  });
  container.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "calendar-grid";

  const days = view === "week"
    ? getWeekDates(anchorDate).map((iso) => fromISO(iso))
    : getMonthGrid(anchorDate);

  days.forEach((day) => {
    const cell = document.createElement("div");
    const iso = toISO(day);
    const status = getDayStatus ? getDayStatus(iso) : "";
    cell.className = `calendar-day day-${status}`;
    const dateLabel = document.createElement("div");
    dateLabel.className = "calendar-date";
    dateLabel.textContent = day.getDate();
    cell.appendChild(dateLabel);
    const content = getDayContent ? getDayContent(iso, day) : null;
    if (Array.isArray(content) && content.length) {
      const list = document.createElement("div");
      list.className = "calendar-workouts";
      content.forEach((label) => {
        const item = document.createElement("span");
        item.className = "calendar-workout";
        item.textContent = label;
        list.appendChild(item);
      });
      cell.appendChild(list);
      cell.classList.add("day-has-workout");
    }
    if (dayFilter && !dayFilter(day, iso)) {
      cell.classList.add("day-filtered");
    }
    if (onSelectDate) {
      cell.classList.add("calendar-selectable");
      cell.addEventListener("click", () => onSelectDate(iso));
    }
    grid.appendChild(cell);
  });

  container.appendChild(grid);
  return { weekDates: getWeekDates(anchorDate) };
};

export { renderCalendar, getWeekDates, toISO };
