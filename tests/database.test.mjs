import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
const db = new PGlite();
await db.exec("create role anon; create role authenticated;");
await db.exec(
  await fs.readFile(
    new URL("../database/001_friend_time.sql", import.meta.url),
    "utf8",
  ),
);
await db.exec(
  await fs.readFile(
    new URL("../database/002_sport_archives.sql", import.meta.url),
    "utf8",
  ),
);
await db.exec(
  await fs.readFile(
    new URL("../database/003_host_edit_private_library.sql", import.meta.url),
    "utf8",
  ),
);
await db.exec(
  await fs.readFile(
    new URL("../database/004_meeting_slots.sql", import.meta.url),
    "utf8",
  ),
);
await db.exec(
  await fs.readFile(
    new URL("../database/005_auto_close_roster.sql", import.meta.url),
    "utf8",
  ),
);
const token = () => randomUUID() + randomUUID(),
  admin = token(),
  member = token(),
  id = randomUUID(),
  pid = randomUUID();
const tomorrow = new Date();
tomorrow.setUTCDate(tomorrow.getUTCDate() + 2);
const date = tomorrow.toISOString().slice(0, 10);
const lunch = date + "_lunch",
  dinner = date + "_dinner";
async function api(action, data = {}, key = "", eventId = id) {
  const r = await db.query(
    "select public.friend_time_api($1,$2,$3,$4) result",
    [action, eventId, key, JSON.stringify(data)],
  );
  return r.rows[0].result;
}
let doc;
test("建立邀約，主揪自動計入；未填名單不計入", async () => {
  doc = await api(
    "create",
    {
      title: "測試聚餐",
      host: "主揪",
      type: "meal",
      times: { lunch: ["12:00", "14:00"], dinner: ["18:00", "21:00"] },
      names: ["朋友", "尚待回覆"],
      slots: [lunch],
    },
    admin,
  );
  assert.equal(doc.people.length, 3);
  assert.equal(doc.people[0].answers[lunch], true);
  assert.equal(doc.people[1].submitted, false);
});
test("匿名可讀取指定邀約，無法列舉底層資料表", async () => {
  await db.exec("set role anon");
  assert.equal((await api("get")).title, "測試聚餐");
  await assert.rejects(
    db.query("select * from friend_time_private.events"),
    /permission denied/,
  );
  await db.exec("reset role");
});
test("錯誤管理憑證拒絕追加日期", async () =>
  assert.rejects(api("append", { slots: [dinner] }, member), /管理連結/));
test("認領名單並回覆，同一名字不能被他人覆寫", async () => {
  const existing = doc.people[1].id;
  doc = await api(
    "respond",
    { pid: existing, name: "朋友", answers: { [lunch]: false } },
    member,
  );
  assert.equal(doc.people[1].answers[lunch], false);
  await assert.rejects(
    api(
      "respond",
      { pid: existing, name: "朋友", answers: { [lunch]: true } },
      token(),
    ),
    /修改連結/,
  );
});
test("新增參加者與重複名字保護", async () => {
  doc = await api(
    "respond",
    { pid, name: "新增朋友", answers: { [lunch]: true } },
    member,
  );
  assert.equal(doc.people.length, 4);
  await assert.rejects(
    api(
      "respond",
      { pid: randomUUID(), name: "新增朋友", answers: { [lunch]: true } },
      token(),
    ),
    /名字已存在/,
  );
});
test("追加日期，原參加者新時段保持未確認", async () => {
  doc = await api("append", { slots: [dinner] }, admin);
  assert.equal(doc.people[0].answers[dinner], true);
  assert.equal(doc.people[1].answers[dinner], undefined);
  assert.equal(doc.people.find((p) => p.id === pid).answers[dinner], undefined);
});
test("過期版本回覆被拒絕，避免新增時段被默認可行", async () =>
  assert.rejects(
    api(
      "respond",
      { pid, name: "新增朋友", answers: { [lunch]: true } },
      member,
    ),
    /候選時間已變更/,
  ));
