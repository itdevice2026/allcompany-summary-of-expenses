(function () {
"use strict";

/* ================= setup ================= */
const CFG = window.SOE_CONFIG || {};
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const DESCRIPTIONS = ["EASYTRIP TOLL RELOAD","AUTOSWEEP TOLL RELOAD","TOLL FEE","MEAL ALLOWANCE","GASOLINE","PARKING FEE","TRANSPORTATION","GRAB / TAXI FARE","OFFICE SUPPLIES","COMPUTER PARTS / ACCESSORIES","COURIER / DELIVERY","LOAD / COMMUNICATION","REPRESENTATION","HOTEL / ACCOMMODATION","REPAIRS AND MAINTENANCE"];
const STATUS_LABEL = { draft: "Draft", submitted: "Submitted", approved: "Approved", returned: "Returned" };
const ROLE_LABEL = { employee: "Employee", finance: "Finance", admin: "Admin", disabled: "Disabled" };

const S = {
  session: null, profile: null, companies: [], mine: [], all: [], users: [],
  view: "mine", current: null, authMode: "signin", recovery: false,
  finFilter: { company: "", status: "submitted", q: "" },
  dirty: false, saving: false, confirmDelete: false
};
const isFinance = () => S.profile && (S.profile.role === "finance" || S.profile.role === "admin");
const isAdmin = () => S.profile && S.profile.role === "admin";

/* ================= helpers ================= */
const $ = s => document.querySelector(s);
const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const num = v => { const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; };
const peso = n => n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const totalOf = d => (d.items || []).reduce((a, r) => a + num(r.amount), 0);
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDate(iso) { if (!iso) return ""; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); if (!m) return iso; return `${m[3]}-${MON[+m[2] - 1]}-${m[1].slice(2)}`; }
function fmtStamp(ts) { if (!ts) return ""; const d = new Date(ts); return `${String(d.getDate()).padStart(2, "0")}-${MON[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`; }
function company(code) { return S.companies.find(c => c.code === code) || { code, name: code, address: "" }; }
function dateRange(d) { const ds = (d.items || []).map(r => r.date).filter(Boolean).sort(); if (!ds.length) return "No dates yet"; return ds[0] === ds[ds.length - 1] ? fmtDate(ds[0]) : `${fmtDate(ds[0])} – ${fmtDate(ds[ds.length - 1])}`; }
function blankLine(dept) { return { date: new Date().toISOString().slice(0, 10), si: "", supplier: "", tin: "", amount: "", dept: dept || "", desc: "", remarks: "" }; }

function words(n) {
  const a = ["","ONE","TWO","THREE","FOUR","FIVE","SIX","SEVEN","EIGHT","NINE","TEN","ELEVEN","TWELVE","THIRTEEN","FOURTEEN","FIFTEEN","SIXTEEN","SEVENTEEN","EIGHTEEN","NINETEEN"];
  const t = ["","","TWENTY","THIRTY","FORTY","FIFTY","SIXTY","SEVENTY","EIGHTY","NINETY"];
  const h = x => { let s = ""; if (x >= 100) { s += a[Math.floor(x / 100)] + " HUNDRED"; x %= 100; if (x) s += " "; } if (x >= 20) { s += t[Math.floor(x / 10)]; if (x % 10) s += "-" + a[x % 10]; } else if (x) s += a[x]; return s; };
  let p = Math.floor(n + 1e-9), c = Math.round((n - p) * 100); if (c === 100) { p++; c = 0; }
  if (p === 0 && c === 0) return "ZERO PESOS";
  const parts = []; [[1e9, "BILLION"], [1e6, "MILLION"], [1e3, "THOUSAND"], [1, ""]].forEach(([u, l]) => { const q = Math.floor(p / u); if (q) { parts.push(h(q) + (l ? " " + l : "")); p %= u; } });
  let s = (parts.join(" ") || "ZERO") + " PESOS"; if (c) s += ` AND ${String(c).padStart(2, "0")}/100`; return s + " ONLY";
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2800); }
function notice(msg) { const n = $("#notice"); if (!msg) { n.hidden = true; return; } n.textContent = msg; n.hidden = false; }
function errText(e) {
  const m = (e && (e.message || e.error_description)) || String(e || "");
  if (/Invalid login credentials/i.test(m)) return "Wrong email or password.";
  if (/Email not confirmed/i.test(m)) return "Confirm your email first — check your inbox for the link.";
  if (/already registered/i.test(m)) return "That email already has an account. Sign in instead, or use Forgot password.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Can't reach the server. Check your internet connection.";
  return m.replace(/^.*?ERROR:\s*/, "");
}

/* row <-> internal */
function fromRow(r) {
  return { id: r.id, owner: r.owner_id, data: {
    company: r.company_code, refNo: r.ref_no || "", employeeName: r.employee_name, department: r.department,
    status: r.status, financeNote: r.finance_note || "", items: Array.isArray(r.items) ? r.items : [],
    updatedAt: r.updated_at, submittedAt: r.submitted_at, reviewedAt: r.reviewed_at, createdAt: r.created_at
  } };
}
function toRow(d) {
  return { company_code: d.company, employee_name: (d.employeeName || "").toUpperCase(), department: (d.department || "").toUpperCase(),
    status: d.status, finance_note: d.financeNote || "", items: d.items || [] };
}

