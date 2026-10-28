const app = document.getElementById("app");

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LONG_DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Rooms can't be booked before 10:00.
const BOOKING_OPENS = 10 * 60;
const DEFAULT_PREFS = { from: BOOKING_OPENS, to: 18 * 60, min: 30 };
const NO_ROOM = "Room not listed";
// Where "Book" sends people: Resource Booker's room search for a day and
// time range. You log in there yourself; this app never does.
const BOOKING_URL = "https://resourcebooker.manchester.ac.uk/app/booking-types/a0ad7d46-d2f6-428d-aeba-04a0acc03503";

const hhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

function bookingLink(day, from, to) {
  const params = new URLSearchParams({ firstDay: day, fromTime: hhmm(from), toTime: hhmm(to) });
  return `${BOOKING_URL}?${params}`;
}

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

function toLondon(date) {
  const p = {};
  for (const { type, value } of londonFormat.formatToParts(date)) p[type] = value;
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

const londonNow = () => toLondon(new Date());

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

// A single booking can be at most this long, so longer gaps need several.
const MAX_BOOKING = 3 * 60;

/** A gap fits in one booking, or else offer its first or last MAX_BOOKING. */
function bookingOptions(s, e) {
  return e - s <= MAX_BOOKING
    ? [[s, e]]
    : [
        [s, s + MAX_BOOKING],
        [e - MAX_BOOKING, e],
      ];
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
  close:
    '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m5 5 10 10M15 5 5 15"/></svg>',
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
    h(
      "div",
      { class: "sheet-head" },
      h("h2", {}, title),
      iconButton("close", "Close", () => dialog.close()),
    ),
    ...content,
  );
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    // Closing hands focus back to the opener, which would show a focus ring after a tap.
    if (!matchMedia("(hover: hover)").matches) document.activeElement?.blur();
  });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

let fieldCount = 0;

/* ---------- Proof of a booking ---------- */

/**
 * Recreate the university's booking confirmation email for a booking that has
 * just been checked live against its feed. It names the booker as the
 * recipient, and the footer says it was recreated and when it was checked.
 */
