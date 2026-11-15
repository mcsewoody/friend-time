import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { JSDOM } from "jsdom";
const source = (
  await fs.readFile(new URL("../docs/app.js", import.meta.url), "utf8")
).replace(/^import[\s\S]*?;\s*/, "");
const domain = (
  await fs.readFile(new URL("../docs/domain.mjs", import.meta.url), "utf8")
).replaceAll("export ", "");
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
  { doc = fixture(), hash = `e=${id}&p=${pid}&edit=${key}` } = {},
) {
  const dom = new JSDOM(shell, {
    url: "https://example.com/#" + hash,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const w = dom.window;
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
  w.eval('(function(){\"use strict\";\n' + domain + "\n" + source + "\n})();");
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
    "07:00",
  );
  assert.equal(
    a.w.document.querySelector('[aria-label="午球開始"]').value,
    "13:00",
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
