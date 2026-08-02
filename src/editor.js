import { BRAND_CSS, brandSvg } from "./brand.js";

/* ------------------------------------------------------------------ utils */

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null && v !== false) n.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
};
const money = (n) =>
  n == null ? "" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (n) => (n == null ? "" : Math.round(Number(n)).toLocaleString("en-US"));

const pillClass = (t) => (t === "Expense" ? "exp" : t === "Donation" ? "don" : "inc");

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const STATUSES = ["Occupied", "Unregistered", "Pending", "Bare Land", "Vacant House"];
const CATEGORIES = ["Dansal / Events", "Utilities", "Cleaning", "Bank",
  "Bank Interest", "Withholding Tax", "Online Bank Charges",
  "Maintenance", "Security", "Membership", "Other"];
/* Contribution and Donation are both money in; Expense is money out.
   Type carries ONE meaning — the direction of the money — so its three values
   are all a reader (or the fund arithmetic) ever has to understand. What kind
   of movement it was belongs in Category, which is free text and costs nothing
   to extend. */
const TX_TYPES = ["Contribution", "Donation", "Expense"];

/* Categories whose direction is never in doubt. Picking one preselects the
   Type so it cannot be left on the wrong sign by accident — the commonest way
   to get a ledger wrong. It is only a default: the Type dropdown stays free,
   and touching it stops this from overriding the choice. */
const CATEGORY_DIRECTION = {
  "Bank Interest": "Contribution",
  "Withholding Tax": "Expense",
  "Online Bank Charges": "Expense",
  "Dansal / Events": "Donation",
  "Utilities": "Expense",
  "Cleaning": "Expense",
  "Maintenance": "Expense",
  "Security": "Expense",
  "Membership": "Contribution",
};

let DATA = null;
let USERS_DATA = null;
let IS_ADMIN = false;
let TAB = "ledger";

/* ------------------------------------------------------------------ toast */

function toast(msg, kind = "ok") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show " + kind;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = "toast"), kind === "err" ? 6000 : 3000);
}

/* -------------------------------------------------------------------- api */

async function api(path, method = "GET", body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error(payload?.error || `Request failed (${res.status})`);
  return payload;
}

/** Run a mutation, refresh, and report — used by every save button. */
async function mutate(path, method, body, okMsg) {
  try {
    await api(path, method, body);
    await refresh();
    toast(okMsg);
    return true;
  } catch (err) {
    toast(err.message, "err");
    return false;
  }
}

async function refresh() {
  DATA = await api("/api/admin/data");
  render();
}

/* ------------------------------------------------------------------- auth */

async function boot() {
  const params = new URLSearchParams(location.search);
  const inviteToken = params.get("invite");
  if (inviteToken) return showAcceptInvite(inviteToken);
  const resetToken = params.get("reset");
  if (resetToken) return showResetPassword(resetToken);

  let me = null;
  try { me = await api("/api/auth/me"); } catch { /* offline */ }

  if (!me?.signedIn) return showLogin();
  if (!me.canEdit) return showNoAccess(me.email);

  IS_ADMIN = !!me.canManageUsers;
  $("#who").textContent = me.email;
  $("#signout").hidden = false;
  $("#exports").hidden = false;
  try {
    await refresh();
  } catch (err) {
    showError(err.message);
  }
}

function screen(...nodes) {
  const root = $("#app");
  root.replaceChildren(...nodes);
}

function card(title, ...kids) {
  return el("div", { class: "card narrow" }, el("h2", {}, title), ...kids);
}

function showNoAccess(email) {
  $("#who").textContent = email;
  $("#signout").hidden = false;
  screen(card("No edit access",
    el("p", { class: "muted" },
      `You are signed in as ${email}, but your account does not have the "editor" role, ` +
      "so you cannot change any figures. Ask a site owner to grant it directly in the database."),
  ));
}

function showError(msg) {
  screen(card("Something went wrong", el("p", { class: "muted" }, msg)));
}

