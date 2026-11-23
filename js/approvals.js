import {
  addPayment,
  addBazar,
  updatePayment,
  updateBazar,
  addAuditLog,
  findPayment,
  findBazar,
  listPayments,
  listBazar,
  getMember,
  isMonthClosed,
  deletePayment,
  deleteBazar,
  todayISO,
} from "./storage.js";
import { can } from "./auth.js";
import { mealDebtFor } from "./ledger.js";
import { STRINGS } from "./strings.js";

function monthOf(dateISO) {
  return dateISO.slice(0, 7);
}

export function submitPayment(actor, { messId, memberId, ledger, kind = "payment", paidTo = null, date, amount, method, note }) {
  const action = kind === "settlement" ? "submitSettlement" : "submitPayment";
  if (!can(actor, action)) return { ok: false, error: STRINGS.errors.notAllowed };
  if (actor?.member?.id !== memberId) return { ok: false, error: STRINGS.errors.notAllowed };
  if (ledger !== "bill" && ledger !== "meal") return { ok: false, error: STRINGS.errors.badAmount };
  if (!Number.isInteger(amount) || amount < 1 || amount > 10000000) return { ok: false, error: STRINGS.errors.badAmount };
  if (!date || date > todayISO()) return { ok: false, error: STRINGS.errors.dateRange };
  const submitter = getMember(memberId);
  if (submitter?.joinedOn && date < submitter.joinedOn) return { ok: false, error: STRINGS.errors.dateRange };
  if (kind === "settlement") {
    if (!paidTo) return { ok: false, error: STRINGS.errors.required };
    const debt = mealDebtFor(messId, monthOf(date), memberId);
    if (amount > debt) return { ok: false, error: STRINGS.errors.settlementTooBig };
  }
  const entryMonth = monthOf(date);
  if (isMonthClosed(messId, entryMonth)) return { ok: false, error: STRINGS.errors.monthClosed };
  const actorMember = actor?.member;
  const isSelf = actorMember && actorMember.id === memberId;
  const managerSelf = isSelf && actorMember.role === "manager";
  const payment = addPayment({
    messId,
    memberId,
    ledger,
    kind,
    paidTo,
    month: entryMonth,
    date,
    amount,
    method: method ?? "cash",
    note: note ?? "",
    state: managerSelf ? "approved" : "pending",
    reviewedBy: managerSelf ? actorMember.id : null,
    reviewNote: managerSelf ? "self-approved" : "",
  });
  addAuditLog({
    messId,
    actorId: actorMember?.id ?? null,
    action: managerSelf ? "self-approve" : "submit",
    entity: "payment",
    entityId: payment.id,
    before: null,
    after: { state: payment.state, amount, date, ledger, kind },
  });
  return { ok: true, payment };
}

export function submitBazar(actor, { messId, memberId, date, note, lines }) {
  if (!can(actor, "submitBazar")) return { ok: false, error: STRINGS.errors.notAllowed };
  if (actor?.member?.id !== memberId) return { ok: false, error: STRINGS.errors.notAllowed };
  if (!Array.isArray(lines) || lines.length === 0) return { ok: false, error: STRINGS.errors.required };
  const cleanLines = lines.map((l) => ({ category: l.category, amount: Math.floor(Number(l.amount)) }));
  if (cleanLines.some((l) => !Number.isInteger(l.amount) || l.amount < 1)) return { ok: false, error: STRINGS.errors.badAmount };
  if (!date || date > todayISO()) return { ok: false, error: STRINGS.errors.dateRange };
  const bazarSubmitter = getMember(memberId);
  if (bazarSubmitter?.joinedOn && date < bazarSubmitter.joinedOn) return { ok: false, error: STRINGS.errors.dateRange };
  const entryMonth = monthOf(date);
  if (isMonthClosed(messId, entryMonth)) return { ok: false, error: STRINGS.errors.monthClosed };
  const total = cleanLines.reduce((sum, line) => sum + line.amount, 0);
  const actorMember = actor?.member;
  const isSelf = actorMember && actorMember.id === memberId;
  const managerSelf = isSelf && actorMember.role === "manager";
  const entry = addBazar({
    messId,
    memberId,
    date,
    note: note ?? "",
    lines: cleanLines,
    total,
    state: managerSelf ? "approved" : "pending",
    reviewedBy: managerSelf ? actorMember.id : null,
    reviewNote: managerSelf ? "self-approved" : "",
  });
  addAuditLog({
    messId,
    actorId: actorMember?.id ?? null,
    action: managerSelf ? "self-approve" : "submit",
    entity: "bazar",
    entityId: entry.id,
    before: null,
    after: { state: entry.state, total, date },
  });
  return { ok: true, bazar: entry };
}

