import {
  TYPES,
  dateKey,
  taipeiToday,
  slotLabel,
  rankSlots,
  highlights,
} from "./domain.mjs";
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const uid = () => crypto.randomUUID(),
  secret = () => uid() + uid();
const params = new URLSearchParams(location.hash.slice(1));
let event = null,
  eid = params.get("e"),
  admin = params.get("admin"),
  edit = params.get("edit"),
  pid = params.get("p");
let cursor = new Date(taipeiToday() + "T12:00:00"),
  view = "month",
  mode = "fill",
  chosen = new Set(),
  answers = {},
  dirty = false,
  busy = false;
let draft = {
  title: "",
  host: "",
  names: "",
  type: "meal",
  times: {
    lunch: ["12:00", "14:00"],
    dinner: ["18:00", "21:00"],
    day: ["09:00", "17:00"],
  },
};
let newName = "",
  selectedPid = "",
  addMode = false,
  creation = null;
let requestEpoch = 0,
  syncing = false;
const storage = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      toast("此瀏覽器無法記住身分，請保留私人連結。");
    }
  },
};
function toast(s) {
  $("#toast").textContent = s;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast").classList.remove("show"), 5000);
}
function ask(message) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "confirm-dialog";
    dialog.setAttribute("aria-label", "確認操作");
    const text = document.createElement("p");
    text.textContent = message;
    const actions = document.createElement("div");
    actions.className = "actions";
    for (const [label, value] of [
      ["取消", "cancel"],
      ["確定", "confirm"],
    ]) {
      const button = document.createElement("button");
      button.textContent = label;
      button.className = value === "confirm" ? "primary" : "";
      button.onclick = () => dialog.close(value);
      actions.append(button);
    }
    dialog.append(text, actions);
    dialog.addEventListener(
      "close",
      () => {
        const ok = dialog.returnValue === "confirm";
        dialog.remove();
        resolve(ok);
      },
      { once: true },
    );
    document.body.append(dialog);
    dialog.showModal();
  });
}
const config = window.APP_CONFIG;
// Remember only credentials that have been verified by the server.
function rememberIdentity() {
  storage.set("ft:" + eid, admin ? { admin } : { pid, edit });
}
async function rpc(action, data = {}, token = "") {
  if (!config.supabaseUrl || !config.supabaseKey)
    throw Error("服務尚未設定完成，請稍後再試。");
  const r = await fetch(config.supabaseUrl + "/rest/v1/rpc/friend_time_api", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: config.supabaseKey },
    body: JSON.stringify({
      p_action: action,
      p_id: eid,
      p_token: token,
      p_data: data,
    }),
    signal: AbortSignal.timeout(20000),
  });
  let body;
  try {
    body = await r.json();
  } catch {
    throw Error("伺服器暫時無法回應，請稍後重試。");
  }
  if (!r.ok)
    throw Error(
      body.message?.includes("friend_time_api")
        ? "資料庫尚未啟用，請稍後再試。"
        : body.message || "連線失敗，請重試。",
    );
  return body;
}
function link(extra = {}) {
  return (
    location.origin +
    location.pathname +
    "#" +
    new URLSearchParams({ e: eid, ...extra })
  );
}
function copyBox(value, label) {
  return `<div class="link-box"><input aria-label="${label}" readonly value="${esc(value)}"><button data-copy="${esc(value)}">複製</button></div>`;
}
function top(title, sub, tag = "一起找到，剛剛好的時間") {
  return `<div class="hero"><div><div class="eyebrow">MAKE TIME FOR EACH OTHER</div><h1>${esc(title)}</h1><p class="lede">${esc(sub)}</p></div><span class="hero-tag">${tag}</span></div>`;
}
function timesInputs() {
  return (draft.type === "meal" ? ["lunch", "dinner"] : ["day"])
    .map(
      (t) =>
        `<label>${TYPES[t]}<div class="times"><input aria-label="${TYPES[t]}開始" type="time" data-time="${t}:0" value="${draft.times[t][0]}"><input aria-label="${TYPES[t]}結束" type="time" data-time="${t}:1" value="${draft.times[t][1]}"></div></label>`,
    )
    .join("");
}
function latestDate() {
  const d = new Date(taipeiToday() + "T12:00:00");
  d.setDate(d.getDate() + 730);
  return dateKey(d);
}
function calendar() {
  const type = event?.type || draft.type,
    types = type === "meal" ? ["lunch", "dinner"] : ["day"];
  let start = new Date(cursor),
    days = 7;
  if (view === "month") {
    start = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12);
    days =
      Math.ceil(
        (start.getDay() +
          new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()) /
          7,
      ) * 7;
    start.setDate(start.getDate() - start.getDay());
  } else start.setDate(start.getDate() - start.getDay());
  const ranked = event ? rankSlots(event) : [];
  let cells = "";
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = dateKey(d),
      outside = view === "month" && d.getMonth() !== cursor.getMonth();
    if (outside) {
      cells += '<div class="day empty"></div>';
      continue;
    }
    cells +=
      `<div class="day"><span class="date ${key === taipeiToday() ? "today" : ""}">${view === "week" ? `${d.getMonth() + 1}/` : ""}${d.getDate()}</span>` +
      types
        .map((t) => {
          const s = key + "_" + t,
            exists = event?.slots.includes(s),
            selecting = !event || addMode;
          if (!selecting && !exists) return "";
          const r = ranked.find((x) => x.slot === s);
          let cls = "",
            txt = TYPES[t],
            sub = "";
          if (selecting) {
            cls = chosen.has(s) || exists ? "selected" : "";
            txt = (chosen.has(s) || exists ? "✓ " : "") + txt;
          } else if (mode === "results") {
            cls = r.common ? "selected" : "";
            sub = `${r.yes.length}/${event.people.filter((p) => p.submitted).length} 人`;
          } else {
            cls =
              answers[s] === false
                ? "no"
                : answers[s] === undefined
                  ? "pending"
                  : "selected";
            txt =
              (answers[s] === false
                ? "✕ "
                : answers[s] === undefined
                  ? "? "
                  : "✓ ") + txt;
          }
          const disabled = selecting
            ? key < taipeiToday() || key > latestDate() || exists
            : mode === "results" || event.status !== "open";
          return `<button class="slot ${cls}" data-slot="${s}" aria-label="${slotLabel(s)}${!selecting && mode === "fill" ? (answers[s] === false ? " 不行" : answers[s] === undefined ? " 待補答" : " 可以") : ""}" aria-pressed="${selecting ? chosen.has(s) || !!exists : answers[s] === false}" ${disabled ? "disabled" : ""}>${txt}${sub ? `<small>${sub}</small>` : ""}</button>`;
        })
        .join("") +
      "</div>";
  }
  return `<div class="calendar-head"><h2>${cursor.getFullYear()} 年 ${cursor.getMonth() + 1} 月</h2><div class="nav"><button data-nav="-1" aria-label="上一${view === "month" ? "月" : "週"}">←</button><button data-nav="0">今天</button><button data-nav="1" aria-label="下一${view === "month" ? "月" : "週"}">→</button></div></div><div class="view-switch"><button data-view="month" class="${view === "month" ? "active" : ""}">月曆</button><button data-view="week" class="${view === "week" ? "active" : ""}">週曆</button></div><div class="weekdays">${["日", "一", "二", "三", "四", "五", "六"].map((x) => `<span>${x}</span>`).join("")}</div><div class="calendar ${view === "week" ? "week" : ""}">${cells}</div>`;
}
function createPage() {
  return (
    top("好久不見，約個時間。", "圈出你有空的日子，剩下的，一起決定。") +
    `<div class="layout"><aside><div class="card"><div class="step">01 / 這次想約什麼</div><h2>建立一個邀約</h2><label>邀約名稱<input id="title" maxlength="80" placeholder="例如：老朋友的週末聚餐" value="${esc(draft.title)}"></label><div class="segmented"><button data-type="meal" class="${draft.type === "meal" ? "active" : ""}">A · 吃飯</button><button data-type="class" class="${draft.type === "class" ? "active" : ""}">B · 上課</button></div>${timesInputs()}<label>你的名字（主揪）<input id="host" maxlength="30" placeholder="大家怎麼稱呼你？" value="${esc(draft.host)}"></label><label>受邀朋友 <span class="muted">選填</span><textarea id="names" placeholder="每行一位，或用逗號分隔">${esc(draft.names)}</textarea></label><small>先填名單，就能知道還在等誰。朋友也可以自行新增名字。</small></div></aside><section><div class="card"><div class="step">02 / 先圈選你可以的時間</div><h2>你的時間，是邀約的起點。</h2><p class="muted">可跨月份選擇；${draft.type === "meal" ? "午餐、晚餐分開計算。" : "每個日期代表完整白天。"}</p><div id="cal">${calendar()}</div><div class="legend"><span><i class="dot"></i>已選可行時間</span><span><i class="dot gray"></i>點一下加入，再點取消</span></div><div class="calendar-foot"><div><span class="count">${chosen.size}</span> 個候選時段</div><button id="create" class="primary" ${busy ? "disabled" : ""}>建立邀約，取得連結 →</button></div></div><small>免登入 · 朋友各自填寫 · 自動找出共同時間</small></section></div>`
  );
}
function resultRows(rows) {
  return rows
    .map(
      (r, i) =>
        `<div class="result-row"><div class="result-title"><strong>${i + 1}. ${esc(slotLabel(r.slot))}</strong><span class="badge">${r.yes.length} 人可以</span></div><div class="people">可以：${esc(r.yes.join("、") || "尚無")}</div>${r.no.length ? `<div class="people no-text">不行：${esc(r.no.join("、"))}</div>` : ""}${r.pending.length ? `<div class="people">待確認：${esc(r.pending.join("、"))}</div>` : ""}${admin && event.status === "open" ? `<button data-final="${r.slot}">確定這個時間</button>` : ""}</div>`,
    )
    .join("");
}
function results() {
  const h = highlights(event),
    done = event.people.filter((p) => p.submitted),
    pending = event.people.filter(
      (p) =>
        !p.submitted ||
        event.slots.some((s) => typeof p.answers[s] !== "boolean"),
    );
  return `<div class="card"><div class="step">大家的時間交集</div><h2>${h.common ? "目前已回覆者的共同時間" : "最多人可以的前三個時段"}</h2><p class="muted">已回覆 ${done.length}／${event.people.length} 人${event.rosterKnown ? "" : "（未預設名單，總人數可能增加）"}</p>${pending.length ? `<p class="notice">尚待回覆或補答：${esc(pending.map((p) => p.name).join("、"))}</p>` : '<p class="badge">目前名單已全部回覆</p>'}${resultRows(h.rows)}<details><summary>查看所有 ${event.slots.length} 個候選時段</summary>${resultRows(rankSlots(event))}</details></div>`;
}
function eventPage() {
  const own = event.people.find((p) => p.id === pid),
    locked = event.status !== "open";
  return (
    top(
      event.title,
      `${event.type === "meal" ? "一起吃飯" : "一起上課"} · 主揪 ${event.hostName}`,
      locked ? "邀約已關閉" : "邀約進行中",
    ) +
    `${locked ? `<div class="success"><strong>${event.final ? `已確定：${esc(slotLabel(event.final))}` : "本次邀約已結束"}</strong>${event.final ? ` · ${esc(event.times[event.final.split("_")[1]].join("–"))}` : ""}</div>` : ""}<div class="layout"><aside><div class="card"><h2>${admin ? "主揪管理" : "一起排個時間"}</h2>${Object.entries(
      event.times,
    )
      .filter(([t]) => (event.type === "meal" ? t !== "day" : t === "day"))
      .map(([t, v]) => `<p class="people">${TYPES[t]} ${esc(v.join("–"))}</p>`)
      .join(
        "",
      )}<label>邀請朋友的連結</label>${copyBox(link(), "邀請連結")}<small>持有連結的人可看見名字與回覆，請只分享給受邀朋友。</small>${admin ? `<details><summary>保留主揪管理連結</summary>${copyBox(link({ admin }), "主揪管理連結")}<small>這個連結可管理邀約，請勿放進群組。</small></details><div class="actions" style="margin-top:20px">${locked ? '<button id="reopen">重新開放填寫</button>' : '<button id="add">追加日期</button><button id="close">結束邀約</button>'}</div>` : `${edit && pid ? `<details><summary>我的私人修改連結</summary>${copyBox(link({ p: pid, edit }), "私人修改連結")}<small>請保留此連結，換手機也能修改答案。</small></details>` : ""}`}</div>${
      !admin && !locked
        ? `<div class="card"><div class="step">01 / 你是哪一位</div>${
            own
              ? `<h2>${esc(own.name)}</h2><small>你可以修改自己的回覆。</small>`
              : `<label>從名單選擇<select id="person" aria-label="從名單選擇"><option value="">新增我的名字</option>${event.people
                  .filter((p) => !p.submitted)
                  .map(
                    (p) =>
                      `<option value="${p.id}" ${selectedPid === p.id ? "selected" : ""}>${esc(p.name)}</option>`,
                  )
                  .join(
                    "",
                  )}</select></label>${!selectedPid ? `<label>你的名字<input id="newname" maxlength="30" placeholder="請使用容易辨識的名字" value="${esc(newName)}"></label>` : ""}<small>已填寫的名字需使用原裝置或私人修改連結。</small>`
          }</div>`
        : ""
    }</aside><section><div class="tabs">${!admin && !locked ? `<button data-mode="fill" class="${mode === "fill" ? "active" : ""}">填寫我的時間</button>` : ""}<button data-mode="results" class="${mode === "results" ? "active" : ""}">查看統計</button><button id="refresh">更新</button><small id="sync">每 20 秒同步</small></div>${addMode ? `<div class="card"><h2>追加你可以的日期</h2><p class="muted">既有回覆保留；新時段會請朋友補答。</p>${calendar()}<div class="calendar-foot"><span>新增 ${chosen.size} 個時段</span><button id="save-add" class="primary">儲存追加日期</button><button id="cancel-add">取消</button></div></div>` : `<div class="card"><div class="step">${mode === "fill" ? "02 / 排除不能參加的時間" : "月曆總覽"}</div><h2>${mode === "fill" ? "把不行的時間，輕輕劃掉。" : "每個時間，有誰能來？"}</h2>${mode === "fill" ? '<p class="muted">請標記不能參加的時間，其餘時段送出後視為可以。黃色 ? 代表新增待補答。</p><div class="actions"><button id="all-yes">全部都可以</button><button id="all-no">全部都不行</button></div><br>' : ""}${calendar()}${mode === "fill" ? `<div class="legend"><span><i class="dot"></i>可以</span><span><i class="dot red"></i>不行</span></div><div class="calendar-foot"><span>可以 ${event.slots.filter((s) => answers[s] === true).length} 個／不行 ${event.slots.filter((s) => answers[s] === false).length} 個${event.slots.some((s) => answers[s] === undefined) ? `／待補答 ${event.slots.filter((s) => answers[s] === undefined).length} 個` : ""}</span><button id="submit" class="primary" ${busy ? "disabled" : ""}>確認送出</button></div>` : ""}</div>${mode === "results" ? results() : ""}`}</section></div>`
  );
}
function render() {
  const active = document.activeElement;
  const focus = active?.closest("#app")
    ? {
        id: active.id,
        slot: active.dataset.slot,
        view: active.dataset.view,
        nav: active.dataset.nav,
        mode: active.dataset.mode,
      }
    : null;
  $("#app").innerHTML = event ? eventPage() : createPage();
  bind();
  const restored =
    focus &&
    (focus.id
      ? document.getElementById(focus.id)
      : focus.slot
        ? $(`[data-slot="${focus.slot}"]`)
        : focus.view
          ? $(`[data-view="${focus.view}"]`)
          : focus.nav
            ? $(`[data-nav="${focus.nav}"]`)
            : focus.mode
              ? $(`[data-mode="${focus.mode}"]`)
              : null);
  restored?.focus({ preventScroll: true });
}
function on(s, ev, fn) {
  document.querySelectorAll(s).forEach((el) => el.addEventListener(ev, fn));
}
function act(fn) {
  return async (e) => {
    if (busy) return;
    busy = true;
    requestEpoch++;
    $("#app").inert = true;
    try {
      await fn(e);
    } catch (e) {
      toast(
        e.name === "TimeoutError"
          ? "連線逾時，請重試；已送出的資料會保留。"
          : e.message,
      );
    } finally {
      busy = false;
      $("#app").inert = false;
      render();
    }
  };
}
function setPerson() {
  const own = event.people.find((p) => p.id === pid);
  answers = own
    ? { ...own.answers }
    : Object.fromEntries(event.slots.map((s) => [s, true]));
  dirty = false;
}
async function load() {
  if (!edit) pid = null;
  event = await rpc("get");
  if (admin) {
    await rpc("verify", {}, admin);
    mode = "results";
  }
  if (edit && pid) {
    if (event.people.some((p) => p.id === pid && p.submitted))
      await rpc("verify", { pid }, edit);
    else if (!params.get("edit")) {
      edit = null;
      pid = null;
      storage.set("ft:" + eid, null);
    } else throw Error("此私人修改連結尚未有已送出的回覆。");
  }
  if (admin || (edit && pid)) rememberIdentity();
  if (event.status !== "open") mode = "results";
  setPerson();
  cursor = new Date(event.slots[0].split("_")[0] + "T12:00:00");
  render();
}
function bind() {
  on("[data-copy]", "click", async (e) => {
    try {
      await navigator.clipboard.writeText(e.currentTarget.dataset.copy);
      toast("連結已複製");
    } catch {
      toast("請長按連結欄位，選取並複製。");
    }
  });
  on("[data-nav]", "click", (e) => {
    let n = Number(e.currentTarget.dataset.nav);
    if (!n) cursor = new Date(taipeiToday() + "T12:00:00");
    else if (view === "month")
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + n, 1, 12);
    else cursor.setDate(cursor.getDate() + 7 * n);
    render();
  });
  on("[data-view]", "click", (e) => {
    view = e.currentTarget.dataset.view;
    render();
  });
  on("[data-slot]", "click", (e) => {
    const s = e.currentTarget.dataset.slot;
    if (!event || addMode) {
      chosen.has(s) ? chosen.delete(s) : chosen.add(s);
    } else {
      answers[s] = answers[s] === false;
      dirty = true;
    }
    render();
  });
  on("[data-type]", "click", (e) => {
    const t = e.currentTarget.dataset.type;
    if (t !== draft.type) {
      draft.type = t;
      chosen.clear();
      render();
    }
  });
  ["title", "host", "names"].forEach((k) =>
    on("#" + k, "input", (e) => (draft[k] = e.target.value)),
  );
  on("[data-time]", "input", (e) => {
    const [t, i] = e.target.dataset.time.split(":");
    draft.times[t][i] = e.target.value;
  });
  on(
    "#create",
    "click",
    act(async () => {
      if (!draft.title.trim() || !draft.host.trim())
        throw Error("請填寫邀約名稱和你的名字。");
      if (!chosen.size) throw Error("請至少圈選一個可行時段。");
      for (const t of draft.type === "meal" ? ["lunch", "dinner"] : ["day"])
        if (!draft.times[t][0] || draft.times[t][0] >= draft.times[t][1])
          throw Error("結束時間必須晚於開始時間。");
      creation ??= { id: uid(), token: secret() };
      eid = creation.id;
      admin = creation.token;
      pid = null;
      edit = null;
      event = await rpc(
        "create",
        {
          title: draft.title.trim(),
          host: draft.host.trim(),
          names: [
            ...new Set(
              draft.names
                .split(/[,，\n]/)
                .map((x) => x.trim())
                .filter((x) => x && x !== draft.host.trim()),
            ),
          ],
          type: draft.type,
          times: draft.times,
          slots: [...chosen].sort(),
        },
        admin,
      );
      storage.set("ft:" + eid, { admin });
      history.replaceState(null, "", link({ admin }));
      mode = "results";
      chosen.clear();
      creation = null;
      toast("邀約已建立！請複製邀請連結給朋友。");
    }),
  );
  on("[data-mode]", "click", (e) => {
    mode = e.currentTarget.dataset.mode;
    render();
  });
  on("#newname", "input", (e) => (newName = e.target.value));
  on("#person", "change", (e) => {
    selectedPid = e.target.value;
    if (!event.people.some((p) => p.id === pid && p.submitted)) {
      pid = null;
      edit = null;
    }
    render();
  });
  on("#all-yes", "click", () => {
    event.slots.forEach((s) => (answers[s] = true));
    dirty = true;
    render();
  });
  on("#all-no", "click", () => {
    event.slots.forEach((s) => (answers[s] = false));
    dirty = true;
    render();
  });
  on(
    "#submit",
    "click",
    act(async () => {
      const name =
        event.people.find((p) => p.id === (pid || selectedPid))?.name ||
        newName.trim();
      if (!name) throw Error("請先選擇或填寫你的名字。");
      if (!edit) {
        edit = secret();
        pid = selectedPid || uid();
        storage.set("ft:" + eid, { pid, edit });
      }
      if (
        event.slots.some((s) => answers[s] === undefined) &&
        !(await ask(
          "新增的待補答時段，送出後會視為可以參加。請確認已檢查黃色時段。",
        ))
      )
        return;
      const outgoing = Object.fromEntries(
        event.slots.map((s) => [s, answers[s] !== false]),
      );
      event = await rpc("respond", { pid, name, answers: outgoing }, edit);
      storage.set("ft:" + eid, { pid, edit });
      history.replaceState(null, "", link({ p: pid, edit }));
      dirty = false;
      mode = "results";
      toast("已送出！你可以隨時回來修改。");
    }),
  );
  on(
    "#refresh",
    "click",
    act(async () => {
      const previous = { ...answers },
        wasDirty = dirty;
      event = await rpc("get");
      setPerson();
      if (wasDirty) {
        answers = Object.fromEntries(event.slots.map((s) => [s, previous[s]]));
        dirty = true;
      }
      if (event.status !== "open") mode = "results";
      toast(
        wasDirty
          ? "已更新，保留你尚未送出的選擇；新增時段請補答。"
          : "已更新最新回覆",
      );
    }),
  );
  on("#add", "click", () => {
    addMode = true;
    chosen.clear();
    render();
  });
  on("#cancel-add", "click", () => {
    addMode = false;
    chosen.clear();
    render();
  });
  on(
    "#save-add",
    "click",
    act(async () => {
      if (!chosen.size) throw Error("請選擇要追加的日期。");
      event = await rpc("append", { slots: [...chosen] }, admin);
      chosen.clear();
      addMode = false;
      toast("日期已追加，請分享連結提醒朋友補答。");
    }),
  );
  on(
    "[data-final]",
    "click",
    act(async (e) => {
      const s = e.currentTarget.dataset.final;
      if (s && (await ask(`確定選擇 ${slotLabel(s)}，並關閉填寫？`))) {
        event = await rpc("finalize", { slot: s }, admin);
        toast("活動時間已確定");
      }
    }),
  );
  on(
    "#close",
    "click",
    act(async () => {
      if (await ask("結束這次邀約？之後仍可重新開放。"))
        event = await rpc("close", {}, admin);
    }),
  );
  on(
    "#reopen",
    "click",
    act(async () => {
      event = await rpc("reopen", {}, admin);
    }),
  );
}
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
window.addEventListener("hashchange", () => location.reload());
if (eid) {
  const saved = storage.get("ft:" + eid);
  if (!admin && !edit && saved) {
    admin = saved.admin;
    edit = saved.edit;
    pid = saved.pid;
  }
  load().catch((e) => {
    $("#app").innerHTML =
      top("暫時無法開啟邀約", e.message) +
      `<button id="retry">重新載入</button> <a href="./">建立新邀約</a>`;
    $("#retry").onclick = () => location.reload();
  });
} else render();
async function sync() {
  if (!event || dirty || busy || addMode || document.hidden || syncing) return;
  const epoch = requestEpoch;
  syncing = true;
  try {
    const fresh = await rpc("get");
    // An editor or submission can start while the GET is in flight.
    if (dirty || busy || addMode || requestEpoch !== epoch) return;
    if (JSON.stringify(fresh) !== JSON.stringify(event)) {
      event = fresh;
      setPerson();
      if (event.status !== "open") mode = "results";
      render();
    }
    if ($("#sync")) $("#sync").textContent = "已同步";
  } catch {
    if ($("#sync")) $("#sync").textContent = "連線中斷，稍後重試";
  } finally {
    syncing = false;
  }
}
setInterval(sync, 20000);