function showLogin() {
  const email = el("input", { type: "email", required: true, autocomplete: "username", placeholder: "you@example.com" });
  const pass = el("input", { type: "password", required: true, autocomplete: "current-password", placeholder: "Your password" });
  const btn = el("button", { class: "btn primary", type: "submit" }, "Sign in");

  const form = el("form", {
    class: "stack",
    onSubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true; btn.textContent = "Signing in…";
      try {
        await api("/api/auth/login", "POST", { email: email.value.trim(), password: pass.value });
        await boot();
      } catch (err) {
        toast(err.message, "err");
        btn.disabled = false; btn.textContent = "Sign in";
      }
    },
  },
    el("label", {}, "Email", email),
    el("label", {}, "Password", pass),
    btn,
  );

  const cardEl = card("Committee sign-in",
    el("p", { class: "muted" },
      "Editing is limited to committee members with an account. The public dashboard stays readable by everyone."),
    form);
  cardEl.prepend(el("div", { class: "brand brand-stack loginmark", html: brandSvg("full", 74) }));
  screen(cardEl);
}

async function showAcceptInvite(token) {
  let invite;
  try {
    invite = await api(`/api/invites/${encodeURIComponent(token)}`);
  } catch (err) {
    screen(card("Invitation not available", el("p", { class: "muted" }, err.message)));
    return;
  }

  const name = el("input", { type: "text", required: true, autocomplete: "name", maxlength: "200" });
  const pass = el("input", { type: "password", required: true, minlength: "8", autocomplete: "new-password" });
  const btn = el("button", { class: "btn primary", type: "submit" }, "Create account");

  const form = el("form", {
    class: "stack",
    onSubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true; btn.textContent = "Creating…";
      try {
        await api("/api/auth/accept-invite", "POST", { token, name: name.value.trim(), password: pass.value });
        history.replaceState(null, "", "/editor");
        await boot();
      } catch (err) {
        toast(err.message, "err");
        btn.disabled = false; btn.textContent = "Create account";
      }
    },
  },
    el("label", {}, "Your name", name),
    el("label", {}, "Choose a password (at least 8 characters)", pass),
    btn,
  );

  screen(card("Join as " + invite.role,
    el("p", { class: "muted" }, `Invited as ${invite.email}.`),
    form));
}

async function showResetPassword(token) {
  let reset;
  try {
    reset = await api(`/api/password-resets/${encodeURIComponent(token)}`);
  } catch (err) {
    screen(card("Reset link not available", el("p", { class: "muted" }, err.message)));
    return;
  }

  const pass = el("input", { type: "password", required: true, minlength: "8", autocomplete: "new-password" });
  const btn = el("button", { class: "btn primary", type: "submit" }, "Set password");

  const form = el("form", {
    class: "stack",
    onSubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true; btn.textContent = "Saving…";
      try {
        await api("/api/auth/reset-password", "POST", { token, password: pass.value });
        history.replaceState(null, "", "/editor");
        await boot();
      } catch (err) {
        toast(err.message, "err");
        btn.disabled = false; btn.textContent = "Set password";
      }
    },
  },
    el("label", {}, "New password (at least 8 characters)", pass),
    btn,
  );

  screen(card("Set a new password",
    el("p", { class: "muted" }, `For ${reset.email}.`),
    form));
}

/* ------------------------------------------------------------------ shell */

function render() {
  const tabs = [
    ["ledger", "Contributions & expenses"],
    ["goals", "Goals"],
    ["collections", "Collections"],
    ["plots", "Plots & names"],
    ["settings", "Settings"],
    ["activity", "Activity"],
  ];
  if (IS_ADMIN) tabs.push(["users", "Users & invites"]);

  screen(
    el("div", { class: "summary" },
      stat("Fund balance", "Rs. " + money(DATA.fundBalance)),
      stat("Collected " + DATA.year, "Rs. " + int(DATA.collections2026)),
      stat("Arrears to date", "Rs. " + int(DATA.arrears)),
      stat("Months completed", String(DATA.monthsDone)),
    ),
    el("nav", { class: "tabs" },
      tabs.map(([id, label]) =>
        el("button", {
          class: "tab" + (TAB === id ? " active" : ""),
          onClick: () => { TAB = id; render(); },
        }, label))),
    el("div", { class: "card" },
      TAB === "ledger" ? ledgerTab()
      : TAB === "goals" ? goalsTab()
      : TAB === "collections" ? collectionsTab()
      : TAB === "plots" ? plotsTab()
      : TAB === "settings" ? settingsTab()
      : TAB === "users" ? usersTab()
      : activityTab()),
  );
}

const stat = (k, v) => el("div", { class: "stat" }, el("div", { class: "k" }, k), el("div", { class: "v" }, v));

/* ----------------------------------------------------------------- ledger */

