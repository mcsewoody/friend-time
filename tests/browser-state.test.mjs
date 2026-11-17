import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { JSDOM } from "jsdom";
const source = (
  await fs.readFile(new URL("../docs/app.js", import.meta.url), "utf8")
).replace(/^import[\s\S]*?;\s*/gm, "");
const domain = (
  await fs.readFile(new URL("../docs/domain.mjs", import.meta.url), "utf8")
).replaceAll("export ", "");
const calendarModule = (
  await fs.readFile(
    new URL("../docs/calendar-info.mjs", import.meta.url),
    "utf8",
  )
)
  .replaceAll("export ", "")
  .replaceAll("import.meta.url", '"https://example.com/calendar-info.mjs"');
const calendarFixtures = await Promise.all(
  [2023, 2024, 2025, 2026, 2027, 2028].map(async (y) =>
    JSON.parse(
      await fs.readFile(
        new URL(`../docs/data/${y}.json`, import.meta.url),
        "utf8",
      ),
    ),
  ),
);
const shell = await fs.readFile(
  new URL("../docs/index.html", import.meta.url),
  "utf8",
);
const id = "12345678-1234-4234-8234-123456789012",
  pid = "12345678-1234-4234-8234-123456789013",
  key = "x".repeat(72);
const date = new Date();
date.setUTCDate(date.getUTCDate() + 3);
const slot = date.toISOString().slice(0, 10) + "_lunch",
  added = date.toISOString().slice(0, 10) + "_dinner";