export function withdrawPayment(actor, paymentId) {
  const payment = findPayment(paymentId);
  if (!payment) return { ok: false, error: "not found" };
  if (payment.memberId !== actor?.member?.id) return { ok: false, error: STRINGS.errors.notAllowed };
  if (payment.state !== "pending") return { ok: false, error: STRINGS.errors.notAllowed };
  updatePayment(paymentId, { state: "withdrawn" });
  addAuditLog({
    messId: payment.messId,
    actorId: actor.member.id,
    action: "withdraw",
    entity: "payment",
    entityId: paymentId,
    before: { state: "pending" },
    after: { state: "withdrawn" },
  });
  return { ok: true };
}

export function withdrawBazar(actor, bazarId) {
  const entry = findBazar(bazarId);
  if (!entry) return { ok: false, error: "not found" };
  if (entry.memberId !== actor?.member?.id) return { ok: false, error: STRINGS.errors.notAllowed };
  if (entry.state !== "pending") return { ok: false, error: STRINGS.errors.notAllowed };
  updateBazar(bazarId, { state: "withdrawn" });
  addAuditLog({
    messId: entry.messId,
    actorId: actor.member.id,
    action: "withdraw",
    entity: "bazar",
    entityId: bazarId,
    before: { state: "pending" },
    after: { state: "withdrawn" },
  });
  return { ok: true };
}

function applyApproval(actor, { messId, id, kind, reviewNote }) {
  const managerId = actor?.member?.id;
  if (kind === "payment") {
    const before = findPayment(id);
    if (!before || before.state !== "pending") return { ok: false, error: "not pending" };
    updatePayment(id, { state: "approved", reviewedBy: managerId, reviewNote: reviewNote ?? "" });
    addAuditLog({
      messId,
      actorId: managerId,
      action: "approve",
      entity: "payment",
      entityId: id,
      before: { state: before.state, amount: before.amount, date: before.date },
      after: { state: "approved" },
    });
    return { ok: true };
  }
  const before = findBazar(id);
  if (!before || before.state !== "pending") return { ok: false, error: "not pending" };
  updateBazar(id, { state: "approved", reviewedBy: managerId, reviewNote: reviewNote ?? "" });
  addAuditLog({
    messId,
    actorId: managerId,
    action: "approve",
    entity: "bazar",
    entityId: id,
    before: { state: before.state, total: before.total, date: before.date },
    after: { state: "approved" },
  });
  return { ok: true };
}

export function approveEntry(actor, { messId, id, kind }) {
  if (!can(actor, "approve")) return { ok: false, error: STRINGS.errors.notAllowed };
  if (isMonthClosed(messId, monthOfEntry(messId, id, kind))) {
    return { ok: false, error: STRINGS.errors.monthClosed };
  }
  return applyApproval(actor, { messId, id, kind });
}

function monthOfEntry(messId, id, kind) {
  const entry = kind === "payment" ? findPayment(id) : findBazar(id);
  if (!entry || entry.messId !== messId) return "9999-99";
  return monthOf(entry.date);
}

export function rejectEntry(actor, { messId, id, kind, reason }) {
  if (!can(actor, "reject")) return { ok: false, error: STRINGS.errors.notAllowed };
  const text = (reason ?? "").trim();
  if (text.length < 3) return { ok: false, error: STRINGS.errors.rejectReason };
  if (isMonthClosed(messId, monthOfEntry(messId, id, kind))) {
    return { ok: false, error: STRINGS.errors.monthClosed };
  }
  const managerId = actor?.member?.id;
  if (kind === "payment") {
    const before = findPayment(id);
    if (!before || before.state !== "pending") return { ok: false, error: "not pending" };
    updatePayment(id, { state: "rejected", reviewedBy: managerId, reviewNote: text });
    addAuditLog({
      messId,
      actorId: managerId,
      action: "reject",
      entity: "payment",
      entityId: id,
      before: { state: before.state },
      after: { state: "rejected", reviewNote: text },
    });
    return { ok: true };
  }
  const before = findBazar(id);
  if (!before || before.state !== "pending") return { ok: false, error: "not pending" };
  updateBazar(id, { state: "rejected", reviewedBy: managerId, reviewNote: text });
  addAuditLog({
    messId,
    actorId: managerId,
    action: "reject",
    entity: "bazar",
    entityId: id,
    before: { state: before.state },
    after: { state: "rejected", reviewNote: text },
  });
  return { ok: true };
}