function ledgerTab() {
  const rows = DATA.transactions.map((t) => {
    const edit = () => showTxForm(t);
    return el("tr", {},
      el("td", {}, t.date || "—"),
      el("td", {}, t.desc),
      el("td", {}, t.cat),
      el("td", {}, el("span", { class: "pill " + pillClass(t.type) }, t.type)),
      el("td", { class: "num" }, money(t.amt)),
      el("td", { class: "muted small" }, t.note || ""),
      el("td", { class: "num nowrap" },
        el("button", { class: "linkbtn", onClick: edit }, "Edit"),
        " ",
        el("button", {
          class: "linkbtn danger",
          onClick: () => confirmDelete(
            `Delete "${t.desc}" (Rs. ${money(t.amt)})?`,
            () => mutate(`/api/edit/transactions/${t.id}`, "DELETE", null, "Transaction deleted."),
          ),
        }, "Delete")),
    );
  });

  return el("div", {},
    header("Contributions, donations and expenses",
      "Everything outside the monthly membership fee. Enter every amount as a positive number — " +
      "choosing Expense records it as money out.",
      el("button", { class: "btn primary", onClick: () => showTxForm(null) }, "Add entry")),
    el("p", { class: "warn" },
      "This ledger is shown on the public dashboard. Do not put household names in a description."),
    table(["Date", "Description", "Category", "Type", "Amount (Rs.)", "Note", ""], rows),
  );
}

function showTxForm(tx) {
  const isNew = !tx;
  const date = el("input", { type: "date", value: tx?.date || "" });
  const desc = el("input", { type: "text", required: true, maxlength: "300", value: tx?.desc || "" });
  const cat = el("input", { type: "text", required: true, list: "cats", value: tx?.cat || "" });
  const type = el("select", {},
    ...TX_TYPES.map((v) => el("option", { value: v, selected: tx?.type === v }, v)));
  const typeHint = el("p", { class: "muted small", style: "margin:4px 0 0" }, "");

  /* Once the editor picks a Type themselves, stop second-guessing them. */
  let typeTouched = !!tx;
  type.addEventListener("change", () => { typeTouched = true; typeHint.textContent = ""; });

  cat.addEventListener("input", () => {
    const implied = CATEGORY_DIRECTION[cat.value.trim()];
    // A category we know nothing about must not leave a stale claim on screen
    // saying the Type was set for a reason that no longer applies.
    if (!implied) { typeHint.textContent = ""; return; }
    if (typeTouched) return;
    type.value = implied;
    typeHint.textContent =
      implied === "Expense"
        ? "Set to Expense — this will subtract from the fund."
        : "Set to " + implied + " — this will add to the fund.";
  });
  const amt = el("input", {
    type: "number", step: "0.01", min: "0", required: true,
    value: tx ? Math.abs(tx.amt) : "",
  });
  const note = el("input", { type: "text", maxlength: "500", value: tx?.note || "" });

  modal(isNew ? "Add an entry" : "Edit entry",
    el("div", { class: "grid2" },
      el("label", {}, "Date", date),
      el("label", {}, "Type", type, typeHint),
      el("label", { class: "wide" }, "Description", desc),
      el("label", {}, "Category", cat),
      el("label", {}, "Amount (Rs.)", amt),
      el("p", { class: "muted small wide", style: "margin:0" },
        "Enter the amount as a positive number. Type decides the direction: an Expense is " +
        "stored as a negative so the fund balance is a plain sum."),
      el("label", { class: "wide" }, "Note (optional)", note),
      el("datalist", { id: "cats" }, ...CATEGORIES.map((c) => el("option", { value: c }))),
    ),
    async () => {
      const body = {
        date: date.value || null, description: desc.value, category: cat.value,
        type: type.value, amount: amt.value, notes: note.value || null,
      };
      return isNew
        ? mutate("/api/edit/transactions", "POST", body, "Entry added.")
        : mutate(`/api/edit/transactions/${tx.id}`, "PUT", body, "Entry updated.");
    });
}

/* ------------------------------------------------------------------ goals */

