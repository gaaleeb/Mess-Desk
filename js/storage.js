const DATA_KEY = "messapp.v1";
const SESSION_KEY = "messapp.session";
const PUBLIC_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const EMPTY_DATA = Object.freeze({
  messes: [],
  members: [],
  billItems: [],
  monthlyBills: [],
  payments: [],
  bazar: [],
  meals: [],
  monthCloses: [],
  auditLog: [],
});

function emptyData() {
  return JSON.parse(JSON.stringify(EMPTY_DATA));
}

function hasStorage() {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

export function readData() {
  if (!hasStorage()) return emptyData();
  const raw = localStorage.getItem(DATA_KEY);
  if (!raw) return emptyData();
  try {
    const parsed = JSON.parse(raw);
    return { ...emptyData(), ...parsed };
  } catch {
    return emptyData();
  }
}

export function writeData(data) {
  if (!hasStorage()) throw new Error("localStorage is not available");
  localStorage.setItem(DATA_KEY, JSON.stringify(data));
  return data;
}

export function mutate(fn) {
  const data = readData();
  const result = fn(data) ?? data;
  writeData(result);
  return result;
}

export function resetAll() {
  if (!hasStorage()) return;
  localStorage.removeItem(DATA_KEY);
  localStorage.removeItem(SESSION_KEY);
}

export function newId() {
  return crypto.randomUUID();
}

export function generatePublicId() {
  let id = "MESS-";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (const b of bytes) id += PUBLIC_ID_ALPHABET[b % PUBLIC_ID_ALPHABET.length];
  return id;
}

export function uniquePublicId(messes) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = generatePublicId();
    if (!messes.some((m) => m.publicId === candidate)) return candidate;
  }
  throw new Error("Could not generate a unique mess ID");
}

export function createMess({ name, publicId } = {}) {
  return mutate((data) => {
    let id = publicId && !data.messes.some((m) => m.publicId === publicId) ? publicId : null;
    if (!id) id = uniquePublicId(data.messes);
    const mess = {
      id: newId(),
      publicId: id,
      name,
      status: "active",
      createdAt: todayISO(),
    };
    data.messes.push(mess);
    return data;
  }).messes.at(-1);
}

export function getMess(id) {
  return readData().messes.find((m) => m.id === id) ?? null;
}

export function getMessByPublicId(publicId) {
  return readData().messes.find((m) => m.publicId === publicId) ?? null;
}

export function listActiveMesses() {
  return readData().messes.filter((m) => m.status === "active");
}

export function listAllMesses() {
  return readData().messes;
}

export function softDeleteMess(id) {
  return mutate((data) => {
    const mess = data.messes.find((m) => m.id === id);
    if (mess) mess.status = "deleted";
    return data;
  });
}

export function restoreMess(id) {
  return mutate((data) => {
    const mess = data.messes.find((m) => m.id === id);
    if (mess) mess.status = "active";
    return data;
  });
}

function inMess(row, messId) {
  return row.messId === messId;
}

export function listMembers(messId) {
  return readData().members.filter((m) => inMess(m, messId));
}

export function getMember(id) {
  return readData().members.find((m) => m.id === id) ?? null;
}

export function findMemberByName(messId, name) {
  const needle = name.trim().toLowerCase();
  return readData().members.find((m) => inMess(m, messId) && m.name.toLowerCase() === needle) ?? null;
}

export function addMember(member) {
  return mutate((data) => {
    data.members.push({ id: newId(), leftOn: null, ...member });
    return data;
  }).members.at(-1);
}

export function updateMember(id, patch) {
  return mutate((data) => {
    const member = data.members.find((m) => m.id === id);
    if (member) Object.assign(member, patch);
    return data;
  }).members.find((m) => m.id === id) ?? null;
}

export function updateBillItem(id, patch) {
  return mutate((data) => {
    const item = data.billItems.find((i) => i.id === id);
    if (item) Object.assign(item, patch);
    return data;
  });
}

export function deleteBillItem(id) {
  return mutate((data) => {
    data.billItems = data.billItems.filter((i) => i.id !== id);
    return data;
  });
}

export function listBillItems(messId) {
  return readData().billItems.filter((i) => inMess(i, messId));
}

export function addBillItem(item) {
  return mutate((data) => {
    data.billItems.push({ id: newId(), ...item });
    return data;
  }).billItems.at(-1);
}

export function listMonthlyBills(messId, month) {
  return readData().monthlyBills.filter((b) => inMess(b, messId) && b.month === month);
}

export function addMonthlyBill(bill) {
  return mutate((data) => {
    data.monthlyBills.push({ id: newId(), published: false, ...bill });
    return data;
  }).monthlyBills.at(-1);
}

export function updateMonthlyBill(id, patch) {
  return mutate((data) => {
    const bill = data.monthlyBills.find((b) => b.id === id);
    if (bill) Object.assign(bill, patch);
    return data;
  });
}

export function listPayments(messId, { month, memberId, state, ledger } = {}) {
  return readData().payments.filter(
    (p) =>
      inMess(p, messId) &&
      (!month || p.month === month) &&
      (!memberId || p.memberId === memberId) &&
      (!state || p.state === state) &&
      (!ledger || p.ledger === ledger),
  );
}