test("修改連結可補答；答案不包含憑證或雜湊", async () => {
  doc = await api(
    "respond",
    { pid, name: "新增朋友", answers: { [lunch]: true, [dinner]: false } },
    member,
  );
  assert.equal(doc.people.find((p) => p.id === pid).answers[dinner], false);
  assert.equal(JSON.stringify(doc).includes(member), false);
  assert.equal("member_keys" in doc, false);
});
test("確定日期後固定存檔，禁止填寫與重新開放", async () => {
  doc = await api("finalize", { slot: lunch }, admin);
  assert.equal(doc.status, "final");
  await assert.rejects(
    api(
      "respond",
      { pid, name: "新增朋友", answers: { [lunch]: true, [dinner]: true } },
      member,
    ),
    /已關閉/,
  );
  await assert.rejects(api("reopen", {}, admin), /固定存檔/);
  assert.equal(doc.archived, true);
  assert.ok(doc.archivedAt);
});
test("上課僅接受整天；SQL 特殊字元與 HTML 只當文字", async () => {
  await assert.rejects(
    api(
      "create",
      {
        title: "課程",
        host: "主揪",
        type: "class",
        times: { day: ["09:00", "17:00"] },
        names: [],
        slots: [lunch],
      },
      token(),
      randomUUID(),
    ),
    /類型/,
  );
  const d = await api(
    "create",
    {
      title: "<script>alert('test')</script>",
      host: "老師",
      type: "class",
      times: { day: ["09:00", "17:00"] },
      names: [],
      slots: [date + "_day"],
    },
    token(),
    randomUUID(),
  );
  assert.equal(d.type, "class");
});
test.after(() => db.close());
test("打球接受早球午球，拒絕用餐時段", async () => {
  const data = {
    title: "打球",
    host: "主揪",
    type: "sport",
    times: { morning: ["07:00", "10:00"], afternoon: ["13:00", "16:00"] },
    names: [],
    slots: [date + "_morning", date + "_afternoon"],
  };
  const d = await api("create", data, token(), randomUUID());
  assert.equal(d.type, "sport");
  await assert.rejects(
    api("create", { ...data, slots: [lunch] }, token(), randomUUID()),
    /類型/,
  );
});
test("只有主揪能刪除存檔，刪除後邀請連結無法讀取", async () => {
  await assert.rejects(api("delete", {}, member), /管理連結/);
  const before = await api("get");
  const deleted = await api("delete", {}, admin);
  assert.equal(deleted.deleted, true);
  await assert.rejects(api("get"), /已由主揪刪除/);
  const owner = await api("get", {}, admin);
  assert.equal(owner.deleted, true);
  assert.deepEqual(owner.people, before.people);
  await assert.rejects(
    api(
      "respond",
      { pid, name: "朋友", answers: { [lunch]: true, [dinner]: true } },
      member,
    ),
    /已由主揪刪除/,
  );
});
test("還原不改動存檔內容或時間，而且保持唯讀", async () => {
  await assert.rejects(api("restore", {}, member), /管理連結/);
  const before = await api("get", {}, admin),
    restored = await api("restore", {}, admin);
  assert.equal(restored.archivedAt, before.archivedAt);
  assert.deepEqual(restored.people, before.people);
  assert.equal(restored.status, "final");
  assert.equal((await api("get")).deleted, undefined);
  await assert.rejects(
    api("append", { slots: [date + "_lunch"] }, admin),
    /無法修改/,
  );
});
test("進行中邀約不能直接刪除，完成統計後才能刪除", async () => {
  const eid = randomUUID(),
    key = token();
  await api(
    "create",
    {
      title: "測試",
      host: "主揪",
      type: "class",
      times: { day: ["09:00", "17:00"] },
      names: [],
      slots: [date + "_day"],
    },
    key,
    eid,
  );
  await assert.rejects(api("delete", {}, key, eid), /先完成統計/);
  const archived = await api("close", {}, key, eid);
  assert.equal(archived.archived, true);
  assert.ok(archived.archivedAt);
  await assert.rejects(api("close", {}, key, eid), /無法修改/);
  assert.equal((await api("delete", {}, key, eid)).deleted, true);
});

