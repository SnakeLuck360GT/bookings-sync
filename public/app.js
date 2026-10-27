const app = document.getElementById("app");

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DEFAULT_PREFS = { from: 9 * 60, to: 18 * 60, min: 30 };
const NO_ROOM = "Room not listed";

/* ---------- Dates, always in UK time ---------- */

const londonFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function londonNow() {
  const p = {};
  for (const { type, value } of londonFormat.formatToParts(new Date())) p[type] = value;
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const weekday = (day) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
const mondayOf = (day) => addDays(day, -weekday(day));
const dayOfMonth = (day) => Number(day.slice(8));
const monthOf = (day) => MONTHS[Number(day.slice(5, 7)) - 1];

function time(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  return `${h}:${String(minutes % 60).padStart(2, "0")}`;
}

function duration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function weekRange(monday) {
  const friday = addDays(monday, 4);
  return monthOf(monday) === monthOf(friday)
    ? `${dayOfMonth(monday)}–${dayOfMonth(friday)} ${monthOf(friday)}`
    : `${dayOfMonth(monday)} ${monthOf(monday)} – ${dayOfMonth(friday)} ${monthOf(friday)}`;
}

/* ---------- Rooms ---------- */

/** Total time covered by a set of intervals, not double-counting overlaps. */
function covered(events) {
  const spans = events.map((e) => [e.start, e.end]).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cursor = -1;
  for (const [s, e] of spans) {
    if (e <= cursor) continue;
    total += e - Math.max(s, cursor);
    cursor = e;
  }
  return total;
}

/** Stretches of [from, to) that no booking covers, at least `min` long. */
function uncovered(events, from, to, min) {
  const spans = events
    .map((e) => [Math.max(e.start, from), Math.min(e.end, to)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let cursor = from;
  for (const [s, e] of spans) {
    if (s > cursor) gaps.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (to > cursor) gaps.push([cursor, to]);
  return gaps.filter(([s, e]) => e - s >= min);
}

/** Bookings for a day grouped by room, in order of first booking. */
function roomsFor(members, day) {
  const rooms = new Map();
  for (const member of members) {
    for (const event of member.events) {
      if (event.day !== day) continue;
      const name = event.location || NO_ROOM;
      if (!rooms.has(name)) rooms.set(name, []);
      rooms.get(name).push({ member, event });
    }
  }
  return [...rooms]
    .map(([name, bookings]) => {
      bookings.sort((a, b) => a.event.start - b.event.start);
      const { room, building } = bookings[0].event;
      return { name, room: room || name, building, bookings, total: covered(bookings.map((b) => b.event)) };
    })
    .sort((a, b) => a.bookings[0].event.start - b.bookings[0].event.start || a.name.localeCompare(b.name));
}

/* ---------- Storage and network ---------- */

const saved = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem(`bookings:${key}`);
      return value == null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(`bookings:${key}`);
      else localStorage.setItem(`bookings:${key}`, JSON.stringify(value));
    } catch {}
  },
};

async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("You seem to be offline. Try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || "Something went wrong. Try again.");
    error.status = res.status;
    throw error;
  }
  return data;
}

/* ---------- DOM helpers ---------- */

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else if (key === "style") el.style.cssText = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child != null && child !== false) el.append(child);
  }
  return el;
}

const icons = {
  prev: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12.5 4.5 7 10l5.5 5.5"/></svg>',
  next: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 4.5 13 10l-5.5 5.5"/></svg>',
  close: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m5 5 10 10M15 5 5 15"/></svg>',
};

function iconButton(name, label, onclick) {
  const button = h("button", { class: "icon-button", type: "button", "aria-label": label, onclick });
  button.innerHTML = icons[name];
  return button;
}

let toastTimer;
function toast(message) {
  document.querySelector(".toast")?.remove();
  clearTimeout(toastTimer);
  const el = h("div", { class: "toast", role: "status" }, message);
  document.body.append(el);
  toastTimer = setTimeout(() => el.remove(), 2200);
}

