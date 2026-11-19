import { test } from "node:test";
import assert from "node:assert/strict";
import { rankSlots, highlights, dateKey } from "../docs/domain.mjs";
const slots = [
  "2026-12-01_lunch",
  "2026-12-01_dinner",
  "2026-12-02_lunch",
  "2026-12-03_lunch",
];
const person = (name, answers, submitted = true) => ({
  name,
  answers,
  submitted,
});
const yes = Object.fromEntries(slots.map((s) => [s, true]));
test("未回覆者不被當成可以，並保留待確認名單", () => {
  const e = { slots, people: [person("主揪", yes), person("朋友", {}, false)] };
  const r = rankSlots(e);
  assert.equal(r[0].yes.length, 1);
  assert.deepEqual(r[0].pending, ["朋友"]);
  assert.equal(r[0].common, true);
});
test("無交集時取人數最多前三名，同日午餐先於晚餐", () => {
  const e = {
    slots,
    people: [
      person("主揪", yes),
      person("甲", Object.fromEntries(slots.map((s, i) => [s, i === 0]))),
      person("乙", Object.fromEntries(slots.map((s, i) => [s, i === 1]))),
    ],
  };
  const h = highlights(e);
  assert.equal(h.common, false);
  assert.equal(h.rows.length, 3);
  assert.equal(h.rows[0].slot, slots[0]);
  assert.equal(h.rows[1].slot, slots[1]);
});
test("新增時段不自動視為已回覆者可以", () => {
  const e = {
    slots,
    people: [person("主揪", yes), person("甲", { [slots[0]]: true })],
  };
  const r = rankSlots(e);
  assert.equal(r.find((x) => x.slot === slots[1]).common, false);
  assert.deepEqual(r.find((x) => x.slot === slots[1]).pending, ["甲"]);
  assert.equal(highlights(e).rows.length, 1);
});
test("所有共同時段都保留，不限三個", () =>
  assert.equal(
    highlights({ slots, people: [person("主揪", yes), person("甲", yes)] }).rows
      .length,
    4,
  ));
test("日期採本地年月日，不受 UTC 換日影響", () =>
  assert.equal(dateKey(new Date(2026, 11, 1, 0)), "2026-12-01"));
test("打球同日同人數時，早球先於午球", () => {
  const slots = ["2026-12-01_afternoon", "2026-12-01_morning"];
  const e = {
    slots,
    people: [person("主揪", Object.fromEntries(slots.map((s) => [s, true])))],
  };
  assert.equal(highlights(e).rows[0].slot, "2026-12-01_morning");
});
test("候選範圍跨月跨年、排序和去重後正確區分選項與天數", async () => {
  const { candidateScope } = await import("../docs/domain.mjs");
  const s = candidateScope([
    "2027-01-05_dinner",
    "2026-11-19_lunch",
    "2026-12-03_dinner",
    "2026-11-19_dinner",
    "2026-11-19_lunch",
  ]);
  assert.equal(s.count, 4);
  assert.equal(s.days, 3);
  assert.equal(s.first, "2026-11-19");
  assert.equal(s.last, "2027-01-05");
  assert.deepEqual(
    s.months.map((m) => [m.key, m.count]),
    [
      ["2026-11", 2],
      ["2026-12", 1],
      ["2027-01", 1],
    ],
  );
});
test("週曆跨年只記錄當週實際顯示的候選，不把整個月當成已開啟", async () => {
  const { visibleCandidates } = await import("../docs/domain.mjs");
  const slots = [
    "2026-12-27_lunch",
    "2027-01-02_dinner",
    "2027-01-03_lunch",
    "2027-01-30_lunch",
  ];
  assert.deepEqual(
    visibleCandidates(slots, new Date(2027, 0, 1, 12), "week"),
    slots.slice(0, 2),
  );
  assert.deepEqual(
    visibleCandidates(slots, new Date(2027, 0, 1, 12), "month"),
    slots.slice(1),
  );
});

test("會議四時段按上午1、上午2、下午1、下午2排序，交集不混入其他類型", async () => {
  const { EVENT_TYPES, TYPES, slotLabel } = await import("../docs/domain.mjs");
  assert.deepEqual(EVENT_TYPES.meeting.slots, ["am1", "am2", "pm1", "pm2"]);
  const slots = ["pm2", "am2", "pm1", "am1"].map((t) => "2026-12-01_" + t);
  const answers = Object.fromEntries(slots.map((s) => [s, true]));
  assert.deepEqual(
    rankSlots({ slots, people: [person("主揪", answers)] }).map(
      (r) => r.slot.split("_")[1],
    ),
    ["am1", "am2", "pm1", "pm2"],
  );
  assert.equal(slotLabel(slots[0]), "2026-12-01 下午 2");
  assert.equal(TYPES.am1, "上午 1");
});

test("全員完成預判含主揪與每個時段，不把未送出或補答當完成", async () => {
  const { replyCompletesRoster } = await import("../docs/domain.mjs");
  const e = {
    rosterKnown: true,
    slots: ["a", "b"],
    people: [
      { id: "host", submitted: true, answers: { a: true, b: false } },
      { id: "friend", submitted: false, answers: {} },
    ],
  };
  assert.equal(replyCompletesRoster(e, "friend"), true);
  assert.equal(replyCompletesRoster(e, "host"), false);
  assert.equal(
    replyCompletesRoster({ ...e, rosterKnown: false }, "friend"),
    false,
  );
  assert.equal(
    replyCompletesRoster(
      { ...e, people: [{ id: "host", submitted: true, answers: { a: true } }] },
      "host",
    ),
    false,
  );
  assert.equal(
    replyCompletesRoster(
      {
        ...e,
        people: [
          { id: "host", submitted: true, answers: { a: true } },
          e.people[1],
        ],
      },
      "friend",
    ),
    false,
  );
});