function goalsTab() {
  const rows = DATA.projects.map((p) =>
    el("tr", {},
      el("td", {}, p.name),
      el("td", {}, p.priority),
      el("td", {}, p.status),
      el("td", { class: "num" }, p.cost == null ? "—" : int(p.cost)),
      el("td", { class: "num" }, p.saved == null ? "—" : int(p.saved)),
      el("td", { class: "num" }, p.quotations),
      el("td", { class: "num nowrap" },
        el("button", { class: "linkbtn", onClick: () => showGoalForm(p) }, "Edit"),
        " ",
        el("button", {
          class: "linkbtn danger",
          onClick: () => confirmDelete(`Delete the goal "${p.name}"?`,
            () => mutate(`/api/edit/projects/${p.id}`, "DELETE", null, "Goal deleted.")),
        }, "Delete")),
    ));

  return el("div", {},
    header("Goals", "Planned projects and what they are expected to cost.",
      el("button", { class: "btn primary", onClick: () => showGoalForm(null) }, "Add goal")),
    table(["Goal", "Priority", "Status", "Cost (Rs.)", "Saved (Rs.)", "Quotes", ""], rows),
  );
}

function showGoalForm(p) {
  const isNew = !p;
  const name = el("input", { type: "text", required: true, maxlength: "200", value: p?.name || "" });
  const priority = el("select", {}, ...["High", "Medium", "Low"].map((v) =>
    el("option", { value: v, selected: p?.priority === v }, v)));
  const status = el("select", {}, ...["Planned", "Quoting", "Approved", "In progress", "Done", "On hold"].map((v) =>
    el("option", { value: v, selected: p?.status === v }, v)));
  const cost = el("input", { type: "number", step: "0.01", min: "0", value: p?.cost ?? "" });
  const saved = el("input", { type: "number", step: "0.01", min: "0", value: p?.saved ?? "" });
  const quotes = el("input", { type: "number", step: "1", min: "0", value: p?.quotations ?? 0 });
  const note = el("input", { type: "text", maxlength: "500", value: p?.note || "" });

  modal(isNew ? "Add a goal" : "Edit goal",
    el("div", { class: "grid2" },
      el("label", { class: "wide" }, "Goal", name),
      el("label", {}, "Priority", priority),
      el("label", {}, "Status", status),
      el("label", {}, "Estimated cost (Rs.)", cost),
      el("label", {}, "Saved so far (Rs.)", saved),
      el("label", {}, "Quotations received", quotes),
      el("label", { class: "wide" }, "Note", note),
    ),
    async () => {
      const body = {
        name: name.value, priority: priority.value, status: status.value,
        cost: cost.value || null, saved: saved.value || null,
        quotations: quotes.value || 0, note: note.value || null,
      };
      return isNew
        ? mutate("/api/edit/projects", "POST", body, "Goal added.")
        : mutate(`/api/edit/projects/${p.id}`, "PUT", body, "Goal updated.");
    });
}

/* ------------------------------------------------------------ collections */

function collectionsTab() {
  const filter = el("input", { type: "search", placeholder: "Filter by plot or name…", class: "filter" });
  const onlyOccupied = el("input", { type: "checkbox", checked: true });
  const body = el("tbody");

  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    body.replaceChildren(...DATA.plotRegister
      .filter((p) => (!onlyOccupied.checked || p.status === "Occupied"))
      .filter((p) => !q || p.house.toLowerCase().includes(q) || (p.owner || "").toLowerCase().includes(q))
      .map((p) => el("tr", {},
        el("td", { class: "nowrap" }, p.house),
        el("td", { class: "nowrap" }, p.owner || el("span", { class: "muted" }, "—")),
        ...p.months.map((amt, i) => el("td", { class: "cell" }, cellInput(p, i + 1, amt))),
        el("td", { class: "num strong" }, int(p.months.reduce((s, v) => s + v, 0))),
      )));
  };

  filter.addEventListener("input", draw);
  onlyOccupied.addEventListener("change", draw);
  draw();

  return el("div", {},
    header("Monthly collections",
      `Type an amount to record a payment; clear the box to remove it. Changes save when you leave the box. Year ${DATA.year}.`),
    el("div", { class: "toolbar" }, filter,
      el("label", { class: "check" }, onlyOccupied, "Occupied plots only")),
    el("div", { class: "tbl-scroll" },
      el("table", { class: "grid" },
        el("thead", {}, el("tr", {},
          el("th", {}, "Plot"), el("th", {}, "Household"),
          ...MONTHS.map((m) => el("th", { class: "num" }, m)),
          el("th", { class: "num" }, "Total"))),
        body)),
  );
}