export function editEntry(actor, { messId, id, kind, patch }) {
  if (!can(actor, "editAnyEntry")) return { ok: false, error: STRINGS.errors.notAllowed };
  const managerId = actor?.member?.id;
  const entryMonth = monthOfEntry(messId, id, kind);
  if (isMonthClosed(messId, entryMonth)) return { ok: false, error: STRINGS.errors.monthClosed };
  if (kind === "payment") {
    const before = findPayment(id);
    if (!before) return { ok: false, error: "not found" };
    const clean = {};
    if (patch.amount !== undefined) clean.amount = patch.amount;
    if (patch.date !== undefined) {
      clean.date = patch.date;
      clean.month = monthOf(patch.date);
    }
    if (patch.method !== undefined) clean.method = patch.method;
    if (patch.note !== undefined) clean.note = patch.note;
    updatePayment(id, clean);
    addAuditLog({
      messId,
      actorId: managerId,
      action: "edit",
      entity: "payment",
      entityId: id,
      before: { amount: before.amount, date: before.date, method: before.method, note: before.note },
      after: clean,
    });
    return { ok: true };
  }
  const before = findBazar(id);
  if (!before) return { ok: false, error: "not found" };
  const clean = {};
  if (patch.date !== undefined) clean.date = patch.date;
  if (patch.note !== undefined) clean.note = patch.note;
  if (patch.lines !== undefined) {
    clean.lines = patch.lines;
    clean.total = patch.lines.reduce((sum, line) => sum + line.amount, 0);
  }
  updateBazar(id, clean);
  addAuditLog({
    messId,
    actorId: managerId,
    action: "edit",
    entity: "bazar",
    entityId: id,
    before: { date: before.date, note: before.note, total: before.total },
    after: clean,
  });
  return { ok: true };
}

export function deleteEntry(actor, { messId, id, kind }) {
  if (!can(actor, "deleteAnyEntry")) return { ok: false, error: STRINGS.errors.notAllowed };
  const managerId = actor?.member?.id;
  const entryMonth = monthOfEntry(messId, id, kind);
  if (isMonthClosed(messId, entryMonth)) return { ok: false, error: STRINGS.errors.monthClosed };
  if (kind === "payment") {
    const before = findPayment(id);
    if (!before) return { ok: false, error: "not found" };
    return hardDeletePayment(actor, messId, id, before);
  }
  const before = findBazar(id);
  if (!before) return { ok: false, error: "not found" };
  return hardDeleteBazar(actor, messId, id, before);
}

function hardDeletePayment(actor, messId, id, before) {
  deletePayment(id);
  addAuditLog({
    messId,
    actorId: actor?.member?.id ?? null,
    action: "delete",
    entity: "payment",
    entityId: id,
    before: { amount: before.amount, date: before.date, state: before.state },
    after: null,
  });
  return { ok: true };
}

function hardDeleteBazar(actor, messId, id, before) {
  deleteBazar(id);
  addAuditLog({
    messId,
    actorId: actor?.member?.id ?? null,
    action: "delete",
    entity: "bazar",
    entityId: id,
    before: { total: before.total, date: before.date, state: before.state },
    after: null,
  });
  return { ok: true };
}

export function bulkApprove(actor, { messId, filter = {} } = {}) {
  const payments = listPayments(messId, { state: "pending", ...filter.payment });
  const bazarEntries = listBazar(messId, { state: "pending", ...filter.bazar });
  let approved = 0;
  for (const payment of payments) {
    if (isMonthClosed(messId, payment.month)) continue;
    if (applyApproval(actor, { messId, id: payment.id, kind: "payment" }).ok) approved += 1;
  }
  for (const entry of bazarEntries) {
    if (isMonthClosed(messId, monthOf(entry.date))) continue;
    if (applyApproval(actor, { messId, id: entry.id, kind: "bazar" }).ok) approved += 1;
  }
  return { ok: true, approved };
}

export function countPendingForMember(messId, memberId, month) {
  const payments = listPayments(messId, { memberId, state: "pending", month });
  const bazarEntries = listBazar(messId, { memberId, state: "pending", month });
  return payments.length + bazarEntries.length;
}

export function pendingEntries(messId, { month } = {}) {
  const payments = listPayments(messId, { state: "pending", month }).map((p) => ({ kind: "payment", entry: p }));
  const bazarEntries = listBazar(messId, { state: "pending", month }).map((b) => ({ kind: "bazar", entry: b }));
  return [...payments, ...bazarEntries].sort((a, b) => (a.entry.date < b.entry.date ? -1 : 1));
}

export function memberName(messId, memberId) {
  return getMember(memberId)?.name ?? "Unknown";
}
