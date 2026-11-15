import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  registerCalendarYear,
  dayInfo,
  calendarYearState,
  ensureCalendarYear,
} from "../docs/calendar-info.mjs";
for (let y = 2023; y <= 2030; y++)
  registerCalendarYear(
    JSON.parse(
      await fs.readFile(
        new URL(`../docs/data/${y}.json`, import.meta.url),
        "utf8",
      ),
    ),
  );
test("逐年資料完整、日期唯一，閏年包含 2/29", async () => {
  for (let y = 2023; y <= 2030; y++) {
    const data = JSON.parse(
      await fs.readFile(
        new URL(`../docs/data/${y}.json`, import.meta.url),
        "utf8",
      ),
    );
    assert.equal(Object.keys(data.days).length, y % 4 === 0 ? 366 : 365);
    assert.equal(!!data.days[`${y}-02-29`], y % 4 === 0);
    assert.ok(
      Object.values(data.days).every(
        (d) => d.lunarOfficial && Array.isArray(d.yi) && Array.isArray(d.ji),
      ),
    );
  }
});
test("官方已公布年度才提供放假狀態，未公布年度不推算上班日", () => {
  assert.equal(dayInfo("2027-01-01").holiday, true);
  assert.equal(dayInfo("2026-01-02").holiday, false);
  assert.equal(dayInfo("2028-01-01").holiday, null);
  assert.equal(dayInfo("2028-01-01").workLabel, "官方待公告");
});
test("補行上班採官方標記，不能直接把週六當放假", () => {
  const d = dayInfo("2023-02-04");
  assert.equal(d.holiday, false);
  assert.equal(d.makeupWork, true);
  assert.equal(d.workLabel, "補行上班");
});
test("跨年補假依官方資料，並保留名稱", () => {
  const d = dayInfo("2027-12-31");
  assert.equal(d.holiday, true);
  assert.ok(d.note.includes("補假"));
});
test("農曆初一與閏月依氣象署對照", () => {
  assert.equal(dayInfo("2026-02-17").lunar, "正月初一");
  assert.equal(dayInfo("2027-02-06").lunar, "正月初一");
  assert.equal(dayInfo("2025-07-25").lunar, "閏六月初一");
});
test("節氣採氣象署日期時刻，傳統節日不自動當放假", () => {
  const d = dayInfo("2026-01-05");
  assert.equal(d.term, "小寒");
  assert.equal(d.termTime, "16:23");
  assert.equal(d.termOfficial, true);
  assert.equal(dayInfo("2026-03-03").holiday, false);
  assert.equal(dayInfo("2026-03-03").festival, "元宵節");
});
test("資料範圍外不冒充官方曆法", async () => {
  assert.equal(calendarYearState(2040), "unsupported");
  assert.equal(await ensureCalendarYear(2040), null);
  assert.equal(dayInfo("2040-01-01").holiday, null);
});
test("所有官方年度放假欄位為明確布林；未公告年度全部為 null", async () => {
  for (let y = 2023; y <= 2030; y++) {
    const d = JSON.parse(
      await fs.readFile(
        new URL(`../docs/data/${y}.json`, import.meta.url),
        "utf8",
      ),
    );
    assert.ok(
      Object.values(d.days).every((day) =>
        y <= 2027 ? typeof day.holiday === "boolean" : day.holiday === null,
      ),
    );
  }
});
test("資料載入去重；失敗不當作上班日，重試成功後恢復", async (t) => {
  const fresh = await import("../docs/calendar-info.mjs?network-isolation");
  let resolve;
  let count = 0;
  t.mock.method(globalThis, "fetch", () => {
    count++;
    return new Promise((r) => (resolve = r));
  });
  const one = fresh.ensureCalendarYear(2027),
    two = fresh.ensureCalendarYear(2027);
  assert.equal(count, 1);
  resolve({ ok: false });
  await Promise.all([one, two]);
  assert.equal(fresh.calendarYearState(2027), "error");
  assert.equal(fresh.dayInfo("2027-01-01").holiday, null);
  const retry = fresh.ensureCalendarYear(2027);
  const data = JSON.parse(
    await fs.readFile(
      new URL("../docs/data/2027.json", import.meta.url),
      "utf8",
    ),
  );
  resolve({ ok: true, json: async () => data });
  await retry;
  assert.equal(count, 2);
  assert.equal(fresh.dayInfo("2027-01-01").holiday, true);
});