function cellInput(plot, month, amount) {
  const input = el("input", {
    type: "number", step: "0.01", min: "0", class: "cellinput",
    value: amount || "", "aria-label": `Plot ${plot.house}, ${MONTHS[month - 1]}`,
  });
  let previous = input.value;

  input.addEventListener("blur", async () => {
    if (input.value === previous) return;
    input.disabled = true;
    try {
      await api("/api/edit/collections", "PUT", {
        house: plot.house, year: DATA.year, month, amount: input.value === "" ? 0 : input.value,
      });
      previous = input.value;
      input.classList.add("saved");
      setTimeout(() => input.classList.remove("saved"), 900);
      // keep totals and every derived figure honest without redrawing the grid
      DATA = await api("/api/admin/data");
      const row = DATA.plotRegister.find((p) => p.house === plot.house);
      if (row) plot.months = row.months;
      const cell = input.closest("tr")?.lastElementChild;
      if (cell) cell.textContent = int(plot.months.reduce((s, v) => s + v, 0));
    } catch (err) {
      input.value = previous;
      toast(err.message, "err");
    } finally {
      input.disabled = false;
    }
  });
  return input;
}

/* ------------------------------------------------------------------ plots */

function plotsTab() {
  const filter = el("input", { type: "search", placeholder: "Filter by plot or name…", class: "filter" });
  const body = el("tbody");

  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    body.replaceChildren(...DATA.plotRegister
      .filter((p) => !q || p.house.toLowerCase().includes(q) || (p.owner || "").toLowerCase().includes(q))
      .map((p) => el("tr", {},
        el("td", { class: "nowrap" }, p.house),
        el("td", {}, p.owner || el("span", { class: "muted" }, "—")),
        el("td", {}, p.status),
        el("td", { class: "num" }, p.bf == null ? "—" : int(p.bf)),
        el("td", { class: "num" },
          el("button", { class: "linkbtn", onClick: () => showPlotForm(p) }, "Edit")))));
  };
  filter.addEventListener("input", draw);
  draw();

  return el("div", {},
    header("Plots and household names",
      "Names are visible only here, to signed-in committee members. The public dashboard shows plot numbers only."),
    el("div", { class: "toolbar" }, filter),
    el("div", { class: "tbl-scroll" },
      el("table", {},
        el("thead", {}, el("tr", {},
          el("th", {}, "Plot"), el("th", {}, "Household"), el("th", {}, "Status"),
          el("th", { class: "num" }, "2025 b/f"), el("th", {}, ""))),
        body)),
  );
}

function showPlotForm(p) {
  const house = el("input", { type: "text", maxlength: "20", required: true, value: p.house });
  const owner = el("input", { type: "text", maxlength: "200", value: p.owner || "" });
  const status = el("select", {}, ...STATUSES.map((v) =>
    el("option", { value: v, selected: p.status === v }, v)));
  const bf = el("input", { type: "number", step: "0.01", value: p.bf ?? "" });

  const warn = el("p", { class: "warn wide", hidden: true },
    "Renumbering moves this plot's entire payment history with it.");
  house.addEventListener("input", () => {
    warn.hidden = house.value.trim() === p.house;
  });

  modal(`Plot ${p.house}`,
    el("div", { class: "grid2" },
      el("label", {}, "Plot number", house),
      el("label", {}, "Status", status),
      warn,
      el("label", { class: "wide" }, "Household name", owner),
      el("label", {}, "2025 balance brought forward", bf),
      el("p", { class: "muted small wide" },
        "Only plots marked Occupied are counted as owing the monthly fee."),
    ),
    () => mutate(`/api/edit/plots/${encodeURIComponent(p.house)}`, "PUT",
      { house: house.value.trim(), owner: owner.value || null,
        status: status.value, bf: bf.value || null },
      house.value.trim() === p.house ? "Plot updated."
        : `Plot renumbered to ${house.value.trim()}.`));
}

/* --------------------------------------------------------------- settings */

function settingsTab() {
  const rows = DATA.settings.map((s) => {
    const input = el("input", { type: "text", value: s.value, class: "setting" });
    return el("tr", {},
      el("td", { class: "nowrap" }, s.key),
      el("td", {}, input),
      el("td", { class: "muted small" }, s.note || ""),
      el("td", { class: "num" },
        el("button", {
          class: "btn small",
          onClick: () => mutate(`/api/edit/settings/${encodeURIComponent(s.key)}`, "PUT",
            { value: input.value }, "Setting saved."),
        }, "Save")));
  });

  return el("div", {},
    header("Settings", "These drive every calculated figure on the dashboard."),
    el("p", { class: "warn" },
      "Months completed must be increased each month, or the year-end forecast will keep " +
      "projecting from a stale average."),
    table(["Setting", "Value", "What it does", ""], rows),
  );
}