/* ================= data ================= */
async function loadCompanies() {
  const { data, error } = await sb.from("soe_companies").select("*").order("sort");
  if (error) throw error; S.companies = data || [];
}
async function loadMine() {
  const { data, error } = await sb.from("soe_reports").select("*").eq("owner_id", S.session.user.id).order("updated_at", { ascending: false });
  if (error) throw error; S.mine = (data || []).map(fromRow);
}
async function loadAll() {
  if (!isFinance()) return;
  const { data, error } = await sb.from("soe_reports").select("*").order("updated_at", { ascending: false }).limit(1000);
  if (error) throw error; S.all = (data || []).map(fromRow);
}
async function loadUsers() {
  if (!isAdmin()) return;
  const { data, error } = await sb.from("soe_profiles").select("*").order("created_at");
  if (error) throw error; S.users = data || [];
}

let saveTimer = null, queue = Promise.resolve();
function markDirty() { S.dirty = true; setSaveState(); clearTimeout(saveTimer); saveTimer = setTimeout(() => persist(), 900); }
function setSaveState(txt) {
  const el = $("#save-state"); if (!el || !S.current) return;
  el.textContent = txt || (S.saving ? "Saving…" : S.dirty ? "Unsaved changes" : S.current.data.updatedAt ? `Saved ${fmtStamp(S.current.data.updatedAt)}` : "");
}
function persist(extra) {
  const c = S.current; if (!c) return Promise.resolve(true);
  clearTimeout(saveTimer);
  Object.assign(c.data, extra || {});
  const id = c.id, body = toRow(c.data);
  S.saving = true; setSaveState();
  let ok = true;
  queue = queue.then(async () => {
    const { data, error } = await sb.from("soe_reports").update(body).eq("id", id).select().single();
    if (error) throw error;
    const fresh = fromRow(data);
    [S.mine, S.all].forEach(list => { const i = list.findIndex(r => r.id === id); if (i >= 0) list[i] = fresh; });
    if (S.current && S.current.id === id) {
      // keep the user's in-progress inputs, take server fields
      S.current.data.refNo = fresh.data.refNo; S.current.data.updatedAt = fresh.data.updatedAt;
      S.current.data.status = fresh.data.status; S.current.data.submittedAt = fresh.data.submittedAt; S.current.data.reviewedAt = fresh.data.reviewedAt;
      const ref = $("#f-ref"); if (ref) ref.value = fresh.data.refNo;
    }
    S.dirty = false;
  }).catch(e => { ok = false; toast("Couldn't save: " + errText(e)); })
    .finally(() => { S.saving = false; setSaveState(); refreshList(); });
  return queue.then(() => ok);
}

/* ================= auth views ================= */
function renderAuth() {
  $("#tabs").innerHTML = ""; $("#userbar").hidden = true; notice("");
  const m = S.recovery ? "newpass" : S.authMode;
  const titles = { signin: ["Sign in", "Use the same account as your other Meatplus group apps."], signup: ["Create account", "For employees of the Meatplus group of companies."], forgot: ["Reset password", "We'll email you a link to set a new password."], newpass: ["Set a new password", "Choose a password with at least 8 characters."] };
  const [h, sub] = titles[m];
  $("#main").innerHTML = `<div class="auth"><h2>${h}</h2><p class="sub">${sub}</p>
    <form id="auth-form" novalidate>
      ${m === "signup" ? `<div class="row"><label for="a-name">Full name</label><input id="a-name" autocomplete="name" required style="text-transform:uppercase"></div>` : ""}
      ${m !== "newpass" ? `<div class="row"><label for="a-email">Email</label><input id="a-email" type="email" autocomplete="email" required></div>` : ""}
      ${m === "signin" || m === "signup" || m === "newpass" ? `<div class="row"><label for="a-pass">${m === "newpass" ? "New password" : "Password"}</label><input id="a-pass" type="password" autocomplete="${m === "signin" ? "current-password" : "new-password"}" required minlength="${m === "signin" ? 1 : 8}"></div>` : ""}
      <div class="err" id="a-err"></div>
      <button class="btn primary" type="submit" id="a-submit">${{ signin: "Sign in", signup: "Create account", forgot: "Send reset link", newpass: "Save new password" }[m]}</button>
      ${m !== "newpass" ? `<div class="links">
        ${m !== "signin" ? `<button type="button" class="linkbtn" data-auth="signin">Back to sign in</button>` : `<button type="button" class="linkbtn" data-auth="signup">Create an account</button>`}
        ${m === "signin" ? `<button type="button" class="linkbtn" data-auth="forgot">Forgot password?</button>` : ""}
      </div>` : ""}
    </form></div>`;
  const f = $("#a-email") || $("#a-pass"); f && f.focus();
}
async function onAuthSubmit(e) {
  e.preventDefault();
  const m = S.recovery ? "newpass" : S.authMode, err = $("#a-err"), btn = $("#a-submit");
  const email = ($("#a-email") || {}).value, pass = ($("#a-pass") || {}).value;
  err.textContent = "";
  if (m !== "newpass" && !/^\S+@\S+\.\S+$/.test(email || "")) { err.textContent = "Enter a valid email address."; return; }
  if ((m === "signup" || m === "newpass") && (!pass || pass.length < 8)) { err.textContent = "Password must be at least 8 characters."; return; }
  btn.disabled = true;
  try {
    if (m === "signin") {
      const { error } = await sb.auth.signInWithPassword({ email, password: pass }); if (error) throw error;
    } else if (m === "signup") {
      const name = ($("#a-name").value || "").trim().toUpperCase();
      if (!name) { err.textContent = "Enter your full name."; btn.disabled = false; return; }
      const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { full_name: name }, emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error;
      if (!data.session) { S.authMode = "signin"; renderAuth(); notice("Account created. Check your email and click the confirmation link, then sign in."); return; }
    } else if (m === "forgot") {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); if (error) throw error;
      S.authMode = "signin"; renderAuth(); notice("If that email has an account, a reset link is on its way."); return;
    } else if (m === "newpass") {
      const { error } = await sb.auth.updateUser({ password: pass }); if (error) throw error;
      S.recovery = false; toast("Password updated"); await startApp(); return;
    }
  } catch (ex) { err.textContent = errText(ex); }
  btn.disabled = false;
}