test("主揪修改自己的時間，朋友不可冒用；追加日期保留原不行狀態", async () => {
  const eid = randomUUID(),
    key = token();
  let d = await api(
    "create",
    {
      title: "主揪修改",
      host: "主揪",
      type: "meal",
      times: { lunch: ["12:00", "14:00"], dinner: ["18:00", "21:00"] },
      names: [],
      slots: [lunch],
    },
    key,
    eid,
  );
  await assert.rejects(
    api(
      "host_respond",
      { pid: d.hostId, name: "主揪", answers: { [lunch]: false } },
      token(),
      eid,
    ),
    /管理連結/,
  );
  d = await api(
    "host_respond",
    { pid: d.hostId, name: "主揪", answers: { [lunch]: false } },
    key,
    eid,
  );
  assert.equal(d.people[0].answers[lunch], false);
  d = await api("append", { slots: [dinner] }, key, eid);
  assert.equal(d.people[0].answers[lunch], false);
  assert.equal(d.people[0].answers[dinner], true);
});
test("編輯邀約保留有效答案，時段變更須補答，並拒絕過期編輯與存檔編輯", async () => {
  const eid = randomUUID(),
    key = token(),
    friend = token(),
    fid = randomUUID();
  let d = await api(
    "create",
    {
      title: "原名",
      host: "主揪",
      type: "meal",
      times: { lunch: ["12:00", "14:00"], dinner: ["18:00", "21:00"] },
      names: [],
      slots: [lunch, dinner],
    },
    key,
    eid,
  );
  d = await api(
    "respond",
    { pid: fid, name: "朋友", answers: { [lunch]: false, [dinner]: true } },
    friend,
    eid,
  );
  const edit = {
    base_title: d.title,
    base_slots: d.slots,
    base_times: d.times,
    title: "新名",
    slots: [lunch, dinner],
    times: { ...d.times, dinner: ["19:00", "21:00"] },
  };
  await assert.rejects(api("edit_event", edit, friend, eid), /管理連結/);
  d = await api("edit_event", edit, key, eid);
  assert.equal(d.title, "新名");
  assert.equal(d.people[1].answers[lunch], false);
  assert.equal(d.people[1].answers[dinner], undefined);
  await assert.rejects(api("edit_event", edit, key, eid), /已變更/);
  const remove = {
    base_title: d.title,
    base_slots: d.slots,
    base_times: d.times,
    title: d.title,
    slots: [dinner],
    times: d.times,
  };
  d = await api("edit_event", remove, key, eid);
  assert.equal(d.people[1].answers[lunch], undefined);
  await api("close", {}, key, eid);
  await assert.rejects(
    api("edit_event", { ...remove, base_slots: d.slots }, key, eid),
    /無法修改/,
  );
  assert.equal((await api("get", {}, "", eid)).status, "closed");
});

test("會議建立四時段、個別回覆、追加待補答、修改時間及存檔", async () => {
  const eid = randomUUID(),
    key = token(),
    friend = token(),
    fid = randomUUID();
  const slots = ["am1", "am2", "pm1", "pm2"].map((t) => date + "_" + t);
  const times = {
    am1: ["09:00", "10:30"],
    am2: ["10:30", "12:00"],
    pm1: ["13:30", "15:30"],
    pm2: ["15:30", "17:00"],
  };
  let d = await api(
    "create",
    { title: "會議", host: "主揪", type: "meeting", names: [], slots, times },
    key,
    eid,
  );
  assert.deepEqual(d.times, times);
  assert.equal(d.slots.length, 4);
  d = await api(
    "respond",
    {
      pid: fid,
      name: "同事",
      answers: Object.fromEntries(slots.map((s, i) => [s, i !== 2])),
    },
    friend,
    eid,
  );
  assert.equal(d.people[1].answers[slots[2]], false);
  const newDate = new Date(date + "T12:00:00Z");
  newDate.setUTCDate(newDate.getUTCDate() + 1);
  const extra = newDate.toISOString().slice(0, 10) + "_pm2";
  d = await api("append", { slots: [extra] }, key, eid);
  assert.equal(d.people[1].answers[extra], undefined);
  const edit = {
    base_title: d.title,
    base_slots: d.slots,
    base_times: d.times,
    title: d.title,
    slots: d.slots,
    times: { ...times, am1: ["09:15", "10:30"] },
  };
  d = await api("edit_event", edit, key, eid);
  assert.equal(d.people[1].answers[slots[0]], undefined);
  assert.equal(d.people[1].answers[slots[1]], true);
  d = await api("finalize", { slot: slots[3] }, key, eid);
  assert.equal(d.final, slots[3]);
  assert.equal(d.archived, true);
  await assert.rejects(
    api("host_respond", { pid: d.hostId, name: "主揪", answers: {} }, key, eid),
    /已關閉/,
  );
});
test("會議拒絕其他主題時段、缺少或錯誤時間；其他主題拒絕會議時段", async () => {
  const times = {
    am1: ["09:00", "10:30"],
    am2: ["10:30", "12:00"],
    pm1: ["13:30", "15:30"],
    pm2: ["15:30", "17:00"],
  };
  const input = {
    title: "會議",
    host: "主揪",
    type: "meeting",
    names: [],
    slots: [date + "_am1"],
    times,
  };
  await assert.rejects(
    api("create", { ...input, slots: [lunch] }, token(), randomUUID()),
    /類型/,
  );
  await assert.rejects(
    api(
      "create",
      { ...input, times: { am1: times.am1 } },
      token(),
      randomUUID(),
    ),
    /時間/,
  );
  await assert.rejects(
    api(
      "create",
      { ...input, times: { ...times, pm2: ["17:00", "15:30"] } },
      token(),
      randomUUID(),
    ),
    /時間/,
  );
  await assert.rejects(
    api("create", { ...input, type: "meal" }, token(), randomUUID()),
    /類型/,
  );
});