function openSheet(title, ...content) {
  const dialog = h(
    "dialog",
    { class: "sheet", "aria-label": title },
    h("div", { class: "sheet-head" }, h("h2", {}, title), iconButton("close", "Close", () => dialog.close())),
    ...content,
  );
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

let fieldCount = 0;

/* ---------- Shared form parts ---------- */

/** Remember who you are in a group on this device, and list it on the home page. */
function remember(code, memberId, name) {
  saved.set(`me:${code}`, memberId);
  saved.set("name", name.trim());
  const groups = saved.get("groups", []).filter((g) => g.code !== code);
  saved.set("groups", [{ code, name: name.trim() }, ...groups].slice(0, 5));
}

function forget(code) {
  saved.set(`me:${code}`, null);
  saved.set(
    "groups",
    saved.get("groups", []).filter((g) => g.code !== code),
  );
}

function nameInput() {
  const input = h("input", {
    name: "name",
    autocomplete: "given-name",
    autocapitalize: "words",
    maxlength: 24,
    enterkeyhint: "next",
  });
  input.value = saved.get("name", "");
  input.id = `field-${++fieldCount}`;
  return input;
}

function linkInput() {
  const input = h("input", {
    name: "url",
    type: "text",
    inputmode: "url",
    autocomplete: "off",
    autocapitalize: "off",
    autocorrect: "off",
    spellcheck: "false",
    placeholder: "https://…/timetable.ics",
    enterkeyhint: "go",
  });
  input.id = `field-${++fieldCount}`;

  const wrap = h("div", { class: "input-wrap" }, input);
  if (navigator.clipboard?.readText) {
    input.classList.add("has-action");
    wrap.append(
      h(
        "button",
        {
          class: "input-action",
          type: "button",
          onclick: async () => {
            try {
              input.value = (await navigator.clipboard.readText()).trim();
            } catch {
              input.focus();
            }
          },
        },
        "Paste",
      ),
    );
  }

  const help = h(
    "details",
    { class: "help" },
    h("summary", {}, "Where do I find this?"),
    h(
      "p",
      {},
      "In My Manchester, open your timetable and look for the option to subscribe or sync it to a calendar. Copy the iCal link it gives you. It usually ends in ",
      h("code", {}, ".ics"),
      ".",
    ),
    h("p", {}, "Rooms you book through the university show up in it automatically. Friends only see your bookings, not your classes."),
  );

  return { input, field: h("div", { class: "field" }, h("label", { for: input.id }, "Timetable link"), wrap, help) };
}

/** Wire up a form whose submit button shows progress and whose errors appear above it. */
function form({ submitLabel, busyLabel, onSubmit }, ...fields) {
  const error = h("p", { class: "error", role: "alert" });
  const submit = h("button", { class: "button primary", type: "submit" }, submitLabel);
  const el = h(
    "form",
    {
      class: "form",
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        error.textContent = "";
        submit.disabled = true;
        submit.textContent = busyLabel;
        try {
          await onSubmit();
        } catch (err) {
          error.textContent = err.message;
        }
        submit.disabled = false;
        submit.textContent = el.dataset.label || submitLabel;
      },
    },
    ...fields,
    error,
    submit,
  );
  el.setLabel = (label) => {
    el.dataset.label = label;
    submit.textContent = label;
  };
  return el;
}

/** Throw a friendly error if an input is empty, focusing it first. */
function required(input, message) {
  if (input.value.trim()) return input.value;
  input.focus();
  throw new Error(message);
}

/** Name and timetable link, for creating a group or joining one from its page. */
function memberForm({ submitLabel, onSubmit }) {
  const name = nameInput();
  const link = linkInput();
  return form(
    {
      submitLabel,
      busyLabel: "Checking your timetable…",
      onSubmit: () =>
        onSubmit({ name: required(name, "Add your name."), url: required(link.input, "Paste your timetable link.") }),
    },
    h("div", { class: "field" }, h("label", { for: name.id }, "Your name"), name),
    link.field,
  );
}

/**
 * Name and group code. A name already in the group signs you in as them;
 * a new name asks for a timetable link and joins.
 */