/* ================= app views ================= */
function renderUserbar() {
  const u = $("#userbar"); u.hidden = false;
  u.innerHTML = `<span>${esc(S.profile.full_name || S.profile.email)}</span><span class="role">${ROLE_LABEL[S.profile.role] || S.profile.role}</span><button type="button" class="linkbtn" data-act="signout">Sign out</button>`;
}
function renderTabs() {
  const tabs = [["mine", "My reports"]];
  if (isFinance()) tabs.push(["finance", "Finance review"]);
  if (isAdmin()) tabs.push(["admin", "Companies & users"]);
  $("#tabs").innerHTML = tabs.map(([k, l]) => `<button type="button" data-tab="${k}" aria-pressed="${S.view === k}">${l}</button>`).join("");
}
function render() {
  if (!S.session) return renderAuth();
  if (S.recovery) return renderAuth();
  renderUserbar(); renderTabs();
  $("#whoami").textContent = isFinance() ? "Review, approve and print reports for every group company" : "Encode your receipts, submit to Finance, and print the form";
  const m = $("#main");
  if (S.view === "admin" && isAdmin()) return renderAdmin(m);
  if (S.view === "finance" && isFinance()) return renderFinance(m);
  S.view = "mine"; renderMine(m);
}
function cardHTML(r) {
  const d = r.data, c = company(d.company), cur = S.current && S.current.id === r.id;
  return `<button type="button" class="rcard" data-open="${esc(r.id)}" aria-current="${!!cur}">
    <span class="co">${esc(c.code)}</span><span class="amt">₱${peso(totalOf(d))}</span>
    <span class="meta">${esc(d.refNo)} · ${esc(dateRange(d))}</span><span class="pill ${esc(d.status)}">${STATUS_LABEL[d.status] || esc(d.status)}</span>
  </button>`;
}
function listHTML() {
  return `<div class="list-head"><span class="eyebrow">My reports (${S.mine.length})</span><button type="button" class="btn primary" data-act="new">+ New report</button></div>
    ${S.mine.length ? S.mine.map(cardHTML).join("") : `<div class="empty"><strong>No reports yet</strong>Click <b>+ New report</b>, pick the company, and encode each receipt as one line.</div>`}`;
}
function refreshList() { const a = document.querySelector("aside.list"); if (a && S.view === "mine") a.innerHTML = listHTML(); }
function renderMine(m) {
  const needProfile = !S.profile.full_name || !S.profile.department;
  m.innerHTML = `${needProfile ? `<form class="prof" id="prof-form">
      <div class="field"><label for="p-name">Your full name</label><input id="p-name" value="${esc(S.profile.full_name)}" required></div>
      <div class="field"><label for="p-dept">Department</label><input id="p-dept" value="${esc(S.profile.department)}" placeholder="e.g. INFORMATION SYSTEM RESOURCES" required></div>
      <button class="btn primary" type="submit">Save my details</button>
    </form>` : ""}
    <div class="layout"><aside class="list">${listHTML()}</aside><section id="sheet-host" style="min-width:0"></section></div>`;
  if (!S.current && S.mine.length) S.current = clone(S.mine[0]);
  renderSheet();
}
function canEditLines() {
  const c = S.current; if (!c) return false;
  return c.owner === S.session.user.id && (c.data.status === "draft" || c.data.status === "returned");
}
function renderSheet() {
  const host = $("#sheet-host"); if (!host) return;
  const c = S.current;
  if (!c) { host.innerHTML = `<div class="empty"><strong>Select or start a report</strong>Your reports appear on the left. Each one prints as a Summary of Expenses for the company you choose.</div>`; return; }
  const d = c.data, ed = canEditLines(), co = company(d.company), isMine = c.owner === S.session.user.id;
  const reviewing = S.view === "finance" && isFinance();
  const ro = ed ? "" : "readonly";
  const remarksEditable = reviewing && d.status === "submitted";
  const rows = (d.items || []).map((r, i) => `<tr>
    <td style="width:130px"><input id="r${i}-date" type="date" data-line="${i}" data-k="date" value="${esc(r.date)}" ${ro} aria-label="Invoice date line ${i + 1}"></td>
    <td class="mono" style="width:150px"><input id="r${i}-si" data-line="${i}" data-k="si" value="${esc(r.si)}" ${ro} aria-label="SI number line ${i + 1}"></td>
    <td><input id="r${i}-supplier" data-line="${i}" data-k="supplier" value="${esc(r.supplier)}" ${ro} aria-label="Supplier line ${i + 1}" style="text-transform:uppercase"></td>
    <td class="mono" style="width:130px"><input id="r${i}-tin" data-line="${i}" data-k="tin" value="${esc(r.tin)}" ${ro} placeholder="000-000-000-000" aria-label="TIN line ${i + 1}"></td>
    <td class="num" style="width:110px"><input id="r${i}-amount" data-line="${i}" data-k="amount" inputmode="decimal" value="${esc(r.amount)}" ${ro} aria-label="Amount line ${i + 1}"></td>
    <td style="width:80px"><input id="r${i}-dept" data-line="${i}" data-k="dept" value="${esc(r.dept)}" ${ro} aria-label="Department line ${i + 1}" style="text-transform:uppercase"></td>
    <td style="width:190px"><input id="r${i}-desc" data-line="${i}" data-k="desc" list="desc-list" value="${esc(r.desc)}" ${ro} aria-label="Description line ${i + 1}" style="text-transform:uppercase"></td>
    <td style="width:160px"><input id="r${i}-remarks" data-line="${i}" data-k="remarks" value="${esc(r.remarks)}" ${remarksEditable ? "" : "readonly"} placeholder="${remarksEditable ? "Finance remark" : ""}" aria-label="Finance remarks line ${i + 1}"></td>
    <td class="x">${ed ? `<button type="button" class="rm" data-act="rmline" data-i="${i}" aria-label="Remove line ${i + 1}">×</button>` : ""}</td>
  </tr>`).join("");
  const t = totalOf(d);
  host.innerHTML = `<div class="sheet">
    <div class="sheet-tools">
      <div class="left"><span class="pill ${esc(d.status)}">${STATUS_LABEL[d.status] || esc(d.status)}</span><span class="save-state" id="save-state"></span></div>
      <div class="right">
        <button type="button" class="btn" data-act="csv">Download CSV</button>
        <button type="button" class="btn" data-act="print">Print</button>
        ${isMine && ed ? (S.confirmDelete ? `<span class="confirm">Delete this report?<button type="button" class="btn danger" data-act="del-yes">Delete</button><button type="button" class="btn ghost" data-act="del-no">Keep</button></span>` : `<button type="button" class="btn danger" data-act="del">Delete</button>`) : ""}
        ${isMine && ed ? `<button type="button" class="btn primary" data-act="submit" ${(d.items || []).length ? "" : "disabled"}>Submit to Finance</button>` : ""}
      </div>
    </div>
    <div class="co-head">
      ${ed ? `<select id="f-company" data-f="company" aria-label="Company">${S.companies.map(x => `<option value="${esc(x.code)}" ${x.code === d.company ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>` : `<div class="co-name">${esc(co.name)}</div>`}
      <div class="addr">${co.address ? esc(co.address) : (isAdmin() ? "Address not set — add it under Companies & users" : "")}</div>
    </div>
    <div class="fields">
      <div class="field"><label for="f-ref">Reference No.</label><input id="f-ref" class="mono" value="${esc(d.refNo)}" readonly></div>
      <div class="field"><label for="f-emp">Employee name</label><input id="f-emp" data-f="employeeName" value="${esc(d.employeeName)}" ${ro} autocomplete="name"></div>
      <div class="field"><label for="f-dept">Department</label><input id="f-dept" data-f="department" value="${esc(d.department)}" ${ro} placeholder="e.g. INFORMATION SYSTEM RESOURCES"></div>
    </div>
    <div class="tbl-wrap"><table class="lines">
      <thead><tr><th>Invoice date</th><th>SI#</th><th>Supplier's name</th><th>TIN</th><th style="text-align:right">Amount</th><th>Dept.</th><th>Description</th><th>Remarks <span style="font-weight:500">(Finance)</span></th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="9" style="padding:16px;color:var(--muted);text-align:center">No lines yet. Add one per receipt.</td></tr>`}</tbody>
      <tfoot><tr><td colspan="4" style="text-align:right;text-transform:uppercase;letter-spacing:.06em;font-size:12px">Total amount</td><td class="total" id="total">${peso(t)}</td><td colspan="4"></td></tr></tfoot>
    </table></div>
    <div class="below">
      ${ed ? `<button type="button" class="btn" data-act="addline">+ Add line</button>` : "<span></span>"}
      <span class="words" id="words">${esc(words(t))}</span>
    </div>
    ${d.status === "returned" && d.financeNote ? `<div class="fin-note"><b>Returned by Finance:</b> ${esc(d.financeNote)}</div>` : ""}
    ${d.status === "approved" ? `<div class="fin-note ok"><b>Approved</b>${d.reviewedAt ? ` on ${fmtStamp(d.reviewedAt)}` : ""}${d.financeNote ? ` — ${esc(d.financeNote)}` : ""}</div>` : ""}
    ${reviewing && d.status === "submitted" ? `<div class="review-bar">
      <input id="f-note" placeholder="Note to employee (required when returning)" value="${esc(d.financeNote || "")}">
      <button type="button" class="btn danger" data-act="return">Return for correction</button>
      <button type="button" class="btn primary" data-act="approve">Approve</button>
    </div>` : ""}
    ${reviewing && (d.status === "approved" || d.status === "returned") ? `<div class="review-bar"><button type="button" class="btn" data-act="reopen">Move back to Submitted</button></div>` : ""}
    <datalist id="desc-list">${DESCRIPTIONS.map(x => `<option value="${esc(x)}"></option>`).join("")}</datalist>
  </div>`;
  setSaveState();
}
function finRows() {
  const f = S.finFilter, q = f.q.trim().toLowerCase();
  return S.all.filter(r => (!f.company || r.data.company === f.company) && (!f.status || r.data.status === f.status) &&
    (!q || [r.data.employeeName, r.data.refNo, r.data.department, ...(r.data.items || []).map(i => i.supplier)].join(" ").toLowerCase().includes(q)))
    .sort((a, b) => new Date(b.data.submittedAt || b.data.updatedAt) - new Date(a.data.submittedAt || a.data.updatedAt));
}
function renderFinance(m) {
  const rows = finRows(), all = S.all;
  const sumBy = st => all.filter(r => r.data.status === st).reduce((a, r) => a + totalOf(r.data), 0);
  m.innerHTML = `<div class="sumrow">
      <div class="sum"><div class="k">Awaiting review</div><div class="v">${all.filter(r => r.data.status === "submitted").length}</div></div>
      <div class="sum"><div class="k">Pending amount</div><div class="v">₱${peso(sumBy("submitted"))}</div></div>
      <div class="sum"><div class="k">Approved amount</div><div class="v">₱${peso(sumBy("approved"))}</div></div>
      <div class="sum"><div class="k">Returned</div><div class="v">${all.filter(r => r.data.status === "returned").length}</div></div>
    </div>
    <div class="filters">
      <select id="ff-company" aria-label="Filter by company"><option value="">All companies</option>${S.companies.map(c => `<option value="${esc(c.code)}" ${S.finFilter.company === c.code ? "selected" : ""}>${esc(c.code)} — ${esc(c.name)}</option>`).join("")}</select>
      <select id="ff-status" aria-label="Filter by status"><option value="">All statuses</option>${Object.keys(STATUS_LABEL).map(s => `<option value="${s}" ${S.finFilter.status === s ? "selected" : ""}>${STATUS_LABEL[s]}</option>`).join("")}</select>
      <input id="ff-q" type="search" placeholder="Search employee, reference no., supplier" value="${esc(S.finFilter.q)}">
      <button type="button" class="btn" data-act="refresh">Refresh</button>
      <button type="button" class="btn" data-act="export">Export list (CSV)</button>
    </div>
    <div style="overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius)"><table class="fin">
      <thead><tr><th>Ref. No.</th><th>Company</th><th>Employee</th><th>Department</th><th>Period</th><th>Status</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows.length ? rows.map(r => `<tr data-open="${esc(r.id)}" tabindex="0"><td style="font-family:var(--font-mono);font-size:12px">${esc(r.data.refNo)}</td><td>${esc(r.data.company)}</td><td>${esc(r.data.employeeName)}</td><td>${esc(r.data.department)}</td><td>${esc(dateRange(r.data))}</td><td><span class="pill ${esc(r.data.status)}">${STATUS_LABEL[r.data.status]}</span></td><td class="num">₱${peso(totalOf(r.data))}</td></tr>`).join("") : `<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--muted)">${all.length ? "No reports match these filters." : "No reports have been saved yet."}</td></tr>`}</tbody>
    </table></div>
    <div id="sheet-host" style="margin-top:18px"></div>`;
  if (S.current && S.current.fromFinance) renderSheet();
}
function renderAdmin(m) {
  const me = S.session.user.id;
  m.innerHTML = `<h3 class="sec" style="margin-top:0">Companies</h3>
  <p style="color:var(--muted);margin-top:0;max-width:65ch">The name and address print at the top of each Summary of Expenses.</p>
  <div class="co-grid">${S.companies.map((c, i) => `<div class="co-row">
    <input id="co${i}-code" value="${esc(c.code)}" readonly aria-label="Code" style="font-family:var(--font-mono)">
    <input id="co${i}-name" data-co="${i}" data-k="name" value="${esc(c.name)}" aria-label="Company name">
    <input id="co${i}-addr" data-co="${i}" data-k="address" value="${esc(c.address)}" placeholder="Address" aria-label="Address">
  </div>`).join("")}</div>
  <div style="margin-top:12px"><button type="button" class="btn primary" data-act="savecos">Save companies</button></div>
  <h3 class="sec">Users</h3>
  <p style="color:var(--muted);margin-top:0;max-width:65ch">People appear here after they sign in once. Finance can review and approve every report; Admin can also edit companies and roles. Disabled users can't create or edit reports.</p>
  <div style="overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius)"><table class="users">
    <thead><tr><th>Name</th><th>Email</th><th>Department</th><th>Role</th></tr></thead>
    <tbody>${S.users.map(u => `<tr><td>${esc(u.full_name || "—")}</td><td>${esc(u.email)}</td><td>${esc(u.department)}</td><td>
      <select id="role-${esc(u.user_id)}" data-role="${esc(u.user_id)}" ${u.user_id === me ? "disabled" : ""} aria-label="Role for ${esc(u.email)}">${Object.keys(ROLE_LABEL).map(k => `<option value="${k}" ${u.role === k ? "selected" : ""}>${ROLE_LABEL[k]}</option>`).join("")}</select>
    </td></tr>`).join("")}</tbody>
  </table></div>`;
}

/* ================= outputs ================= */
function csvFor(d) {
  const co = company(d.company), q = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const lines = [[co.name], [co.address], ["SUMMARY OF EXPENSES"], ["Reference No.", d.refNo], ["Employee Name", d.employeeName], ["Department", d.department], [],
    ["Invoice Date", "SI#", "Supplier's Name", "TIN", "Amount", "Department", "Description", "Remarks"]];
  (d.items || []).forEach(r => lines.push([fmtDate(r.date), r.si, r.supplier, r.tin, num(r.amount).toFixed(2), r.dept, r.desc, r.remarks]));
  lines.push(["", "", "", "TOTAL AMOUNT", totalOf(d).toFixed(2)]);
  return "﻿" + lines.map(l => l.map(q).join(",")).join("\r\n");
}
function printableFor(d) {
  const co = company(d.company), t = totalOf(d);
  const rows = (d.items || []).map(r => `<tr><td>${esc(fmtDate(r.date))}</td><td>${esc(r.si)}</td><td>${esc(String(r.supplier).toUpperCase())}</td><td>${esc(r.tin)}</td><td class="n">${peso(num(r.amount))}</td><td>${esc(String(r.dept).toUpperCase())}</td><td>${esc(String(r.desc).toUpperCase())}</td><td>${esc(r.remarks)}</td></tr>`).join("");
  const blanks = Array.from({ length: Math.max(0, 12 - (d.items || []).length) }, () => `<tr class="blank"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.refNo)} Summary of Expenses</title><style>
