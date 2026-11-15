// Astronomy and civil holidays are separate from folk almanac rules.
const loadedYears = new Map(),
  pendingYears = new Map(),
  errors = new Set();
export const CALENDAR_YEARS = { first: 2023, last: 2030 };
export function registerCalendarYear(data) {
  loadedYears.set(data.year, data);
  errors.delete(data.year);
}
export function calendarYearState(year) {
  return loadedYears.has(year)
    ? "ready"
    : errors.has(year)
      ? "error"
      : pendingYears.has(year)
        ? "loading"
        : year < CALENDAR_YEARS.first || year > CALENDAR_YEARS.last
          ? "unsupported"
          : "idle";
}
export async function ensureCalendarYear(year) {
  if (loadedYears.has(year)) return loadedYears.get(year);
  if (calendarYearState(year) === "unsupported") return null;
  if (pendingYears.has(year)) return pendingYears.get(year);
  const promise = (async () => {
    try {
      const response = await fetch(
        new URL(`./data/${year}.json?v=4`, import.meta.url),
        { signal: AbortSignal.timeout(15000) },
      );
      if (!response.ok) throw Error("Calendar data unavailable");
      const data = await response.json();
      if (data.year !== year || !data.days)
        throw Error("Invalid calendar data");
      registerCalendarYear(data);
      return data;
    } catch {
      errors.add(year);
      return null;
    } finally {
      pendingYears.delete(year);
    }
  })();
  pendingYears.set(year, promise);
  return promise;
}
export function dayInfo(key) {
  const day = loadedYears.get(Number(key.slice(0, 4)))?.days[key];
  const weekday = new Date(key + "T12:00:00Z").getUTCDay();
  if (!day)
    return {
      key,
      state: calendarYearState(Number(key.slice(0, 4))),
      holiday: null,
      workLabel: "日曆資料未載入",
      lunar: "",
      lunarShort: "",
      term: "",
      note: "",
    };
  const workLabel =
    day.holiday === null
      ? "官方待公告"
      : day.holiday
        ? day.note || "例假日"
        : [0, 6].includes(weekday)
          ? "補行上班"
          : "上班日";
  return {
    ...day,
    key,
    state: "ready",
    workLabel,
    makeupWork: day.holiday === false && [0, 6].includes(weekday),
    makeupRest: day.holiday === true && day.note.includes("補假"),
  };
}

export function calendarMetadata() {
  return loadedYears.values().next().value?.metadata || null;
}