function joinForm() {
  const name = nameInput();
  const code = h("input", {
    name: "code",
    class: "code-input",
    autocomplete: "off",
    autocapitalize: "characters",
    autocorrect: "off",
    spellcheck: "false",
    maxlength: 6,
    placeholder: "K7M2QX",
    enterkeyhint: "go",
  });
  code.id = `field-${++fieldCount}`;
  const link = linkInput();
  const newcomer = h(
    "div",
    { class: "form", hidden: true },
    h("p", { class: "field-note" }, "You're new to this group. Add your timetable link to join."),
    link.field,
  );
  let group = null;

  const el = form(
    {
      submitLabel: "Join",
      busyLabel: "Joining…",
      onSubmit: async () => {
        const who = required(name, "Add your name.").trim();
        const value = required(code, "Enter your group code.").trim().toUpperCase();
        if (group?.id !== value) {
          group = await api(`/groups/${encodeURIComponent(value)}`);
          newcomer.hidden = true;
          el.setLabel("Join");
        }

        const match = group.members.find((m) => m.name.toLowerCase() === who.toLowerCase());
        if (match) {
          remember(group.id, match.id, match.name);
          return location.assign(`/g/${group.id}`);
        }
        if (newcomer.hidden) {
          newcomer.hidden = false;
          el.setLabel("Join group");
          link.input.focus();
          return;
        }
        const body = { name: who, url: required(link.input, "Paste your timetable link.") };
        const { me } = await api(`/groups/${group.id}/members`, { method: "POST", body });
        remember(group.id, me, who);
        location.assign(`/g/${group.id}`);
      },
    },
    h("div", { class: "field" }, h("label", { for: name.id }, "Your name"), name),
    h("div", { class: "field" }, h("label", { for: code.id }, "Group code"), code),
    newcomer,
  );
  code.addEventListener("input", () => {
    code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });
  return el;
}

/* ---------- Home ---------- */

function renderHome() {
  document.title = "Bookings";
  let mode = "join";
  const panel = h("div");
  const tabs = h("div", { class: "segmented", role: "group", "aria-label": "Join or create" });

  function show() {
    tabs.replaceChildren(
      ...[
        ["join", "Join a group"],
        ["create", "Create a group"],
      ].map(([value, label]) =>
        h(
          "button",
          { type: "button", "aria-pressed": String(mode === value), onclick: () => ((mode = value), show()) },
          label,
        ),
      ),
    );
    panel.replaceChildren(
      mode === "join"
        ? joinForm()
        : memberForm({
            submitLabel: "Create group",
            onSubmit: async (body) => {
              const { group, me } = await api("/groups", { method: "POST", body });
              remember(group.id, me, body.name);
              location.assign(`/g/${group.id}`);
            },
          }),
    );
  }
  show();

  const groups = saved.get("groups", []);
  app.replaceChildren(
    h(
      "main",
      { class: "page home" },
      h("header", { class: "bar" }, h("a", { class: "wordmark", href: "/" }, "Bookings")),
      h("h1", {}, "See which rooms you've booked."),
      h(
        "p",
        { class: "lede" },
        "Share your University of Manchester room bookings with your group: who booked what, for how long, and the gaps still to book.",
      ),
      groups.length > 0 &&
        h(
          "section",
          { class: "block" },
          h("div", { class: "section-head" }, h("h2", {}, "Your groups")),
          h(
            "ul",
            { class: "slots" },
            groups.map((g) =>
              h(
                "li",
                {},
                h(
                  "a",
                  { class: "slot group-link", href: `/g/${g.code}` },
                  h("span", { class: "slot-time tabular" }, g.code),
                  h("span", { class: "slot-meta" }, `as ${g.name}`),
                ),
              ),
            ),
          ),
        ),
      tabs,
      panel,
      h("p", { class: "note" }, "Your link stays private. Friends see your room bookings, never your classes or the link itself."),
    ),
  );
}

/* ---------- Group ---------- */