@page{size:A4 landscape;margin:12mm}body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#000;margin:0}
h1{font-size:16px;text-align:center;margin:0}.addr{text-align:center;margin:2px 0 14px}
.hdr{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;margin-bottom:10px}.hdr b{white-space:nowrap}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #000;padding:4px 5px;text-align:left;vertical-align:top}th{background:#eee;font-size:10px;text-transform:uppercase}
.n{text-align:right;white-space:nowrap}tr.blank td{height:16px}.tot td{font-weight:bold}.title{text-align:center;font-weight:bold;font-size:13px;margin:14px 0 4px;letter-spacing:.08em}
.sig{display:grid;grid-template-columns:repeat(3,1fr);gap:30px;margin-top:40px}.sig div{border-top:1px solid #000;padding-top:3px;text-align:center}
.status{float:right;border:1px solid #000;padding:2px 8px;font-weight:bold;text-transform:uppercase;font-size:10px}
</style></head><body>
<span class="status">${esc(STATUS_LABEL[d.status] || d.status)}</span>
<h1>${esc(co.name)}</h1><div class="addr">${esc(co.address)}</div>
<div class="hdr"><b>Reference No.:</b><span>${esc(d.refNo)}</span><b>EMPLOYEE NAME:</b><span>${esc(String(d.employeeName).toUpperCase())}</span><b>DEPARTMENT:</b><span>${esc(String(d.department).toUpperCase())}</span></div>
<table><thead><tr><th>Invoice Date</th><th>SI#</th><th>Supplier's Name</th><th>TIN</th><th class="n">Amount</th><th>Department</th><th>Description</th><th>Remarks (for Finance use only)</th></tr></thead>
<tbody>${rows}${blanks}<tr class="tot"><td colspan="4" class="n">TOTAL AMOUNT:</td><td class="n">${peso(t)}</td><td colspan="3">${esc(words(t))}</td></tr></tbody></table>
<div class="title">SUMMARY OF EXPENSES</div>
<div class="sig"><div>Prepared by: ${esc(String(d.employeeName).toUpperCase())}</div><div>Checked by</div><div>Approved by</div></div>
<script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script>
</body></html>`;
}
function saveFile(filename, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function printReport(d) {
  const w = window.open("", "_blank");
  if (!w) { toast("Allow pop-ups for this site to print."); return; }
  w.document.open(); w.document.write(printableFor(d)); w.document.close();
}

/* ================= actions ================= */
async function newReport() {
  const last = S.mine[0] && S.mine[0].data;
  const row = {
    company_code: (last && last.company) || (S.companies[0] && S.companies[0].code) || "MTC",
    employee_name: (S.profile.full_name || (last && last.employeeName) || "").toUpperCase(),
    department: (S.profile.department || (last && last.department) || "").toUpperCase(),
    status: "draft", items: [blankLine(last && last.items && last.items[0] && last.items[0].dept)]
  };
  const { data, error } = await sb.from("soe_reports").insert(row).select().single();
  if (error) { toast("Couldn't create report: " + errText(error)); return; }
  const r = fromRow(data); S.mine.unshift(r); S.current = clone(r); S.confirmDelete = false;
  render(); const f = $("#r0-si"); f && f.focus();
}
async function openReport(id, fromFinance) {
  if (S.dirty) await persist();
  const r = (fromFinance ? S.all : S.mine).find(x => x.id === id); if (!r) return;
  S.current = Object.assign(clone(r), { fromFinance: !!fromFinance }); S.confirmDelete = false;
  if (fromFinance) { renderSheet(); const h = $("#sheet-host"); h && h.scrollIntoView && h.scrollIntoView({ behavior: "smooth", block: "start" }); }
  else render();
}
async function switchView(v) {
  if (S.dirty) await persist();
  S.view = v; S.current = null;
  try {
    if (v === "finance") await loadAll();
    if (v === "admin") await Promise.all([loadUsers(), loadCompanies()]);
    if (v === "mine") await loadMine();
  } catch (e) { toast(errText(e)); }
  render();
}

document.addEventListener("submit", async e => {
  if (e.target.id === "auth-form") return onAuthSubmit(e);
  if (e.target.id === "prof-form") {
    e.preventDefault();
    const name = $("#p-name").value.trim().toUpperCase(), dept = $("#p-dept").value.trim().toUpperCase();
    if (!name || !dept) { toast("Enter your name and department."); return; }
    const { data, error } = await sb.from("soe_profiles").update({ full_name: name, department: dept }).eq("user_id", S.session.user.id).select().single();
    if (error) { toast(errText(error)); return; }
    S.profile = data; toast("Details saved"); render();
  }
});

document.addEventListener("click", async e => {
  const au = e.target.closest("[data-auth]"); if (au) { S.authMode = au.dataset.auth; notice(""); renderAuth(); return; }
  const tab = e.target.closest("[data-tab]"); if (tab) { switchView(tab.dataset.tab); return; }
  const op = e.target.closest("[data-open]"); if (op) { openReport(op.dataset.open, S.view === "finance"); return; }
  const a = e.target.closest("[data-act]"); if (!a) return;
  const act = a.dataset.act, c = S.current;
  if (act === "signout") { if (S.dirty) await persist(); await sb.auth.signOut(); return; }
  if (act === "new") return newReport();
  if (act === "refresh") { try { await loadAll(); toast("Updated"); } catch (er) { toast(errText(er)); } renderFinance($("#main")); return; }
  if (act === "export") {
    const q = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const lines = [["Ref. No.", "Company", "Employee", "Department", "Period", "Status", "Submitted", "Amount"]].concat(finRows().map(r => [r.data.refNo, r.data.company, r.data.employeeName, r.data.department, dateRange(r.data), STATUS_LABEL[r.data.status], fmtStamp(r.data.submittedAt), totalOf(r.data).toFixed(2)]));
    saveFile(`ALLCOMPANY_Expenses_${new Date().toISOString().slice(0, 10)}.csv`, "﻿" + lines.map(l => l.map(q).join(",")).join("\r\n"), "text/csv;charset=utf-8"); return;
  }
  if (!c && !["savecos"].includes(act)) return;
  if (act === "addline") { c.data.items.push(blankLine((c.data.items[c.data.items.length - 1] || {}).dept)); renderSheet(); markDirty(); const f = $(`#r${c.data.items.length - 1}-si`); f && f.focus(); return; }
  if (act === "rmline") { c.data.items.splice(+a.dataset.i, 1); renderSheet(); markDirty(); return; }
  if (act === "csv") { saveFile(`${(c.data.refNo || "report").replace(/[^A-Za-z0-9_-]/g, "_")}_Summary_of_Expenses.csv`, csvFor(c.data), "text/csv;charset=utf-8"); return; }
  if (act === "print") { if (S.dirty) await persist(); printReport(S.current.data); return; }
  if (act === "del") { S.confirmDelete = true; renderSheet(); return; }
  if (act === "del-no") { S.confirmDelete = false; renderSheet(); return; }
  if (act === "del-yes") {
    clearTimeout(saveTimer); S.dirty = false; await queue;
    const { error } = await sb.from("soe_reports").delete().eq("id", c.id);
    if (error) { toast("Couldn't delete: " + errText(error)); return; }
    S.mine = S.mine.filter(r => r.id !== c.id); S.current = null; S.confirmDelete = false; toast("Report deleted"); render(); return;
  }
  if (act === "submit") {
    const d = c.data, bad = (d.items || []).findIndex(r => !r.date || !String(r.supplier).trim() || num(r.amount) <= 0);
    if (!String(d.employeeName).trim() || !String(d.department).trim()) { toast("Fill in employee name and department first."); return; }
    if (bad >= 0) { toast(`Line ${bad + 1} needs a date, supplier and amount.`); return; }
    const prev = d.status;
    if (await persist({ status: "submitted" })) { toast("Submitted to Finance"); render(); } else { d.status = prev; }
    return;
  }
  if (act === "approve" || act === "return" || act === "reopen") {
    const note = (($("#f-note") || {}).value || "").trim();
    if (act === "return" && !note) { toast("Add a note telling the employee what to fix."); $("#f-note").focus(); return; }
    const st = { approve: "approved", return: "returned", reopen: "submitted" }[act];
    const extra = { status: st }; if (act !== "reopen") extra.financeNote = note;
    if (await persist(extra)) { toast({ approved: "Approved", returned: "Returned to employee", submitted: "Moved back to Submitted" }[st]); renderFinance($("#main")); }
    return;
  }
});
document.addEventListener("click", async e => {
  const a = e.target.closest('[data-act="savecos"]'); if (!a) return;
  a.disabled = true;
  try {
    for (const co of S.companies) { const { error } = await sb.from("soe_companies").update({ name: co.name.trim().toUpperCase(), address: co.address.trim() }).eq("code", co.code); if (error) throw error; }
    toast("Companies saved"); await loadCompanies(); render();
  } catch (er) { toast("Couldn't save companies: " + errText(er)); }
  a.disabled = false;
});
document.addEventListener("input", e => {
  const el = e.target;
  if (el.dataset.co !== undefined) { S.companies[+el.dataset.co][el.dataset.k] = el.value; return; }
  if (el.id === "ff-q") { S.finFilter.q = el.value; const pos = el.selectionStart; renderFinance($("#main")); const n = $("#ff-q"); n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) {} return; }
  const c = S.current; if (!c) return;
  if (el.dataset.line !== undefined) {
    const r = c.data.items[+el.dataset.line]; if (!r) return; r[el.dataset.k] = el.value;
    if (el.dataset.k === "amount") { const t = totalOf(c.data); $("#total").textContent = peso(t); $("#words").textContent = words(t); }
    markDirty(); return;
  }
  if (el.dataset.f) { c.data[el.dataset.f] = el.value; if (el.dataset.f === "company") renderSheet(); markDirty(); }
});
document.addEventListener("change", async e => {
  const el = e.target;
  if (el.id === "ff-company") { S.finFilter.company = el.value; renderFinance($("#main")); return; }
  if (el.id === "ff-status") { S.finFilter.status = el.value; renderFinance($("#main")); return; }
  if (el.dataset && el.dataset.role) {
    const { error } = await sb.from("soe_profiles").update({ role: el.value }).eq("user_id", el.dataset.role);
    if (error) { toast("Couldn't change role: " + errText(error)); await loadUsers(); render(); } else toast("Role updated");
    return;
  }
  if (el.dataset && el.dataset.k === "amount" && el.value && S.current) { const v = num(el.value).toFixed(2); el.value = v; S.current.data.items[+el.dataset.line].amount = v; }
});
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches("tr[data-open]")) e.target.click(); });
window.addEventListener("beforeunload", e => { if (S.dirty) { persist(); e.preventDefault(); e.returnValue = ""; } });

