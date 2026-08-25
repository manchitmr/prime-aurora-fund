import {
  login, logout, handleAuthCallback, acceptInvite, hydrateSession,
  requestPasswordRecovery, updateUser, oauthLogin, getSettings, AuthError,
} from "@netlify/identity";
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
  // Must run before anything else: invite, recovery and confirmation links all
  // arrive as a URL hash on this page.
  try {
    const result = await handleAuthCallback();
    if (result?.type === "invite") return showInvite(result.token);
    if (result?.type === "recovery") return showNewPassword();
  } catch (err) {
    if (err instanceof AuthError) toast(err.message, "err");
  }

  /* Restore the session before asking the server who we are.
     The nf_jwt cookie is short lived, so navigating away and back — for
     instance to look at the public dashboard — could return to a page whose
     cookie had lapsed even though the refresh token was still held locally.
     The server then saw no cookie and reported us signed out, which read as
     "clicking that link logs me out". Hydrating first swaps the stored refresh
     token for a fresh cookie, so a live session survives the round trip. */
  try { await hydrateSession(); } catch { /* genuinely signed out */ }

  let me = null;
  try { me = await api("/api/auth/me"); } catch { /* offline */ }

  if (me?.identityUnavailable) return showSetupNeeded();
  if (!me?.signedIn) return showLogin();
  if (!me.canEdit) return showNoAccess(me.email);

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

function showSetupNeeded() {
  screen(card("Identity is not enabled yet",
    el("p", { class: "muted" },
      "This site's Netlify Identity instance has not been turned on, so nobody can sign in yet. " +
      "A site owner needs to enable it in the Netlify dashboard under Project configuration → Identity, " +
      "then invite the committee members."),
  ));
}

function showNoAccess(email) {
  $("#who").textContent = email;
  $("#signout").hidden = false;
  screen(card("No edit access",
    el("p", { class: "muted" },
      `You are signed in as ${email}, but your account does not have the "editor" role, ` +
      "so you cannot change any figures. Ask a site owner to grant it in the Netlify dashboard " +
      "under Identity → your user → Edit roles."),
  ));
}

function showError(msg) {
  screen(card("Something went wrong", el("p", { class: "muted" }, msg)));
}

/**
 * Sign-in with whatever providers the Identity instance actually has enabled.
 *
 * Netlify Identity has no built-in second factor. Signing in through a provider
 * that does — Google, GitHub — is the only way to get 2FA in front of this app
 * without replacing Identity, so those buttons appear whenever the provider is
 * switched on in the dashboard, and are silently absent when it is not.
 */
async function oauthButtons() {
  let settings;
  try { settings = await getSettings(); } catch { return null; }

  const enabled = Object.entries(settings?.external || {})
    .filter(([name, on]) => on && name !== "email" && name !== "saml")
    .map(([name]) => name);
  if (!enabled.length) return null;

  const nice = { google: "Google", github: "GitHub", gitlab: "GitLab", bitbucket: "Bitbucket" };
  return el("div", { class: "stack" },
    el("div", { class: "or" }, "or"),
    ...enabled.map((p) =>
      el("button", {
        class: "btn wide", type: "button",
        onClick: () => { try { oauthLogin(p); } catch (e) { toast(e.message, "err"); } },
      }, "Continue with " + (nice[p] || p))),
    el("p", { class: "muted small" },
      "Signing in through a provider also brings that account's two-step verification with it."),
  );
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
        await login(email.value.trim(), pass.value);
        location.hash = "";
        await boot();
      } catch (err) {
        toast(err instanceof AuthError && err.status === 400
          ? "That email and password combination was not recognised."
          : err.message, "err");
        btn.disabled = false; btn.textContent = "Sign in";
      }
    },
  },
    el("label", {}, "Email", email),
    el("label", {}, "Password", pass),
    btn,
    el("button", {
      class: "linkbtn", type: "button",
      onClick: async () => {
        const addr = email.value.trim();
        if (!addr) return toast("Enter your email address first.", "err");
        try {
          await requestPasswordRecovery(addr);
          toast("If that address has an account, a reset link is on its way.");
        } catch (err) { toast(err.message, "err"); }
      },
    }, "Forgot your password?"),
  );

  const cardEl = card("Committee sign-in",
    el("p", { class: "muted" },
      "Editing is limited to invited committee members. The public dashboard stays readable by everyone."),
    form);
  cardEl.prepend(el("div", { class: "brand brand-stack loginmark", html: brandSvg("full", 74) }));
  screen(cardEl);

  // Appended once resolved so a slow settings call never delays the password form.
  oauthButtons().then((node) => { if (node) form.after(node); });
}