function startGroup(id) {
  const today = londonNow().day;

  const state = {
    id,
    group: null,
    missing: false,
    me: saved.get(`me:${id}`, null),
    hidden: new Set(saved.get(`hidden:${id}`, [])),
    prefs: { ...DEFAULT_PREFS, ...saved.get("prefs", {}) },
    week: mondayOf(today),
    day: today,
    weeks: new Map(),
    editing: false,
  };

  const self = () => state.group?.members.find((m) => m.id === state.me);

  function loadWeek(start) {
    const existing = state.weeks.get(start);
    if (existing && !existing.error) return;
    const entry = { loading: true };
    state.weeks.set(start, entry);
    api(`/groups/${id}/week?start=${start}`)
      .then((data) => Object.assign(entry, { loading: false, data }))
      .catch((err) => Object.assign(entry, { loading: false, error: err.message }))
      .finally(() => {
        if (start === state.week) {
          render();
          if (!entry.error) loadWeek(addDays(start, 7));
        }
      });
  }

  function reloadAll() {
    state.weeks.clear();
    loadWeek(state.week);
  }

  async function loadGroup() {
    try {
      state.group = await api(`/groups/${id}`);
      if (state.me && !self()) {
        state.me = null;
        saved.set(`me:${id}`, null);
      }
    } catch (err) {
      if (err.status === 404) state.missing = true;
      else toast(err.message);
    }
    render();
  }

  function goToDay(day) {
    state.day = day;
    const monday = mondayOf(day);
    if (monday !== state.week) {
      state.week = monday;
      loadWeek(monday);
    }
    render();
  }

  function stepDay(direction) {
    const days = visibleDays();
    const next = days[days.indexOf(state.day) + direction];
    if (next) return goToDay(next);
    goToDay(direction > 0 ? addDays(state.week, 7) : addDays(state.week, -3));
  }

  function stepWeek(direction) {
    goToDay(addDays(state.week, 7 * direction + Math.min(weekday(state.day), 4)));
  }

  function visibleDays() {
    const data = state.weeks.get(state.week)?.data;
    const days = [0, 1, 2, 3, 4].map((i) => addDays(state.week, i));
    for (const i of [5, 6]) {
      const day = addDays(state.week, i);
      const used = data?.members.some((m) => m.events.some((e) => e.day === day));
      if (used || day === state.day) days.push(day);
    }
    return days;
  }

  const included = (members) => members.filter((m) => !state.hidden.has(m.id));

  /* --- actions --- */

  async function share() {
    const url = `${location.origin}/g/${id}`;
    const text = `Join our room bookings with code ${id}`;
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ title: "Bookings", text, url });
      } catch {}
      return;
    }
    try {
      await navigator.clipboard.writeText(id);
      toast(`Code ${id} copied`);
    } catch {
      prompt("Group code", id);
    }
  }

  function openAdd() {
    const sheet = openSheet(
      "Add your timetable",
      memberForm({
        submitLabel: "Add timetable",
        onSubmit: async (body) => {
          const { group, me } = await api(`/groups/${id}/members`, { method: "POST", body });
          state.group = group;
          state.me = me;
          remember(id, me, body.name);
          sheet.close();
          toast("You're in");
          reloadAll();
          render();
        },
      }),
    );
  }

  function toggle(member) {
    if (state.hidden.has(member.id)) state.hidden.delete(member.id);
    else state.hidden.add(member.id);
    saved.set(`hidden:${id}`, [...state.hidden]);
    render();
  }

  async function remove(member) {
    const label = member.id === state.me ? "Remove your timetable from this group?" : `Remove ${member.name} from this group?`;
    if (!confirm(label)) return;
    try {
      state.group = await api(`/groups/${id}/members/${member.id}`, { method: "DELETE" });
      if (member.id === state.me) {
        state.me = null;
        forget(id);
      }
      if (state.group.members.length === 0) state.editing = false;
      reloadAll();
      render();
    } catch (err) {
      toast(err.message);
    }
  }

  function openPrefs() {
    const hours = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => (from + i) * 60);
    const select = (label, key, options, format, wide) =>
      h(
        "label",
        { class: wide ? "select wide" : "select" },
        label,
        h(
          "select",
          {
            onchange: (e) => {
              state.prefs[key] = Number(e.target.value);
              saved.set("prefs", state.prefs);
              render();
            },
          },
          options.map((value) => h("option", { value, selected: value === state.prefs[key] }, format(value))),
        ),
      );

    openSheet(
      "Gap settings",
      h(
        "div",
        { class: "selects" },
        select("From", "from", hours(6, 13), time),
        select("Until", "to", hours(14, 23), time),
        select("Shortest gap", "min", [15, 30, 45, 60, 90, 120], (m) => `${duration(m)} or longer`, true),
      ),
    );
  }

  function openBooking(member, event) {
    const row = (label, ...value) => h("div", { class: "row" }, h("span", { class: "row-label" }, label), ...value);
    const directions =
      event.building &&
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${event.building} building, University of Manchester`)}`;
    openSheet(
      event.room || event.location || NO_ROOM,
      h(
        "div",
        { class: "rows" },
        row("Booked by", h("span", { class: "dot", style: `--c: var(--m${member.colour})` }), member.name),
        row(
          "When",
          h(
            "span",
            { class: "tabular" },
            `${DAY_NAMES[weekday(event.day)]} ${dayOfMonth(event.day)} ${monthOf(event.day)}, ${time(event.start)}–${time(event.end)} (${duration(event.end - event.start)})`,
          ),
        ),
        event.building &&
          row("Where", h("a", { class: "link", href: directions, target: "_blank", rel: "noopener" }, event.building)),
        event.title && row("Name", event.title),
        event.reference && row("Ref", h("span", { class: "tabular" }, event.reference)),
        event.pending && row("Status", "Pending"),
      ),
    );
  }

  /* --- views --- */

  function header() {
    return h(
      "header",
      { class: "bar" },
      h("a", { class: "wordmark", href: "/" }, "Bookings"),
      h(
        "button",
        { class: "button code-button", type: "button", onclick: share, "aria-label": `Group code ${id}. Share` },
        h("span", { class: "code-label" }, "Code"),
        h("span", { class: "tabular" }, id),
      ),
    );
  }

  function signIn(member) {
    state.me = member.id;
    remember(id, member.id, member.name);
    render();
  }

  function signOut() {
    state.me = null;
    saved.set(`me:${id}`, null);
    render();
  }

  function callout() {
    if (self()) return null;
    const members = state.group.members;
    return h(
      "div",
      { class: "callout" },
      h("p", {}, members.length ? "Who are you?" : "Add your timetable to get started."),
      members.length > 0 &&
        h(
          "div",
          { class: "people" },
          members.map((m) =>
            h(
              "button",
              { class: "chip", type: "button", style: `--c: var(--m${m.colour})`, onclick: () => signIn(m) },
              h("span", { class: "dot" }),
              h("span", { class: "chip-name" }, m.name),
            ),
          ),
        ),
      h("button", { class: "button primary", type: "button", onclick: openAdd }, members.length ? "I'm new here" : "Add my timetable"),
    );
  }

  function footer() {
    const me = self();
    if (!me) return null;
    return h(
      "p",
      { class: "footer" },
      `You're ${me.name}. `,
      h("button", { class: "link", type: "button", onclick: signOut }, "Switch"),
    );
  }

  function people(data) {
    const errors = new Set(data?.members.filter((m) => m.error).map((m) => m.id));
    const chips = state.group.members.map((member) => {
      const off = state.hidden.has(member.id);
      const classes = ["chip", off && !state.editing && "off", errors.has(member.id) && "warn", state.editing && "removing"];
      return h(
        "button",
        {
          class: classes.filter(Boolean).join(" "),
          type: "button",
          style: `--c: var(--m${member.colour})`,
          "aria-pressed": state.editing ? null : String(!off),
          "aria-label": state.editing ? `Remove ${member.name}` : null,
          onclick: () => (state.editing ? remove(member) : toggle(member)),
        },
        h("span", { class: "dot" }),
        h("span", { class: "chip-name" }, member.name),
        state.editing && h("span", { "aria-hidden": "true" }, "×"),
      );
    });

    const controls = state.editing
      ? [h("button", { class: "chip quiet", type: "button", onclick: () => ((state.editing = false), render()) }, "Done")]
      : [
          self() && h("button", { class: "chip", type: "button", onclick: openAdd }, "+ Add"),
          state.group.members.length > 0 &&
            h("button", { class: "chip quiet", type: "button", onclick: () => ((state.editing = true), render()) }, "Edit"),
        ];

    return h("div", { class: "people" }, chips, controls);
  }

  function weekNav() {
    const thisWeek = mondayOf(londonNow().day);
    const offset = Math.round((Date.parse(state.week) - Date.parse(thisWeek)) / (7 * 864e5));
    const label = { 0: "This week", 1: "Next week", [-1]: "Last week" }[offset] ?? `Week of ${dayOfMonth(state.week)} ${monthOf(state.week)}`;
    return h(
      "nav",
      { class: "week", "aria-label": "Week" },
      iconButton("prev", "Previous week", () => stepWeek(-1)),
      h("div", { class: "week-label" }, h("strong", {}, label), h("span", { class: "tabular" }, weekRange(state.week))),
      iconButton("next", "Next week", () => stepWeek(1)),
    );
  }

  function dayTabs(data) {
    const today = londonNow().day;
    return h(
      "div",
      { class: "days", role: "group", "aria-label": "Day" },
      visibleDays().map((day) => {
        const total = data ? roomsFor(included(data.members), day).reduce((sum, room) => sum + room.total, 0) : null;
        return h(
          "button",
          {
            class: day === today ? "day today" : "day",
            type: "button",
            "aria-pressed": String(day === state.day),
            onclick: () => goToDay(day),
          },
          h("span", { class: "day-name" }, DAY_NAMES[weekday(day)]),
          h("span", { class: "day-num tabular" }, dayOfMonth(day)),
          h("span", { class: "day-free tabular" }, total == null ? "" : total ? duration(total) : "–"),
        );
      }),
    );
  }

  function status(bookings, now) {
    const past = state.day < now.day;
    let label;
    let booking;
    if (state.day === now.day) {
      booking = bookings.find(({ event }) => event.start <= now.minutes && now.minutes < event.end);
      if (booking) label = "Room booked now";
      else if ((booking = bookings.find(({ event }) => event.start > now.minutes))) label = "Next room";
    } else if (bookings.length) {
      booking = bookings[0];
      label = bookings.length > 1 ? "First room" : "Room booked";
    }

    if (!booking) {
      const text = bookings.length ? "No more rooms today" : past ? "No room was booked" : "No room booked yet";
      return h("div", { class: "status" }, h("span", { class: "status-room" }, text));
    }

    const { member, event } = booking;
    const when = label === "Room booked now" ? `until ${time(event.end)}` : `${time(event.start)} – ${time(event.end)}`;
    return h(
      "button",
      { class: "status", type: "button", onclick: () => openBooking(member, event) },
      h("span", { class: "status-label" }, label, event.pending && " · pending"),
      h("span", { class: "status-room" }, event.room || event.location || NO_ROOM),
      h("span", { class: "status-meta tabular" }, [event.building, when].filter(Boolean).join(" · ")),
      h("span", { class: "booked-by", style: `--c: var(--m${member.colour})` }, h("span", { class: "dot" }), `Booked by ${member.name}`),
    );
  }

  /** Each person gets one booking a day, so say who still has theirs. */
  function stillToBook(members, bookings) {
    const booked = new Set(bookings.map((b) => b.member.id));
    const free = members.filter((m) => !booked.has(m.id));
    if (!free.length) return h("p", { class: "hint" }, "Everyone has used their booking for this day.");
    return h(
      "div",
      { class: "can-book" },
      h("span", { class: "can-book-label" }, "Booking left"),
      free.map((m) => h("span", { class: "booked-by", style: `--c: var(--m${m.colour})` }, h("span", { class: "dot" }), m.name)),
    );
  }

  function gaps(bookings, now, members) {
    if (state.day < now.day) return null;
    const { from, to, min } = state.prefs;
    const isToday = state.day === now.day;
    const open = uncovered(
      bookings.map((b) => b.event),
      from,
      to,
      min,
    ).filter(([, e]) => !isToday || e > now.minutes);

    return h(
      "section",
      { class: "block" },
      h(
        "div",
        { class: "section-head" },
        h("h2", {}, "Gaps to book"),
        h("button", { class: "link tabular", type: "button", onclick: openPrefs }, `${time(from)}–${time(to)} · ${duration(min)}+`),
      ),
      open.length
        ? h(
            "ul",
            { class: "slots" },
            open.map(([s, e]) => {
              const current = isToday && s <= now.minutes;
              return h(
                "li",
                { class: current ? "slot now" : "slot" },
                h("span", { class: "slot-time tabular" }, `${time(s)} – ${time(e)}`),
                h("span", { class: "slot-meta tabular" }, current ? `Now · ${duration(e - now.minutes)} left` : duration(e - s)),
              );
            }),
          )
        : h("p", { class: "empty" }, isToday && bookings.length ? "Nothing left to book today." : `Booked from ${time(from)} to ${time(to)}.`),
      stillToBook(members, bookings),
    );
  }

  function roomsSection(rooms, now) {
    if (!rooms.length) return null;
    return h(
      "section",
      { class: "block" },
      h("div", { class: "section-head" }, h("h2", {}, rooms.length === 1 ? "Booked room" : "Booked rooms")),
      rooms.map((room) =>
        h(
          "div",
          { class: "room" },
          h(
            "div",
            { class: "room-head" },
            h("h3", {}, room.room, room.building && h("span", { class: "room-building" }, room.building)),
            h("span", { class: "room-total tabular" }, duration(room.total)),
          ),
          h(
            "ul",
            { class: "bookings" },
            room.bookings.map(({ member, event }) => {
              const past = state.day < now.day || (state.day === now.day && event.end <= now.minutes);
              const current = state.day === now.day && event.start <= now.minutes && now.minutes < event.end;
              return h(
                "li",
                {},
                h(
                  "button",
                  {
                    class: ["booking", past && "past", current && "now"].filter(Boolean).join(" "),
                    type: "button",
                    onclick: () => openBooking(member, event),
                  },
                  h("span", { class: "booking-who", style: `--c: var(--m${member.colour})` }, h("span", { class: "dot" }), member.name),
                  h("span", { class: "booking-time tabular" }, `${time(event.start)} – ${time(event.end)}`),
                  h("span", { class: "booking-len tabular" }, current ? "Now" : duration(event.end - event.start)),
                ),
              );
            }),
          ),
        ),
      ),
    );
  }

  function dayView(entry) {
    if (!included(state.group.members).length) return h("p", { class: "empty" }, "Tap a name above to include them.");
    if (!entry || entry.loading) return h("p", { class: "loading" }, "Loading bookings…");
    if (entry.error) {
      return h("p", { class: "empty" }, entry.error, " ", h("button", { class: "link", type: "button", onclick: reloadAll }, "Retry"));
    }

    const now = londonNow();
    const members = included(entry.data.members);
    const rooms = roomsFor(members, state.day);
    const bookings = rooms.flatMap((room) => room.bookings).sort((a, b) => a.event.start - b.event.start);
    const failed = members.filter((m) => m.error);

    return h(
      "div",
      {},
      status(bookings, now),
      gaps(bookings, now, members),
      roomsSection(rooms, now),
      failed.length > 0 &&
        h(
          "p",
          { class: "hint" },
          `Couldn't load ${failed.map((m) => m.name).join(" and ")}'s timetable right now, so some bookings may be missing.`,
        ),
    );
  }

  function timeline(data) {
    const rooms = roomsFor(included(data.members), state.day);
    if (!rooms.length) return null;

    let first = Math.floor(state.prefs.from / 60);
    let last = Math.ceil(state.prefs.to / 60);
    for (const room of rooms) {
      for (const { event } of room.bookings) {
        first = Math.min(first, Math.floor(event.start / 60));
        last = Math.max(last, Math.ceil(event.end / 60));
      }
    }

    const hourPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hour")) || 52;
    const y = (minutes) => ((minutes - first * 60) / 60) * hourPx;
    const now = londonNow();

    const hours = [];
    for (let hr = first; hr <= last; hr++) {
      hours.push(h("div", { class: "tl-hour", style: `top:${y(hr * 60)}px` }, h("span", { class: "tabular" }, `${hr}:00`)));
    }

    const columns = rooms.map((room) =>
      h(
        "div",
        { class: "tl-col" },
        room.bookings.map(({ member, event }) =>
          h(
            "button",
            {
              class: "event",
              type: "button",
              style: `--c: var(--m${member.colour});top:${y(event.start)}px;height:${Math.max(y(event.end) - y(event.start) - 2, 14)}px`,
              "aria-label": `${room.room}: ${member.name}, ${time(event.start)} to ${time(event.end)}`,
              onclick: () => openBooking(member, event),
            },
            y(event.end) - y(event.start) >= 24 && h("span", {}, member.name),
          ),
        ),
      ),
    );

    const showNow = state.day === now.day && now.minutes >= first * 60 && now.minutes <= last * 60;

    return h(
      "section",
      { class: "timeline", style: `--cols:${rooms.length}`, "aria-label": "Rooms through the day" },
      h(
        "div",
        { class: "tl-scroll" },
        h(
          "div",
          { class: "tl-inner" },
          h("div", { class: "tl-head" }, h("span"), rooms.map((room) => h("div", { class: "tl-name" }, h("span", {}, room.room)))),
          h(
            "div",
            { class: "tl-body", style: `height:${y(last * 60)}px` },
            hours,
            h("div", { class: "tl-cols" }, columns),
            showNow && h("div", { class: "tl-now", style: `top:${y(now.minutes)}px` }),
          ),
        ),
      ),
    );
  }

  function render() {
    if (state.missing) {
      document.title = "Bookings";
      app.replaceChildren(
        h(
          "main",
          { class: "page" },
          header(),
          h(
            "div",
            { class: "missing" },
            h("h1", {}, "This group doesn't exist"),
            h("p", {}, "Check the link, or start a new group."),
            h("a", { class: "button", href: "/" }, "Start a group"),
          ),
        ),
      );
      return;
    }

    if (!state.group) {
      app.replaceChildren(h("main", { class: "page" }, header(), h("p", { class: "loading" }, "Loading…")));
      return;
    }

    const names = state.group.members.map((m) => m.name);
    document.title = names.length ? `Bookings · ${names.join(", ")}` : "Bookings";

    const entry = state.weeks.get(state.week);
    const data = entry?.data;

    const content = h("div", { class: "swipe" }, dayView(entry), data && timeline(data));
    swipe(content);

    app.replaceChildren(
      h(
        "main",
        { class: "page" },
        header(),
        callout(),
        state.group.members.length > 0 && people(data),
        weekNav(),
        dayTabs(data),
        content,
        footer(),
      ),
    );
  }

  function swipe(el) {
    let startX, startY;
    el.addEventListener(
      "touchstart",
      (e) => {
        // Let the room timeline scroll sideways without changing day.
        if (e.target.closest(".tl-scroll")?.scrollWidth > e.target.closest(".tl-scroll")?.clientWidth) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      },
      { passive: true },
    );
    el.addEventListener("touchend", (e) => {
      if (startX == null) return;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      startX = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) stepDay(dx < 0 ? 1 : -1);
    });
  }

  render();
  loadGroup();
  loadWeek(state.week);

  // Keep "now" honest without disturbing an open sheet.
  setInterval(() => {
    if (!document.querySelector("dialog[open]") && state.day === londonNow().day) render();
  }, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !document.querySelector("dialog[open]")) render();
  });
}

/* ---------- Routing ---------- */

const match = location.pathname.match(/^\/g\/([A-Za-z0-9]{6})\/?$/);
if (!match) renderHome();
else if (match[1] !== match[1].toUpperCase()) location.replace(`/g/${match[1].toUpperCase()}`);
else startGroup(match[1]);