function proofImage(member, proof) {
  const W = 1080;
  const X = 64;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = 1600;
  const g = canvas.getContext("2d");
  const font = (weight, px) => `${weight} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const white = "#ececec";
  const muted = "#8e8e93";
  const blue = "#5b9be6";

  g.fillStyle = "#141414";
  g.fillRect(0, 0, canvas.width, canvas.height);

  // Wrap text to the width, returning the y below it.
  function paragraph(text, y, px, colour, weight = 400) {
    g.font = font(weight, px);
    g.fillStyle = colour;
    let line = "";
    for (const word of text.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (g.measureText(next).width > W - 2 * X && line) {
        g.fillText(line, X, y);
        y += px * 1.45;
        line = word;
      } else line = next;
    }
    g.fillText(line, X, y);
    return y + px * 1.45;
  }

  // "Label: value", with links drawn blue and underlined like the email.
  function field(label, value, y, { link = false, linkLabel = false } = {}) {
    const px = 50;
    const words = label.split(" ");
    g.font = font(700, px);
    let x = X;
    words.forEach((word, i) => {
      const last = i === words.length - 1;
      const text = last ? `${word}:` : `${word} `;
      g.fillStyle = linkLabel && last ? blue : white;
      g.fillText(text, x, y);
      const w = g.measureText(text).width;
      if (linkLabel && last) g.fillRect(x, y + 8, w, 3);
      x += w;
    });
    x += 16;
    g.font = font(400, px);
    g.fillStyle = link ? blue : white;
    g.fillText(value, x, y, W - X - x);
    if (link) g.fillRect(x, y + 8, Math.min(g.measureText(value).width, W - X - x), 3);
  }

  const start = toLondon(new Date(proof.start));
  const end = toLondon(new Date(proof.end));
  const year = start.day.slice(0, 4);
  const room = proof.building ? `${proof.building}_${proof.room}` : proof.room || NO_ROOM;

  let y = paragraph("Room Bookings: Room Booking Confirmation", 110, 44, white, 600);
  y += 10;
  g.fillStyle = "#2a2a2a";
  g.fillRect(0, y, W, 2);

  y += 110;
  g.beginPath();
  g.arc(X + 50, y - 16, 50, 0, Math.PI * 2);
  g.fillStyle = "#4a8fdc";
  g.fill();
  g.fillStyle = "#ffffff";
  g.font = font(500, 46);
  g.textAlign = "center";
  g.fillText("N", X + 50, y);
  g.textAlign = "left";
  g.fillStyle = white;
  g.font = font(600, 44);
  g.fillText("noreply@manchester.ac.uk", X + 130, y - 22);
  g.fillStyle = muted;
  g.font = font(400, 40);
  g.fillText(`To ${member.name}`, X + 130, y + 32);

  y += 190;
  y = paragraph("The room booking detailed below has been confirmed.", y, 50, white);
  y += 50;
  const step = 82;
  field("Booking Title", proof.title || "Room booking", y);
  field("Date(s)", `${dayOfMonth(start.day)} ${monthOf(start.day)} ${year}`, (y += step), { link: true });
  field("Day", LONG_DAY_NAMES[weekday(start.day)], (y += step));
  field("Booking Starts", hhmm(start.minutes), (y += step), { link: true, linkLabel: true });
  field("Booking Ends", hhmm(end.minutes), (y += step), { link: true, linkLabel: true });
  field("Room", room, (y += step));

  const checked = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(proof.checkedAt));
  y += 140;
  y = paragraph(
    `Ref ${proof.reference} · checked live with the university timetable at ${checked} · recreated by Bookings`,
    y,
    30,
    "#77777c",
  );

  // Trim the canvas to the content.
  const out = document.createElement("canvas");
  out.width = W;
  out.height = Math.ceil(y + 40);
  out.getContext("2d").drawImage(canvas, 0, 0);
  return new Promise((resolve) => out.toBlob(resolve, "image/png"));
}

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
    h(
      "p",
      {},
      "Rooms you book through the university show up in it automatically. Friends only see your bookings, not your classes.",
    ),
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
function joinForm({ code: prefill = "", submitLabel = "Join" } = {}) {
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
  code.value = prefill;
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
      submitLabel,
      busyLabel: "Checking…",
      onSubmit: async () => {
        const who = required(name, "Add your name.").trim();
        const value = required(code, "Enter your group code.").trim().toUpperCase();
        if (group?.id !== value) {
          group = await api(`/groups/${encodeURIComponent(value)}`);
          newcomer.hidden = true;
          el.setLabel(submitLabel);
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
        h("button", { type: "button", "aria-pressed": String(mode === value), onclick: () => ((mode = value), show()) }, label),
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
      h(
        "p",
        { class: "note" },
        "Your link stays private. Friends see your room bookings, never your classes or the link itself.",
      ),
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

  state.prefs.from = Math.max(state.prefs.from, BOOKING_OPENS);
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
        select("From", "from", hours(BOOKING_OPENS / 60, 13), time),
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
      proofButton(member, event),
    );
  }

  /**
   * Proof is offered for confirmed bookings from the university's feed, once
   * they've started and can no longer be cancelled.
   */
  function proofButton(member, event) {
    if (!event.verifiable) return null;
    const now = londonNow();
    const started = event.day < now.day || (event.day === now.day && event.start <= now.minutes);
    const ended = event.day < now.day || (event.day === now.day && event.end <= now.minutes);
    if (ended) return null;
    if (!started) {
      return h(
        "p",
        { class: "field-note share-proof" },
        `Proof is available from ${time(event.start)} on ${LONG_DAY_NAMES[weekday(event.day)]}, once the booking has started and can't be cancelled.`,
      );
    }
    return h(
      "button",
      { class: "button primary share-proof", type: "button", onclick: () => openProof(member, event) },
      "Open proof",
    );
  }

  async function openProof(member, event) {
    // Open the tab during the tap so it isn't blocked as a pop-up, then load the image into it.
    const tab = window.open("", "_blank");
    try {
      const proof = await api(`/groups/${id}/members/${member.id}/proof?ref=${encodeURIComponent(event.reference)}`);
      const url = URL.createObjectURL(await proofImage(member, proof));
      if (tab) tab.location.href = url;
      else location.href = url;
    } catch (err) {
      tab?.close();
      toast(err.message);
    }
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

  function logOut() {
    state.me = null;
    forget(id);
    render();
  }

  /** Not logged in on this device: log in with your name and the group code. */
  function callout() {
    if (self()) return null;
    return h(
      "div",
      { class: "callout" },
      h("h2", { class: "callout-title" }, "Log in"),
      joinForm({ code: id, submitLabel: "Log in" }),
    );
  }

  function footer() {
    const me = self();
    if (!me) return null;
    return h(
      "p",
      { class: "footer" },
      `Logged in as ${me.name}. `,
      h("button", { class: "link", type: "button", onclick: logOut }, "Log out"),
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
          state.group.members.length > 0 &&
            h("button", { class: "chip quiet", type: "button", onclick: () => ((state.editing = true), render()) }, "Edit"),
        ];

    return h("div", { class: "people" }, chips, controls);
  }

  function weekNav() {
    const thisWeek = mondayOf(londonNow().day);
    const offset = Math.round((Date.parse(state.week) - Date.parse(thisWeek)) / (7 * 864e5));
    const label =
      { 0: "This week", 1: "Next week", [-1]: "Last week" }[offset] ?? `Week of ${dayOfMonth(state.week)} ${monthOf(state.week)}`;
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
      h(
        "span",
        { class: "booked-by", style: `--c: var(--m${member.colour})` },
        h("span", { class: "dot" }),
        `Booked by ${member.name}`,
      ),
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

  /** Unbooked stretches of the selected day, and whether you can still book one. */
  function openGaps(bookings, now) {
    if (state.day < now.day) return { open: [], canBook: false };
    const { from, to, min } = state.prefs;
    // Today, gaps start no earlier than the next quarter hour.
    const earliest = state.day === now.day ? Math.ceil(now.minutes / 15) * 15 : 0;
    const open = uncovered(
      bookings.map((b) => b.event),
      from,
      to,
      min,
    )
      .map(([s, e]) => [Math.max(s, earliest), e])
      .filter(([s, e]) => e - s >= min);
    // One booking a day: only offer to book if you haven't used yours.
    const me = self();
    return { open, canBook: !me || !bookings.some((b) => b.member.id === me.id) };
  }

  // A room can be booked from 24 hours before it starts.
  const opensAt = (s) => ({ day: addDays(state.day, -1), minutes: s });
  const isOpen = ({ day, minutes }, now) => now.day > day || (now.day === day && now.minutes >= minutes);

  function when({ day, minutes }, now) {
    if (day === now.day) return time(minutes);
    if (day === addDays(now.day, 1)) return `tomorrow ${time(minutes)}`;
    return `${DAY_NAMES[weekday(day)]} ${time(minutes)}`;
  }

  /** Book now if booking has opened for this slot; otherwise offer a reminder for when it does. */
  /** `ranged` buttons name their slot, for gaps that offer more than one. */
  function bookButton(s, e, ranged = false) {
    const now = londonNow();
    const opens = opensAt(s);
    const range = `${time(s)}–${time(e)}`;
    if (!isOpen(opens, now)) {
      return h(
        "button",
        {
          class: ranged ? "button book later ranged" : "button book later",
          type: "button",
          onclick: () => openReminder(s, e),
          "aria-label": `Booking for ${time(s)} to ${time(e)} opens ${when(opens, now)}. Set a reminder`,
        },
        ranged && h("span", { class: "book-range tabular" }, range),
        h("span", { class: "book-opens" }, `Opens ${when(opens, now)}`),
      );
    }
    const label = ranged ? `Book ${range}` : "Book";
    const href = bookingLink(state.day, s, e);
    return h(
      "a",
      {
        class: "button book",
        href,
        rel: "noreferrer",
        "aria-label": `Book a room for ${time(s)} to ${time(e)}`,
        // Resource Booker can hang when opened in a new tab or in-app browser on phones,
        // so open it in this tab, and copy the link first so it can be pasted if it still does.
        onclick: async (event) => {
          event.preventDefault();
          try {
            await navigator.clipboard.writeText(href);
          } catch {}
          location.href = href;
        },
      },
      label,
    );
  }

  function gaps(bookings, now, members) {
    if (state.day < now.day) return null;
    const { from, to, min } = state.prefs;
    const isToday = state.day === now.day;
    const { open, canBook } = openGaps(bookings, now);

    return h(
      "section",
      { class: "block" },
      h(
        "div",
        { class: "section-head" },
        h("h2", {}, "Gaps to book"),
        h(
          "button",
          { class: "link tabular", type: "button", onclick: openPrefs },
          `${time(from)}–${time(to)} · ${duration(min)}+`,
        ),
      ),
      open.length
        ? h(
            "ul",
            { class: "slots" },
            open.map(([s, e]) => {
              const options = bookingOptions(s, e);
              return h(
                "li",
                { class: "slot" },
                h("span", { class: "slot-time tabular" }, `${time(s)} – ${time(e)}`),
                h(
                  "span",
                  { class: "slot-end" },
                  h("span", { class: "slot-meta tabular" }, duration(e - s)),
                  canBook && options.length === 1 && bookButton(s, e),
                ),
                canBook &&
                  options.length > 1 &&
                  h(
                    "span",
                    { class: "slot-options" },
                    options.map(([a, b]) => bookButton(a, b, true)),
                  ),
              );
            }),
          )
        : h(
            "p",
            { class: "empty" },
            isToday && bookings.length ? "Nothing left to book today." : `Booked from ${time(from)} to ${time(to)}.`,
          ),
      stillToBook(members, bookings),
    );
  }

  /** A calendar reminder for when booking opens for one slot, optionally every week. */
  function openReminder(s, e) {
    const day = state.day;
    const opens = opensAt(s);
    const label = `${DAY_NAMES[weekday(day)]} ${dayOfMonth(day)} ${monthOf(day)}`;
    const link = bookingLink(day, s, e);
    const title = `Book a room for ${time(s)}–${time(e)}`;
    // A weekly reminder can't carry one date's Book link, so it links to this group instead.
    const details = () =>
      repeat.checked
        ? `Booking opens now for tomorrow (${LONG_DAY_NAMES[weekday(day)]}), ${time(s)}–${time(e)}.\nOpen: ${location.origin}/g/${id}`
        : `Booking opens now for ${label}, ${time(s)}–${time(e)}.\nBook: ${link}`;

    const input = h("input", { type: "datetime-local", value: `${opens.day}T${hhmm(opens.minutes)}` });
    input.id = `field-${++fieldCount}`;
    const repeat = h("input", { type: "checkbox" });

    // Reminder times are UK wall-clock, so a weekly reminder stays put when the clocks change.
    const stamp = (d) => d.toISOString().slice(0, 19).replace(/[-:]/g, "");
    function add() {
      // Read the chosen wall-clock time as if UTC, purely to do date arithmetic on it.
      const start = new Date(`${input.value}Z`);
      if (Number.isNaN(start.getTime())) return;
      const end = new Date(start.getTime() + 15 * 60 * 1000);
      if (/Android/i.test(navigator.userAgent)) {
        const params = new URLSearchParams({
          action: "TEMPLATE",
          text: title,
          dates: `${stamp(start)}/${stamp(end)}`,
          ctz: "Europe/London",
          details: details(),
        });
        if (repeat.checked) params.set("recur", "RRULE:FREQ=WEEKLY");
        window.open(`https://calendar.google.com/calendar/render?${params}`, "_blank", "noopener");
      } else {
        const ics = [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//Bookings//EN",
          "BEGIN:VEVENT",
          `UID:${stamp(start)}-${day}-${s}@bookings`,
          `DTSTAMP:${stamp(new Date())}Z`,
          `DTSTART;TZID=Europe/London:${stamp(start)}`,
          `DTEND;TZID=Europe/London:${stamp(end)}`,
          repeat.checked && "RRULE:FREQ=WEEKLY",
          `SUMMARY:${title}`,
          // iCalendar text escapes commas and newlines.
          `DESCRIPTION:${details().replace(/,/g, "\\,").replace(/\n/g, "\\n")}`,
          `URL:${repeat.checked ? `${location.origin}/g/${id}` : link}`,
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          `DESCRIPTION:${title}`,
          "TRIGGER:PT0M",
          "END:VALARM",
          "END:VEVENT",
          "END:VCALENDAR",
        ]
          .filter(Boolean)
          .join("\r\n");
        const a = h("a", { href: URL.createObjectURL(new Blob([ics], { type: "text/calendar" })), download: "book-a-room.ics" });
        a.click();
      }
      sheet.close();
    }

    const sheet = openSheet(
      "Remind me to book",
      h(
        "div",
        { class: "form" },
        h(
          "p",
          { class: "field-note" },
          `Booking for ${label}, ${time(s)}–${time(e)} opens ${DAY_NAMES[weekday(opens.day)]} ${dayOfMonth(opens.day)} ${monthOf(opens.day)} at ${time(opens.minutes)}. This adds a reminder to your calendar with a link to book.`,
        ),
        h("div", { class: "field" }, h("label", { for: input.id }, "Remind me at"), input),
        h("label", { class: "check" }, repeat, `Repeat every ${LONG_DAY_NAMES[weekday(opens.day)]}`),
        h("button", { class: "button primary", type: "button", onclick: add }, "Add reminder"),
      ),
    );
  }

  function roomsSection(bookings, now) {
    if (!bookings.length) return null;
    return h(
      "section",
      { class: "block" },
      h("div", { class: "section-head" }, h("h2", {}, bookings.length === 1 ? "Booked room" : "Booked rooms")),
      h(
        "ul",
        { class: "bookings" },
        bookings.map(({ member, event }) => {
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
              h(
                "span",
                { class: "booking-main" },
                h(
                  "span",
                  { class: "booking-who", style: `--c: var(--m${member.colour})` },
                  h("span", { class: "dot" }),
                  member.name,
                ),
                h("span", { class: "booking-room" }, event.room || event.location || NO_ROOM),
              ),
              h("span", { class: "booking-time tabular" }, `${time(event.start)} – ${time(event.end)}`),
              h("span", { class: "booking-sub" }, event.building),
              h(
                "span",
                { class: "booking-len tabular" },
                current ? `Now · ${duration(event.end - now.minutes)} left` : duration(event.end - event.start),
              ),
            ),
          );
        }),
      ),
    );
  }

  function dayView(entry) {
    if (!included(state.group.members).length) return h("p", { class: "empty" }, "Tap a name above to include them.");
    if (!entry || entry.loading) return h("p", { class: "loading" }, "Loading bookings…");
    if (entry.error) {
      return h(
        "p",
        { class: "empty" },
        entry.error,
        " ",
        h("button", { class: "link", type: "button", onclick: reloadAll }, "Retry"),
      );
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
      roomsSection(bookings, now),
      failed.length > 0 &&
        h(
          "p",
          { class: "hint" },
          `Couldn't load ${failed.map((m) => m.name).join(" and ")}'s timetable right now, so some bookings may be missing.`,
        ),
    );
  }

  function timeline(data) {
    const people = included(data.members);
    if (!people.length) return null;
    const rooms = roomsFor(people, state.day);
    const now = londonNow();
    const { open, canBook } = openGaps(
      rooms.flatMap((room) => room.bookings),
      now,
    );

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
              // Longer bookings get bigger room numbers: 14px at 30 min up to 24px at 3 hours.
              style: `--c: var(--m${member.colour});--room-size:${Math.round(Math.min(24, Math.max(14, 12 + ((event.end - event.start) / 60) * 4)))}px;top:${y(event.start)}px;height:${Math.max(y(event.end) - y(event.start) - 2, 14)}px`,
              "aria-label": `${room.room}: ${member.name}, ${time(event.start)} to ${time(event.end)}`,
              onclick: () => openBooking(member, event),
            },
            y(event.end) - y(event.start) >= 24 &&
              h(
                "span",
                {},
                h("strong", {}, room.room),
                y(event.end) - y(event.start) >= 40 && h("br"),
                y(event.end) - y(event.start) >= 40 && member.name,
              ),
          ),
        ),
      ),
    );

    const bands = open.map(([s, e]) =>
      h(
        "div",
        { class: "tl-gap", style: `top:${y(s)}px;height:${y(e) - y(s)}px` },
        canBook && y(e) - y(s) >= 30 && bookingOptions(s, e).map(([a, b]) => bookButton(a, b, true)),
      ),
    );

    const showNow = state.day === now.day && now.minutes >= first * 60 && now.minutes <= last * 60;

    return h(
      "section",
      { class: "timeline", style: `--cols:${Math.max(rooms.length, 1)}`, "aria-label": "Rooms through the day" },
      h(
        "div",
        { class: "tl-scroll" },
        h(
          "div",
          { class: "tl-inner" },
          h(
            "div",
            { class: "tl-head" },
            h("span"),
            rooms.length
              ? rooms.map((room) => h("div", { class: "tl-name" }, h("span", {}, room.room)))
              : h("div", { class: "tl-name" }, h("span", {}, "No rooms booked")),
          ),
          h(
            "div",
            { class: "tl-body", style: `height:${y(last * 60)}px` },
            hours,
            bands,
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