function fixture() {
  return {
    id,
    title: "聚餐",
    type: "meal",
    times: { lunch: ["12:00", "14:00"], dinner: ["18:00", "21:00"] },
    hostName: "主揪",
    hostId: "host",
    slots: [slot],
    status: "open",
    rosterKnown: true,
    people: [
      { id: "host", name: "主揪", submitted: true, answers: { [slot]: true } },
      { id: pid, name: "朋友", submitted: true, answers: { [slot]: true } },
    ],
  };
}
const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
};
async function setup(
  t,
  {
    doc = fixture(),
    hash = `e=${id}&p=${pid}&edit=${key}`,
    storageData = {},
  } = {},
) {
  const dom = new JSDOM(shell, {
    url: "https://example.com/#" + hash,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  for (const [k, v] of Object.entries(storageData))
    w.localStorage.setItem(k, JSON.stringify(v));
  let interval,
    calls = [],
    next;
  w.APP_CONFIG = {
    supabaseUrl: "https://test.supabase.co",
    supabaseKey: "public",
  };
  w.setInterval = (fn) => {
    interval = fn;
  };
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function (v) {
    this.returnValue = v;
    this.open = false;
    this.dispatchEvent(new w.Event("close"));
  };
  w.fetch = async (url, options) => {
    const req = JSON.parse(options.body);
    calls.push(req);
    if (next) {
      const n = next;
      next = null;
      return n(req);
    }
    return {
      ok: true,
      json: async () =>
        req.p_action === "verify" ? { ok: true } : structuredClone(doc),
    };
  };
  w.eval(
    '(function(){\"use strict\";\n' +
      domain +
      "\n" +
      calendarModule +
      "\n" +
      calendarFixtures
        .map((d) => `registerCalendarYear(${JSON.stringify(d)});`)
        .join("\n") +
      "\n" +
      source +
      "\n})();",
  );
  await flush();
  return {
    w,
    calls,
    click: (s) => {
      const el = w.document.querySelector(s);
      assert.ok(el, s);
      el.click();
    },
    setDoc: (d) => (doc = d),
    setNext: (fn) => (next = fn),
    sync: () => interval(),
  };
}
test("跨裝置私人連結驗證成功後，記住身分", async (t) => {
  const a = await setup(t);
  assert.equal(JSON.parse(a.w.localStorage.getItem("ft:" + id)).edit, key);
  assert.equal(a.w.document.querySelector("h2").textContent, "一起排個時間");
});
test("同步回應較慢，使用者開始編輯後不覆蓋草稿", async (t) => {
  const a = await setup(t);
  let resolve;
  a.setNext(() => new Promise((r) => (resolve = r)));
  const pending = a.sync();
  a.click(`[data-slot="${slot}"]`);
  const fresh = fixture();
  fresh.people.push({
    id: "new",
    name: "新朋友",
    submitted: false,
    answers: {},
  });
  resolve({ ok: true, json: async () => fresh });
  await pending;
  assert.match(
    a.w.document.querySelector(`[data-slot="${slot}"]`).className,
    /no/,
  );
  a.click("#submit");
  await flush();
  assert.equal(a.calls.at(-1).p_data.answers[slot], false);
});
test("同步在舊 GET 返回前已送出，不能覆蓋送出結果", async (t) => {
  const a = await setup(t);
  let resolve;
  a.setNext(() => new Promise((r) => (resolve = r)));
  const pending = a.sync();
  a.click(`[data-slot="${slot}"]`);
  const fresh = fixture();
  fresh.people[1].answers[slot] = false;
  a.setDoc(fresh);
  a.click("#submit");
  await flush();
  resolve({ ok: true, json: async () => fixture() });
  await pending;
  a.click('[data-mode="fill"]');
  assert.match(
    a.w.document.querySelector(`[data-slot="${slot}"]`).className,
    /no/,
  );
});
test("在統計畫面同步後，切回填寫使用最新個人答案", async (t) => {
  const a = await setup(t);
  a.click('[data-mode="results"]');
  const fresh = fixture();
  fresh.people[1].answers[slot] = false;
  a.setDoc(fresh);
  await a.sync();
  a.click('[data-mode="fill"]');
  assert.match(
    a.w.document.querySelector(`[data-slot="${slot}"]`).className,
    /no/,
  );
});
test("手動更新保留尚未送出的排除選擇；新時段標示待補答", async (t) => {
  const a = await setup(t);
  a.click(`[data-slot="${slot}"]`);
  const fresh = fixture();
  fresh.slots.push(added);
  fresh.people[0].answers[added] = true;
  a.setDoc(fresh);
  a.click("#refresh");
  await flush();
  assert.match(
    a.w.document.querySelector(`[data-slot="${slot}"]`).className,
    /no/,
  );
  assert.match(
    a.w.document.querySelector(`[data-slot="${added}"]`).className,
    /pending/,
  );
  assert.match(a.w.document.querySelector("#app").textContent, /待補答 1 個/);
});
test("待補答送出需明確確認，取消不送資料", async (t) => {
  const doc = fixture();
  doc.slots.push(added);
  doc.people[0].answers[added] = true;
  const a = await setup(t, { doc });
  a.click("#submit");
  await flush();
  assert.ok(a.w.document.querySelector("dialog").open);
  assert.equal(a.calls.filter((c) => c.p_action === "respond").length, 0);
  a.w.document.querySelector("dialog button").click();
  await flush();
  assert.equal(a.calls.filter((c) => c.p_action === "respond").length, 0);
  a.click("#submit");
  await flush();
  a.w.document.querySelector("dialog .primary").click();
  await flush();
  assert.equal(
    a.calls.find((c) => c.p_action === "respond").p_data.answers[added],
    true,
  );
});
test("連線失敗保留答案且可再次送出", async (t) => {
  const a = await setup(t);
  a.click(`[data-slot="${slot}"]`);
  a.setNext(async () => {
    throw Error("offline");
  });
  a.click("#submit");
  await flush();
  assert.equal(a.w.document.querySelector("#app").inert, false);
  assert.match(
    a.w.document.querySelector(`[data-slot="${slot}"]`).className,
    /no/,
  );
  a.click("#submit");
  await flush();
  assert.equal(a.calls.at(-1).p_data.answers[slot], false);
});
test("統計月曆不錯用個人不行標籤；鍵盤操作保留日期焦點", async (t) => {
  const a = await setup(t);
  const btn = a.w.document.querySelector(`[data-slot="${slot}"]`);
  btn.focus();
  btn.click();
  assert.equal(a.w.document.activeElement.dataset.slot, slot);
  a.click('[data-mode="results"]');
  assert.equal(
    a.w.document
      .querySelector(`[data-slot="${slot}"]`)
      .getAttribute("aria-label")
      .includes("不行"),
    false,
  );
});
test("邀約名稱及參與者文字不能插入 HTML", async (t) => {
  const doc = fixture();
  doc.title = "<img src=x onerror=alert(1)>";
  doc.people[1].name = "<script>alert(1)</script>";
  const a = await setup(t, { doc });
  assert.equal(a.w.document.querySelector("h1").textContent, doc.title);
  assert.equal(a.w.document.querySelectorAll("#app img,#app script").length, 0);
});
test("只有參與者 ID 沒有修改憑證，不可顯示為本人", async (t) => {
  const a = await setup(t, { hash: `e=${id}&p=${pid}` });
  assert.ok(a.w.document.querySelector("#person"));
  assert.ok(a.w.document.querySelector("#newname"));
  assert.equal(
    a.w.document
      .querySelector("#app")
      .textContent.includes("你可以修改自己的回覆"),
    false,
  );
});
test("僅晚餐候選也保留午餐空位，月曆和週曆皆固定下排", async (t) => {
  const doc = fixture();
  doc.slots = [added];
  doc.people.forEach((p) => (p.answers = { [added]: true }));
  const a = await setup(t, { doc });
  for (const view of ["month", "week"]) {
    a.click(`[data-view="${view}"]`);
    const dinner = a.w.document.querySelector(`[data-slot="${added}"]`);
    assert.ok(dinner.classList.contains("slot-dinner"));
    assert.ok(dinner.parentElement.querySelector(".slot-space.slot-lunch"));
    assert.equal(dinner.parentElement.lastElementChild, dinner);
  }
});
test("打球有獨立的早球午球預設時段及按鈕", async (t) => {
  const a = await setup(t, { hash: "" });
  a.click('[data-type="sport"]');
  assert.equal(
    a.w.document.querySelector('[aria-label="早球開始"]').value,
    "06:00",
  );
  assert.equal(
    a.w.document.querySelector('[aria-label="午球開始"]').value,
    "10:00",
  );
  assert.equal(
    a.w.document.querySelector('[aria-label="早球結束"]').value,
    "09:00",
  );
  assert.equal(
    a.w.document.querySelector('[aria-label="午球結束"]').value,
    "12:00",
  );
  assert.match(
    a.w.document.querySelector("#app").textContent,
    /tee off 開球時間範圍/,
  );
  assert.ok(a.w.document.querySelector(".slot-morning"));
  assert.ok(a.w.document.querySelector(".slot-afternoon"));
  assert.equal(a.w.document.querySelector(".slot-lunch"), null);
});
test("任何參與者或存檔訪客都能從頁首發起新邀約", async (t) => {
  const doc = fixture();
  doc.status = "final";
  doc.archived = true;
  const a = await setup(t, { doc });
  assert.ok(
    [...a.w.document.querySelectorAll("header a")].some(
      (a) =>
        a.textContent.includes("發起新邀約") && a.getAttribute("href") === "./",
    ),
  );
  assert.equal(a.w.document.querySelector("#submit"), null);
  assert.equal(a.w.document.querySelector("#delete-event"), null);
});
test("存檔主揪可刪除和還原，但不可重新開放，並記錄存檔索引", async (t) => {
  const doc = fixture();
  doc.status = "final";
  doc.archived = true;
  doc.archivedAt = "2026-11-15T08:00:00Z";
  const a = await setup(t, { doc, hash: `e=${id}&admin=${key}` });
  assert.equal(a.w.document.querySelector("#reopen"), null);
  assert.ok(a.w.document.querySelector("#delete-event"));
  assert.equal(
    JSON.parse(a.w.localStorage.getItem("ft:library"))[0].status,
    "final",
  );
  a.setDoc({ ...doc, deleted: true });
  a.click("#delete-event");
  await flush();
  a.click("dialog .primary");
  await flush();
  assert.equal(a.calls.at(-1).p_action, "delete");
  assert.ok(a.w.document.querySelector("#restore-event"));
  assert.equal(
    JSON.parse(a.w.localStorage.getItem("ft:library"))[0].deleted,
    true,
  );
  a.setDoc(doc);
  a.click("#restore-event");
  await flush();
  assert.equal(a.calls.at(-1).p_action, "restore");
  assert.ok(a.w.document.querySelector("#delete-event"));
  assert.equal(a.w.document.querySelector("#submit"), null);
});
test("日期可展開完整農民曆，查看宜忌不會改動時間答案", async (t) => {
  const a = await setup(t);
  const date = slot.split("_")[0];
  const before = a.w.document.querySelector(`[data-slot="${slot}"]`).className;
  a.click(`[data-day="${date}"]`);
  await flush();
  const modal = a.w.document.querySelector(".almanac-dialog");
  assert.ok(modal.open);
  assert.match(modal.textContent, /宜/);
  assert.match(modal.textContent, /忌/);
  assert.match(modal.textContent, /民俗參考/);
  assert.equal(
    a.w.document.querySelector(`[data-slot="${slot}"]`).className,
    before,
  );
  assert.equal(
    a.calls.some((c) => c.p_action === "respond"),
    false,
  );
  modal.querySelector("button").click();
  assert.equal(a.w.document.querySelector(".almanac-dialog"), null);
});
test("月曆與週曆都含農曆及官方上班日標示，且保留上下午列", async (t) => {
  const a = await setup(t);
  for (const view of ["month", "week"]) {
    a.click(`[data-view="${view}"]`);
    const day = a.w.document.querySelector(
      `[data-slot="${slot}"]`,
    ).parentElement;
    assert.ok(day.querySelector(".lunar-mini").textContent);
    assert.ok(day.querySelector(".day-badge").textContent);
    assert.ok(day.querySelector(".slot-dinner"));
    assert.ok(
      a.w.document
        .querySelector(".calendar-sources")
        .textContent.includes("各校公告"),
    );
  }
});

test("隱藏側欄時段清單，既有打球存檔仍保留原時間", async (t) => {
  const doc = fixture();
  doc.type = "sport";
  doc.times = { morning: ["07:00", "10:00"], afternoon: ["13:00", "16:00"] };
  const s = slot.split("_")[0] + "_morning";
  doc.slots = [s];
  doc.status = "closed";
  doc.final = s;
  doc.people.forEach((p) => (p.answers = { [s]: true }));
  const a = await setup(t, { doc });
  const text = a.w.document.querySelector("#app").textContent;
  assert.match(text, /07:00–10:00/);
  assert.equal(a.w.document.querySelectorAll("aside .people").length, 0);
  assert.equal(text.includes("06:00–09:00"), false);
});
function crossMonthFixture() {
  const doc = fixture();
  doc.title = "跨年聚餐";
  doc.slots = [
    "2027-01-05_dinner",
    "2026-11-19_lunch",
    "2026-12-03_dinner",
    "2026-11-19_dinner",
  ];
  doc.people.forEach(
    (p) => (p.answers = Object.fromEntries(doc.slots.map((s) => [s, true]))),
  );
  return doc;
}
test("邀約開頭清楚顯示全部選項、天數、跨月數與最早最晚日期", async (t) => {
  const a = await setup(t, { doc: crossMonthFixture() });
  const banner = a.w.document.querySelector(".invitation-scope");
  assert.ok(banner);
  assert.match(banner.textContent, /共 4 個選項/);
  assert.match(banner.textContent, /分布在 3 天、跨 3 個月份/);
  assert.match(banner.textContent, /2026\/11\/19/);
  assert.match(banner.textContent, /2027\/01\/05/);
  assert.match(banner.textContent, /不只目前這一頁/);
  assert.equal(
    banner.compareDocumentPosition(a.w.document.querySelector(".layout")) &
      a.w.Node.DOCUMENT_POSITION_FOLLOWING,
    a.w.Node.DOCUMENT_POSITION_FOLLOWING,
  );
  assert.match(banner.querySelector(".scope-progress").textContent, /2／4/);
});
test("月份捷徑切換到正確月曆，保留其他月份已排除的答案", async (t) => {
  const a = await setup(t, { doc: crossMonthFixture() });
  a.w.HTMLElement.prototype.scrollIntoView = function () {};
  a.click('[data-candidate-month="2026-12"]');
  assert.match(
    a.w.document.querySelector(".calendar-head").textContent,
    /2026 年 12 月/,
  );
  a.click('[data-slot="2026-12-03_dinner"]');
  a.click('[data-candidate-month="2027-01"]');
  assert.match(
    a.w.document.querySelector(".scope-progress").textContent,
    /4／4/,
  );
  a.click('[data-candidate-month="2026-12"]');
  assert.match(
    a.w.document.querySelector('[data-slot="2026-12-03_dinner"]').className,
    /no/,
  );
});
test("只看第一頁送出時提醒完整範圍與未開啟選項，取消不送出", async (t) => {
  const a = await setup(t, { doc: crossMonthFixture() });
  a.click("#submit");
  await flush();
  const modal = a.w.document.querySelector("dialog");
  assert.ok(modal.open);
  assert.match(modal.textContent, /共 4 個選項/);
  assert.match(modal.textContent, /2027\/01\/05/);
  assert.match(modal.textContent, /還有 2 個選項尚未開啟/);
  modal.querySelector("button").click();
  await flush();
  assert.equal(
    a.calls.some((c) => c.p_action === "respond"),
    false,
  );
  assert.match(
    a.w.document.querySelector(".submission-scope").textContent,
    /全部 4 個選項/,
  );
});
test("看完所有候選月份後可正常提交全部答案", async (t) => {
  const a = await setup(t, { doc: crossMonthFixture() });
  a.w.HTMLElement.prototype.scrollIntoView = function () {};
  a.click('[data-candidate-month="2026-12"]');
  a.click('[data-slot="2026-12-03_dinner"]');
  a.click('[data-candidate-month="2027-01"]');
  a.click("#submit");
  await flush();
  assert.equal(a.w.document.querySelector("dialog"), null);
  const call = a.calls.find((c) => c.p_action === "respond");
  assert.equal(Object.keys(call.p_data.answers).length, 4);
  assert.equal(call.p_data.answers["2026-12-03_dinner"], false);
});
test("單日兩個用餐選項，清楚顯示為兩選項一天，不誤導跨月", async (t) => {
  const doc = fixture();
  doc.slots = [slot, added];
  doc.people.forEach((p) => (p.answers = { [slot]: true, [added]: true }));
  const a = await setup(t, { doc });
  const banner = a.w.document.querySelector(".invitation-scope");
  assert.match(banner.textContent, /共 2 個選項/);
  assert.match(banner.textContent, /分布在 1 天/);
  assert.equal(banner.textContent.includes("不只目前這一頁"), false);
});
test("首次填寫取消跨月提醒後，仍可選擇受邀者身分", async (t) => {
  const doc = crossMonthFixture();
  doc.people[1].submitted = false;
  doc.people[1].answers = {};
  const a = await setup(t, { doc, hash: `e=${id}` });
  const select = a.w.document.querySelector("#person");
  select.value = pid;
  select.dispatchEvent(new a.w.Event("change", { bubbles: true }));
  a.click("#submit");
  await flush();
  a.click("dialog button");
  await flush();
  assert.ok(a.w.document.querySelector("#person"));
  assert.equal(a.w.localStorage.getItem("ft:" + id), null);
  assert.equal(
    a.calls.some((c) => c.p_action === "respond"),
    false,
  );
});

test("首頁只列本人主揪紀錄，既有參與者紀錄不再顯示", async (t) => {
  const other = "22345678-1234-4234-8234-123456789012";
  const a = await setup(t, {
    hash: "",
    storageData: {
      "ft:library": [
        { id, title: "我的邀約", status: "open" },
        { id: other, title: "別人的邀約", status: "closed" },
      ],
      ["ft:" + id]: { admin: key },
      ["ft:" + other]: { pid, edit: key },
    },
  });
  assert.equal(a.w.document.querySelectorAll(".archive-row").length, 1);
  assert.match(a.w.document.querySelector(".library").textContent, /我的邀約/);
  assert.doesNotMatch(
    a.w.document.querySelector(".library").textContent,
    /別人的邀約/,
  );
});
test("開啟朋友邀約不列入本人主揪紀錄", async (t) => {
  const a = await setup(t);
  assert.equal(a.w.localStorage.getItem("ft:library"), null);
});
test("主揪可修改自己時間；結束是單一存檔按鈕", async (t) => {
  const doc = fixture();
  const a = await setup(t, { doc, hash: `e=${id}&admin=${key}` });
  assert.equal(a.w.document.querySelector("#close").textContent, "結束並存檔");
  a.click("#host-availability");
  assert.ok(a.w.document.querySelector("#submit"));
  a.click(`[data-slot="${slot}"]`);
  a.click("#submit");
  await flush();
  if (a.w.document.querySelector("dialog .primary")) {
    a.click("dialog .primary");
    await flush();
  }
  const request = a.calls.find((x) => x.p_action === "host_respond");
  assert.ok(request);
  assert.equal(request.p_data.pid, doc.hostId);
  assert.equal(request.p_data.answers[slot], false);
  assert.equal(JSON.parse(a.w.localStorage.getItem("ft:" + id)).admin, key);
});
test("主揪編輯預選既有日期，取消不寫入；存檔隱藏編輯入口", async (t) => {
  const a = await setup(t, { hash: `e=${id}&admin=${key}` });
  a.click("#edit-event");
  assert.equal(a.w.document.querySelector("#edit-title").value, "聚餐");
  const before = a.calls.length;
  a.click(`[data-slot="${slot}"]`);
  assert.equal(
    a.w.document
      .querySelector(`[data-slot="${slot}"]`)
      .getAttribute("aria-pressed"),
    "false",
  );
  a.click("#cancel-add");
  assert.equal(a.calls.length, before);
  assert.equal(a.w.document.querySelector("#edit-title"), null);
  a.setDoc({ ...fixture(), status: "closed", archived: true });
  a.click("#refresh");
  await flush();
  assert.equal(a.w.document.querySelector("#edit-event"), null);
  assert.equal(a.w.document.querySelector("#host-availability"), null);
});

test("儲存主揪編輯送出原始版本與新名稱時段，確認前不寫入", async (t) => {
  const a = await setup(t, { hash: `e=${id}&admin=${key}` });
  a.click("#edit-event");
  const input = a.w.document.querySelector("#edit-title");
  input.value = "新聚餐";
  input.dispatchEvent(new a.w.Event("input", { bubbles: true }));
  a.click("#save-add");
  await flush();
  assert.equal(
    a.calls.some((x) => x.p_action === "edit_event"),
    false,
  );
  a.click("dialog .primary");
  await flush();
  const request = a.calls.find((x) => x.p_action === "edit_event");
  assert.ok(request);
  assert.equal(request.p_data.title, "新聚餐");
  assert.equal(request.p_data.base_title, "聚餐");
  assert.deepEqual(request.p_data.base_slots, [slot]);
});

test("會議主題具四個正確預設時間，切換主題清除先前候選", async (t) => {
  const a = await setup(t, { hash: "" });
  a.click(`[data-slot="${slot}"]`);
  a.click('[data-type="meeting"]');
  const expected = {
    "上午 1": ["09:00", "10:30"],
    "上午 2": ["10:30", "12:00"],
    "下午 1": ["13:30", "15:30"],
    "下午 2": ["15:30", "17:00"],
  };
  for (const [label, times] of Object.entries(expected)) {
    assert.equal(
      a.w.document.querySelector(`[aria-label="${label}開始"]`).value,
      times[0],
    );
    assert.equal(
      a.w.document.querySelector(`[aria-label="${label}結束"]`).value,
      times[1],
    );
  }
  assert.equal(
    a.w.document.querySelectorAll('.slot[aria-pressed="true"]').length,
    0,
  );
  assert.equal(
    a.w.document.querySelectorAll(".meeting-schedule span").length,
    4,
  );
  assert.ok(a.w.document.querySelector(".calendar.meeting"));
});
test("會議僅下午2也固定四列，月週曆與統計均顯示正確時間", async (t) => {
  const doc = fixture();
  doc.type = "meeting";
  doc.times = {
    am1: ["09:00", "10:30"],
    am2: ["10:30", "12:00"],
    pm1: ["13:30", "15:30"],
    pm2: ["15:30", "17:00"],
  };
  const s = date.toISOString().slice(0, 10) + "_pm2";
  doc.slots = [s];
  doc.people.forEach((p) => (p.answers = { [s]: true }));
  const a = await setup(t, { doc });
  for (const view of ["month", "week"]) {
    a.click(`[data-view="${view}"]`);
    const button = a.w.document.querySelector(`[data-slot="${s}"]`);
    assert.equal(
      button.parentElement.querySelectorAll(".slot-space").length,
      3,
    );
    assert.equal(button.parentElement.lastElementChild, button);
    assert.match(button.getAttribute("aria-label"), /下午 2 15:30–17:00/);
  }
  a.click('[data-mode="results"]');
  assert.match(
    a.w.document.querySelector(".result-row").textContent,
    /下午 2 · 15:30–17:00/,
  );
});