function showInvite(token) {
  const pass = el("input", { type: "password", required: true, minlength: "8", autocomplete: "new-password" });
  const form = el("form", {
    class: "stack",
    onSubmit: async (e) => {
      e.preventDefault();
      try {
        await acceptInvite(token, pass.value);
        toast("Welcome. Your account is ready.");
        location.hash = "";
        await boot();
      } catch (err) { toast(err.message, "err"); }
    },
  }, el("label", {}, "Choose a password (at least 8 characters)", pass),
     el("button", { class: "btn primary", type: "submit" }, "Accept invitation"));

  screen(card("Accept your invitation", form));
}

function showNewPassword() {
  const pass = el("input", { type: "password", required: true, minlength: "8", autocomplete: "new-password" });
  const form = el("form", {
    class: "stack",
    onSubmit: async (e) => {
      e.preventDefault();
      try {
        await updateUser({ password: pass.value });
        toast("Password updated.");
        location.hash = "";
        await boot();
      } catch (err) { toast(err.message, "err"); }
    },
  }, el("label", {}, "New password (at least 8 characters)", pass),
     el("button", { class: "btn primary", type: "submit" }, "Set password"));

  screen(card("Set a new password", form));
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
        el("td", { class: "num nowrap" },
          el("button", { class: "linkbtn", onClick: () => showPlotForm(p) }, "Edit"),
          " ",
          el("button", {
            class: "linkbtn danger",
            onClick: () => confirmDelete(
              `Remove plot ${p.house}${p.owner ? " (" + p.owner + ")" : ""} from the register?`,
              () => mutate(`/api/edit/plots/${encodeURIComponent(p.house)}`, "DELETE",
                null, `Plot ${p.house} removed.`)),
          }, "Remove")))));
  };
  filter.addEventListener("input", draw);
  draw();

  return el("div", {},
    header("Plots and household names",
      "Names are visible only here, to signed-in committee members. The public dashboard shows plot numbers only.",
      el("button", { class: "btn primary", onClick: () => showPlotForm(null) }, "Add plot")),
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
  const isNew = !p;
  const house = el("input", {
    type: "text", maxlength: "20", required: true,
    value: p ? p.house : "", placeholder: isNew ? "e.g. 132 or 7A" : "",
  });
  const owner = el("input", { type: "text", maxlength: "200", value: p?.owner || "" });
  const status = el("select", {}, ...STATUSES.map((v) =>
    el("option", { value: v, selected: p ? p.status === v : v === "Occupied" }, v)));
  const bf = el("input", { type: "number", step: "0.01", value: p?.bf ?? "" });

  /* Renumbering rewrites the primary key and drags the collections along with
     it, which is not obvious from a text field — so say so, but only once the
     number has actually been changed. */
  const warn = el("p", { class: "warn wide", hidden: true },
    "Renumbering moves this plot's entire payment history with it.");
  if (!isNew) {
    house.addEventListener("input", () => {
      warn.hidden = house.value.trim() === p.house;
    });
  }

  modal(isNew ? "Add a plot" : `Plot ${p.house}`,
    el("div", { class: "grid2" },
      el("label", {}, "Plot number", house),
      el("label", {}, "Status", status),
      warn,
      el("label", { class: "wide" }, "Household name", owner),
      el("label", {}, "2025 balance brought forward", bf),
      el("p", { class: "muted small wide" },
        "Only plots marked Occupied are counted as owing the monthly fee. " +
        "Household names stay on this page and never reach the public dashboard."),
    ),
    () => {
      const body = {
        house: house.value.trim(), owner: owner.value || null,
        status: status.value, bf: bf.value || null,
      };
      if (isNew) return mutate("/api/edit/plots", "POST", body, `Plot ${body.house} added.`);
      return mutate(`/api/edit/plots/${encodeURIComponent(p.house)}`, "PUT", body,
        body.house === p.house ? "Plot updated." : `Plot renumbered to ${body.house}.`);
    });
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
  try { await logout(); } catch { /* already gone */ }
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
