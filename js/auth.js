import { getMessByPublicId, getMess, getMember, listMembers, getSession, setSession, clearSession } from "./storage.js";
import { STRINGS } from "./strings.js";

const PBKDF2_ITERATIONS = 100000;
const SALT_BYTES = 16;

function bytesToBase64(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function generateSalt() {
  const bytes = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes);
}

export async function hashPassword(password, saltB64) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Password hashing requires localhost or HTTPS (WebCrypto is unavailable).");
  }
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: base64ToBytes(saltB64), iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

export async function createPasswordEntry(password) {
  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);
  return { salt, passwordHash };
}

export async function verifyPassword(password, saltB64, passwordHashB64) {
  const candidate = await hashPassword(password, saltB64);
  if (candidate.length !== passwordHashB64.length) return false;
  let mismatch = 0;
  for (let i = 0; i < candidate.length; i += 1) {
    mismatch |= candidate.charCodeAt(i) ^ passwordHashB64.charCodeAt(i);
  }
  return mismatch === 0;
}

const lockouts = new Map();
const MAX_ATTEMPTS = 5;
const LOCK_MS = 60 * 1000;

function lockKey(messId, name) {
  return `${messId}|${name.trim().toLowerCase()}`;
}

export function isLockedOut(messId, name, now = Date.now()) {
  const entry = lockouts.get(lockKey(messId, name));
  if (!entry) return false;
  if (entry.lockedUntil && entry.lockedUntil > now) return true;
  if (entry.lockedUntil && entry.lockedUntil <= now) lockouts.delete(lockKey(messId, name));
  return false;
}

function recordFailure(messId, name, now = Date.now()) {
  const key = lockKey(messId, name);
  const entry = lockouts.get(key) ?? { fails: 0, lockedUntil: 0 };
  entry.fails += 1;
  if (entry.fails >= MAX_ATTEMPTS) entry.lockedUntil = now + LOCK_MS;
  lockouts.set(key, entry);
}

function clearFailures(messId, name) {
  lockouts.delete(lockKey(messId, name));
}

export async function login(messPublicId, name, password) {
  const mess = getMessByPublicId(messPublicId.trim().toUpperCase());
  if (!mess || mess.status !== "active") {
    return { ok: false, error: STRINGS.errors.loginFailed };
  }
  const needle = name.trim().toLowerCase();
  const member = listMembers(mess.id).find((m) => m.name.toLowerCase() === needle);
  if (!member) return { ok: false, error: STRINGS.errors.loginFailed };
  if (isLockedOut(mess.id, member.name)) {
    return { ok: false, error: STRINGS.errors.lockedOut };
  }
  const ok = await verifyPassword(password, member.salt, member.passwordHash);
  if (!ok) {
    recordFailure(mess.id, member.name);
    return { ok: false, error: STRINGS.errors.loginFailed };
  }
  if (member.status === "requested") {
    return { ok: false, error: STRINGS.errors.waitingForManager };
  }
  if (member.status !== "active") {
    return { ok: false, error: STRINGS.errors.loginFailed };
  }
  clearFailures(mess.id, member.name);
  setSession({ messId: mess.id, memberId: member.id });
  return { ok: true, member, mess };
}

export function logout() {
  clearSession();
}

export function getSessionWithMess() {
  const session = getSession();
  if (!session) return null;
  const member = getMember(session.memberId);
  if (!member || member.messId !== session.messId) {
    clearSession();
    return null;
  }
  const mess = getMess(session.messId);
  if (!mess || mess.status !== "active") {
    clearSession();
    return null;
  }
  return { member, mess, messId: session.messId };
}

export function isManager(user) {
  return user?.member?.role === "manager";
}

export function can(user, action, entity) {
  void entity;
  if (action === "createMess" || action === "joinMess" || action === "login") return true;
  if (!user?.member) return false;
  const { member } = user;
  const active = member.status === "active";
  const participant = active && member.takesPart === true;
  const manager = active && member.role === "manager";
  switch (action) {
    case "submitPayment":
    case "submitBazar":
    case "submitSettlement":
    case "editOwnMeals":
      return participant;
    case "viewOwn":
      return active;
    case "viewAll":
    case "approve":
    case "reject":
    case "editAnyEntry":
    case "deleteAnyEntry":
    case "setBillTemplate":
    case "setSplit":
    case "editBill":
    case "generateBills":
    case "publishBills":
    case "addMember":
    case "renameMember":
    case "deactivateMember":
    case "removeMember":
    case "makeManager":
    case "resetPassword":
    case "acceptJoin":
    case "closeMonth":
    case "reopenMonth":
    case "editMemberMeals":
      return manager;
    case "transferManager":
      return manager;
    case "adminDeleteMess":
    case "adminListMesses":
      return false;
    default:
      return false;
  }
}