/* ------------------------------------------------------------------ users */

function usersTab() {
  if (!USERS_DATA) {
    api("/api/admin/users")
      .then((d) => { USERS_DATA = d; if (TAB === "users") render(); })
      .catch((err) => toast(err.message, "err"));
    return el("p", { class: "muted" }, "Loading…");
  }

  const email = el("input", { type: "email", required: true, placeholder: "you@example.com" });
  const role = el("select", {}, el("option", { value: "editor" }, "editor"), el("option", { value: "admin" }, "admin"));
  const inviteBtn = el("button", { class: "btn primary", type: "submit" }, "Create invite link");
  const inviteForm = el("form", {
    class: "stack",
    onSubmit: async (e) => {
      e.preventDefault();
      inviteBtn.disabled = true;
      try {
        const { inviteUrl } = await api("/api/admin/invites", "POST", { email: email.value.trim(), role: role.value });
        USERS_DATA = null;
        toast("Invite created — copy the link below and send it.");
        email.value = "";
        render();
        showLinkModal("Invite link", "Copy this and send it to them. It works once.", inviteUrl);
      } catch (err) {
        toast(err.message, "err");
      } finally {
        inviteBtn.disabled = false;
      }
    },
  },
    el("label", {}, "Email", email),
    el("label", {}, "Role", role),
    inviteBtn,
  );

  const inviteRows = USERS_DATA.invites.map((i) =>
    el("tr", {},
      el("td", {}, i.email),
      el("td", {}, i.role),
      el("td", { class: "muted small" }, i.expired ? "Expired" : "Expires " + new Date(i.expiresAt).toLocaleDateString()),
      el("td", { class: "num" },
        el("button", {
          class: "linkbtn danger",
          onClick: () => confirmDelete(`Revoke the invite for ${i.email}?`, async () => {
            await api(`/api/admin/invites/${i.id}`, "DELETE");
            USERS_DATA = null;
            render();
          }),
        }, "Revoke"))));

  const userRows = USERS_DATA.users.map((u) => {
    const roleSelect = el("select", {},
      el("option", { value: "editor", selected: u.role === "editor" }, "editor"),
      el("option", { value: "admin", selected: u.role === "admin" }, "admin"));
    return el("tr", {},
      el("td", {}, u.email),
      el("td", {}, u.name || "—"),
      el("td", {}, roleSelect),
      el("td", { class: "num nowrap" },
        el("button", {
          class: "btn small",
          onClick: async () => {
            try {
              await api(`/api/admin/users/${u.id}`, "PUT", { role: roleSelect.value });
              toast("Role updated.");
              USERS_DATA = null;
              render();
            } catch (err) { toast(err.message, "err"); }
          },
        }, "Save role"),
        " ",
        el("button", {
          class: "btn small",
          onClick: async () => {
            try {
              const { resetUrl } = await api(`/api/admin/users/${u.id}/reset-password`, "POST");
              showLinkModal("Password reset link",
                `Copy this and send it to ${u.email}. It works once and expires in 24 hours.`, resetUrl);
            } catch (err) { toast(err.message, "err"); }
          },
        }, "Reset password"),
        " ",
        el("button", {
          class: "linkbtn danger",
          onClick: () => confirmDelete(`Remove ${u.email}'s account?`, async () => {
            try {
              await api(`/api/admin/users/${u.id}`, "DELETE");
              USERS_DATA = null;
              render();
            } catch (err) { toast(err.message, "err"); }
          }),
        }, "Remove")));
  });

  return el("div", {},
    header("Invite someone", "Creates a one-time link — you send it however you like. Expires in 7 days."),
    inviteForm,
    el("h3", { style: "margin-top:28px" }, "Pending invites"),
    table(["Email", "Role", "Status", ""], inviteRows),
    el("h3", { style: "margin-top:28px" }, "Accounts"),
    table(["Email", "Name", "Role", ""], userRows),
  );
}

