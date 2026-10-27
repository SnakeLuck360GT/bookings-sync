import { getStore } from "@netlify/blobs";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
// Group codes are typed by hand, so they're short and skip 0/O, 1/I/L.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const MAX_MEMBERS = 12;
export const COLOURS = 8;

const groups = () => getStore({ name: "groups", consistency: "strong" });

export function newId(length = 10, alphabet = ALPHABET) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function newCode() {
  return newId(6, CODE_ALPHABET);
}

/** Codes are case-insensitive; returns the stored form, or null if it can't be a code. */
export function normaliseCode(input) {
  const code = String(input || "").trim().toUpperCase();
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code) ? code : null;
}

export function nextColour(members) {
  const used = new Set(members.map((m) => m.colour));
  for (let i = 0; i < COLOURS; i++) if (!used.has(i)) return i;
  return members.length % COLOURS;
}

export async function createGroup(member) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const group = { id: newCode(), createdAt: new Date().toISOString(), members: [{ ...member, colour: 0 }] };
    const { modified } = await groups().setJSON(group.id, group, { onlyIfNew: true });
    if (modified) return group;
  }
  throw new Error("Could not allocate a group id");
}

export async function getGroup(id) {
  return groups().get(id, { type: "json" });
}

/**
 * Apply `change` to a group with optimistic locking so two friends joining at
 * the same moment don't overwrite each other. `change` may throw to abort.
 */
export async function updateGroup(id, change) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await groups().getWithMetadata(id, { type: "json" });
    if (!current) return null;
    const next = change(structuredClone(current.data));
    const { modified } = await groups().setJSON(id, next, { onlyIfMatch: current.etag });
    if (modified) return next;
  }
  throw new Error("Group is busy, try again");
}