test("預設名單全員含補答完成後自動結案，結果與原因固定保存", async () => {
  const eid = randomUUID(),
    key = token(),
    keys = [token(), token()];
  let d = await api(
    "create",
    {
      title: "全員結案",
      host: "主揪",
      type: "meal",
      times: { lunch: ["12:00", "14:00"], dinner: ["18:00", "21:00"] },
      names: ["甲", "乙"],
      slots: [lunch],
    },
    key,
    eid,
  );
  const ids = d.people.slice(1).map((p) => p.id);
  d = await api(
    "respond",
    { pid: ids[0], name: "甲", answers: { [lunch]: false } },
    keys[0],
    eid,
  );
  assert.equal(d.status, "open");
  d = await api("append", { slots: [dinner] }, key, eid);
  d = await api(
    "respond",
    { pid: ids[1], name: "乙", answers: { [lunch]: true, [dinner]: false } },
    keys[1],
    eid,
  );
  assert.equal(d.status, "open");
  assert.equal(d.people[1].answers[dinner], undefined);
  d = await api(
    "respond",
    { pid: ids[0], name: "甲", answers: { [lunch]: false, [dinner]: false } },
    keys[0],
    eid,
  );
  assert.equal(d.status, "closed");
  assert.equal(d.closedReason, "all_replied");
  assert.equal(d.archived, true);
  assert.ok(d.archivedAt);
  assert.equal(d.final, null);
  const snapshot = await api("get", {}, "", eid);
  assert.deepEqual(snapshot.people, d.people);
  await assert.rejects(
    api(
      "respond",
      { pid: ids[0], name: "甲", answers: { [lunch]: true, [dinner]: true } },
      keys[0],
      eid,
    ),
    /已關閉/,
  );
  await assert.rejects(api("append", { slots: [lunch] }, key, eid), /無法修改/);
  await assert.rejects(api("reopen", {}, key, eid), /固定存檔/);
});
test("沒有預設名單不自動結案；主揪可自行提前結案且其他人不可結案", async () => {
  const eid = randomUUID(),
    key = token(),
    friend = token();
  let d = await api(
    "create",
    {
      title: "開放邀約",
      host: "主揪",
      type: "class",
      times: { day: ["09:00", "17:00"] },
      names: [],
      slots: [date + "_day"],
    },
    key,
    eid,
  );
  d = await api(
    "respond",
    { pid: randomUUID(), name: "朋友", answers: { [date + "_day"]: true } },
    friend,
    eid,
  );
  assert.equal(d.status, "open");
  await assert.rejects(api("close", {}, friend, eid), /管理連結/);
  d = await api("close", {}, key, eid);
  assert.equal(d.closedReason, "host_closed");
  assert.equal(d.status, "closed");
  const eid2 = randomUUID(),
    key2 = token();
  d = await api(
    "create",
    {
      title: "提前結案",
      host: "主揪",
      type: "class",
      times: { day: ["09:00", "17:00"] },
      names: ["還沒回覆"],
      slots: [date + "_day"],
    },
    key2,
    eid2,
  );
  d = await api("close", {}, key2, eid2);
  assert.equal(d.people[1].submitted, false);
  assert.equal(d.status, "closed");
  assert.equal(d.closedReason, "host_closed");
});
test("時段改動使舊回覆失效，所有人補齊才自動結案", async () => {
  const eid = randomUUID(),
    key = token(),
    keys = [token(), token()];
  let d = await api(
    "create",
    {
      title: "改時段",
      host: "主揪",
      type: "class",
      times: { day: ["09:00", "17:00"] },
      names: ["甲", "乙"],
      slots: [date + "_day"],
    },
    key,
    eid,
  );
  const [a, b] = d.people.slice(1).map((p) => p.id);
  d = await api(
    "respond",
    { pid: a, name: "甲", answers: { [date + "_day"]: true } },
    keys[0],
    eid,
  );
  d = await api(
    "edit_event",
    {
      base_title: d.title,
      base_slots: d.slots,
      base_times: d.times,
      title: d.title,
      slots: d.slots,
      times: { day: ["10:00", "17:00"] },
    },
    key,
    eid,
  );
  d = await api(
    "respond",
    { pid: b, name: "乙", answers: { [date + "_day"]: true } },
    keys[1],
    eid,
  );
  assert.equal(d.status, "open");
  d = await api(
    "respond",
    { pid: a, name: "甲", answers: { [date + "_day"]: true } },
    keys[0],
    eid,
  );
  assert.equal(d.closedReason, "all_replied");
});