function showLinkModal(title, hint, url) {
  const input = el("input", { type: "text", readonly: true, value: url, onClick: (e) => e.target.select() });
  const back = el("div", { class: "backdrop" });
  const close = () => back.remove();
  back.append(el("div", { class: "modal" },
    el("h3", {}, title),
    el("p", { class: "muted" }, hint),
    el("label", {}, "Link", input),
    el("div", { class: "actions" },
      el("button", { class: "btn", onClick: close }, "Close"),
      el("button", {
        class: "btn primary", type: "button",
        onClick: async () => {
          try { await navigator.clipboard.writeText(url); toast("Copied."); }
          catch { input.select(); }
        },
      }, "Copy"))));
  back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
  document.body.append(back);
  input.select();
}

/* --------------------------------------------------------------- activity */

function activityTab() {
  const rows = (DATA.audit || []).map((a) =>
    el("tr", {},
      el("td", { class: "nowrap" }, new Date(a.at).toLocaleString()),
      el("td", {}, a.userEmail),
      el("td", {}, a.action),
      el("td", {}, a.entity + (a.entityId ? ` (${a.entityId})` : "")),
    ));
  return el("div", {},
    header("Recent activity", "The last 30 changes, and who made them."),
    rows.length ? table(["When", "Who", "Action", "What"], rows)
                : el("p", { class: "muted" }, "No changes recorded yet."),
  );
}

/* --------------------------------------------------------------- fragments */

function header(title, sub, action) {
  return el("div", { class: "secthead" },
    el("div", {}, el("h2", {}, title), sub ? el("p", { class: "muted" }, sub) : null),
    action || null);
}

function table(cols, rows) {
  return el("div", { class: "tbl-scroll" },
    el("table", {},
      el("thead", {}, el("tr", {}, ...cols.map((c) =>
        el("th", { class: c === "" || c.includes("(Rs.)") ? "num" : "" }, c)))),
      el("tbody", {}, ...(rows.length ? rows
        : [el("tr", {}, el("td", { colspan: String(cols.length), class: "muted" }, "Nothing here yet."))]))));
}

function modal(title, content, onSave) {
  const save = el("button", { class: "btn primary", type: "submit" }, "Save");
  const back = el("div", { class: "backdrop" });
  const close = () => back.remove();

  const form = el("form", {
    class: "modal",
    onSubmit: async (e) => {
      e.preventDefault();
      save.disabled = true; save.textContent = "Saving…";
      const ok = await onSave();
      if (ok !== false) close();
      else { save.disabled = false; save.textContent = "Save"; }
    },
  },
    el("h3", {}, title),
    content,
    el("div", { class: "actions" },
      el("button", { class: "btn", type: "button", onClick: close }, "Cancel"), save));

  back.append(form);
  back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
  });
  document.body.append(back);
  form.querySelector("input,select,textarea")?.focus();
}

function confirmDelete(message, run) {
  const back = el("div", { class: "backdrop" });
  const close = () => back.remove();
  back.append(el("div", { class: "modal" },
    el("h3", {}, "Are you sure?"),
    el("p", { class: "muted" }, message + " This cannot be undone."),
    el("div", { class: "actions" },
      el("button", { class: "btn", onClick: close }, "Cancel"),
      el("button", {
        class: "btn danger",
        onClick: async () => { close(); await run(); },
      }, "Delete"))));
  back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
  document.body.append(back);
}

/* ------------------------------------------------------------------- init */

$("#signout").addEventListener("click", async () => {
  try { await api("/api/auth/logout", "POST"); } catch { /* already gone */ }
  location.href = "/editor";
});

/* The Excel export is an authenticated download, so it is fetched with the
   session rather than opened as a bare link — a plain <a> to a 401 would show
   the browser's error page instead of a useful message. */
$("#dl-xlsx").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Preparing…";
  try {
    const res = await fetch("/api/export/xlsx");
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Export failed.");
    const blob = await res.blob();
    const name = (res.headers.get("content-disposition") || "").match(/filename="([^"]+)"/)?.[1]
      || "prime-aurora-fund.xlsx";
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast("Workbook downloaded.");
  } catch (err) {
    toast(err.message, "err");
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
});

$("#dl-pdf").addEventListener("click", () => window.print());

// Brand mark in the header, and the shared brand colour variables.
document.head.append(el("style", {}, BRAND_CSS));
$("#brand").innerHTML = brandSvg("full", 112);

boot().catch((err) => showError(err.message));
