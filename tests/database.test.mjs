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
      names: ["朋友"],
      slots: [lunch],
    },
    admin,
  );
  assert.equal(doc.people.length, 2);
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
  assert.equal(doc.people.length, 3);
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
  assert.equal(doc.people[2].answers[dinner], undefined);
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
  assert.equal(doc.people[2].answers[dinner], false);
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
