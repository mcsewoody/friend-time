export const TYPES = {
  lunch: "午餐",
  dinner: "晚餐",
  day: "整天",
  morning: "早球",
  afternoon: "午球",
};
export const EVENT_TYPES = {
  meal: { label: "吃飯", slots: ["lunch", "dinner"] },
  class: { label: "上課", slots: ["day"] },
  sport: { label: "打球", slots: ["morning", "afternoon"] },
};
export function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function taipeiToday() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function slotLabel(slot) {
  const [d, t] = slot.split("_");
  return `${d} ${TYPES[t]}`;
}
export function rankSlots(event) {
  const submitted = event.people.filter((p) => p.submitted);
  return event.slots
    .map((slot) => {
      const yes = submitted
        .filter((p) => p.answers[slot] === true)
        .map((p) => p.name);
      const no = submitted
        .filter((p) => p.answers[slot] === false)
        .map((p) => p.name);
      const pending = event.people
        .filter((p) => !p.submitted || typeof p.answers[slot] !== "boolean")
        .map((p) => p.name);
      return {
        slot,
        yes,
        no,
        pending,
        common: submitted.length > 0 && yes.length === submitted.length,
      };
    })
    .sort(
      (a, b) =>
        b.yes.length - a.yes.length ||
        a.slot.split("_")[0].localeCompare(b.slot.split("_")[0]) ||
        ["lunch", "dinner", "morning", "afternoon", "day"].indexOf(
          a.slot.split("_")[1],
        ) -
          ["lunch", "dinner", "morning", "afternoon", "day"].indexOf(
            b.slot.split("_")[1],
          ),
    );
}
export function highlights(event) {
  const ranked = rankSlots(event);
  const common = ranked.filter((s) => s.common);
  return {
    common: common.length > 0,
    rows: common.length ? common : ranked.slice(0, 3),
  };
}

export function candidateScope(slots) {
  const ordered = [...new Set(slots)].sort();
  const dates = [...new Set(ordered.map((slot) => slot.split("_")[0]))];
  const months = [...new Set(dates.map((date) => date.slice(0, 7)))].map(
    (key) => {
      const entries = ordered.filter((slot) => slot.startsWith(key + "-"));
      return { key, count: entries.length, slots: entries };
    },
  );
  return {
    count: ordered.length,
    days: dates.length,
    first: dates[0],
    last: dates.at(-1),
    months,
  };
}
export function visibleCandidates(slots, cursor, view) {
  if (view === "month")
    return slots.filter((slot) =>
      slot.startsWith(dateKey(cursor).slice(0, 7) + "-"),
    );
  const start = new Date(cursor);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return slots.filter((slot) => {
    const date = slot.split("_")[0];
    return date >= dateKey(start) && date <= dateKey(end);
  });
}