export function addPayment(payment) {
  return mutate((data) => {
    data.payments.push({
      id: newId(),
      paidTo: null,
      reviewedBy: null,
      reviewNote: "",
      createdAt: nowISO(),
      ...payment,
    });
    return data;
  }).payments.at(-1);
}

export function updatePayment(id, patch) {
  return mutate((data) => {
    const payment = data.payments.find((p) => p.id === id);
    if (payment) Object.assign(payment, patch);
    return data;
  });
}

export function listBazar(messId, { memberId, state, month } = {}) {
  return readData().bazar.filter(
    (b) =>
      inMess(b, messId) &&
      (!memberId || b.memberId === memberId) &&
      (!state || b.state === state) &&
      (!month || b.date.slice(0, 7) === month),
  );
}

export function addBazar(entry) {
  return mutate((data) => {
    data.bazar.push({ id: newId(), reviewedBy: null, reviewNote: "", ...entry });
    return data;
  }).bazar.at(-1);
}

export function updateBazar(id, patch) {
  return mutate((data) => {
    const entry = data.bazar.find((b) => b.id === id);
    if (entry) Object.assign(entry, patch);
    return data;
  });
}

export function getMealEntry(messId, memberId, date) {
  return readData().meals.find((m) => inMess(m, messId) && m.memberId === memberId && m.date === date) ?? null;
}

export function listMeals(messId, month) {
  return readData().meals.filter((m) => inMess(m, messId) && m.date.slice(0, 7) === month);
}

export function setMealEntry({ messId, memberId, date, halves }) {
  return mutate((data) => {
    const existing = data.meals.find(
      (m) => m.messId === messId && m.memberId === memberId && m.date === date,
    );
    if (existing) {
      existing.halves = halves;
      existing.updatedAt = nowISO();
    } else {
      data.meals.push({ messId, memberId, date, halves, updatedAt: nowISO() });
    }
    return data;
  });
}

export function listMonthCloses(messId) {
  return readData().monthCloses.filter((c) => inMess(c, messId));
}

export function addMonthClose(close) {
  return mutate((data) => {
    data.monthCloses.push({ ...close });
    return data;
  }).monthCloses.at(-1);
}

export function addAuditLog({ messId, actorId, action, entity, entityId, before = null, after = null }) {
  return mutate((data) => {
    data.auditLog.push({ id: newId(), messId, actorId, action, entity, entityId, before, after, at: nowISO() });
    return data;
  }).auditLog.at(-1);
}

export function listAuditLog(messId, { entity, entityId } = {}) {
  return readData().auditLog.filter(
    (row) => inMess(row, messId) && (!entity || row.entity === entity) && (!entityId || row.entityId === entityId),
  );
}

export function getSession() {
  if (!hasStorage()) return null;
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setSession(session) {
  if (!hasStorage()) return;
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  if (!hasStorage()) return;
  localStorage.removeItem(SESSION_KEY);
}

export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function nowISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

export function deleteMonthlyBill(id) {
  return mutate((data) => {
    data.monthlyBills = data.monthlyBills.filter((b) => b.id !== id);
    return data;
  });
}

export function deletePayment(id) {
  return mutate((data) => {
    data.payments = data.payments.filter((p) => p.id !== id);
    return data;
  });
}

export function deleteBazar(id) {
  return mutate((data) => {
    data.bazar = data.bazar.filter((b) => b.id !== id);
    return data;
  });
}

export function findPayment(id) {
  return readData().payments.find((p) => p.id === id) ?? null;
}

export function findBazar(id) {
  return readData().bazar.find((b) => b.id === id) ?? null;
}


export function getMonthClose(messId, month) {
  return readData().monthCloses.find((c) => c.messId === messId && c.month === month) ?? null;
}

export function isMonthClosed(messId, month) {
  return readData().monthCloses.some((c) => c.messId === messId && c.month === month);
}

export function getLastClosedMonthBefore(messId, month) {
  const closes = readData().monthCloses.filter((c) => c.messId === messId && c.month < month);
  closes.sort((a, b) => (a.month < b.month ? 1 : -1));
  return closes[0] ?? null;
}

export function deleteMonthClose(messId, month) {
  return mutate((data) => {
    data.monthCloses = data.monthCloses.filter((c) => !(c.messId === messId && c.month === month));
    return data;
  });
}

export function listPaymentsByMess(messId) {
  return readData().payments.filter((p) => inMess(p, messId));
}

export function listBazarByMess(messId) {
  return readData().bazar.filter((b) => inMess(b, messId));
}

export function listMealsByMember(messId, memberId) {
  return readData().meals.filter((m) => inMess(m, messId) && m.memberId === memberId);
}

export function deleteMember(id) {
  return mutate((data) => {
    data.members = data.members.filter((m) => m.id !== id);
    return data;
  });
}

export function isBillItemUsed(itemId) {
  return readData().monthlyBills.some((b) => b.itemId === itemId);
}