/* ================= boot ================= */
async function startApp() {
  try {
    const { data: prof, error } = await sb.rpc("soe_me");
    if (error) throw error;
    S.profile = prof;
    const meta = (S.session.user.user_metadata || {});
    if (!S.profile.full_name && meta.full_name) {
      const { data } = await sb.from("soe_profiles").update({ full_name: String(meta.full_name).toUpperCase() }).eq("user_id", S.session.user.id).select().single();
      if (data) S.profile = data;
    }
    if (S.profile.role === "disabled") notice("Your account is disabled for this app. Contact IT if you need access.");
    await Promise.all([loadCompanies(), loadMine()]);
    if (isFinance() && S.view === "finance") await loadAll();
  } catch (e) { notice("Couldn't load your data: " + errText(e)); }
  render();
}
let started = false;
sb.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY") { S.session = session; S.recovery = true; renderAuth(); return; }
  if (event === "SIGNED_OUT") { S.session = null; S.profile = null; S.mine = []; S.all = []; S.current = null; started = false; S.view = "mine"; renderAuth(); return; }
  if (session && !started && !S.recovery) { S.session = session; started = true; setTimeout(startApp, 0); return; }
  if (session) S.session = session;
  if (event === "INITIAL_SESSION" && !session) renderAuth();
});
})();
