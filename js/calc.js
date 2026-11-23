import { STRINGS } from "./strings.js";

export function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function daysInMonth(month) {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) throw new Error(`Invalid month: ${month}`);
  return m === 2 && isLeapYear(y) ? 29 : DAYS_IN_MONTH[m - 1];
}

function dayOfMonth(isoDate) {
  return Number(isoDate.slice(8, 10));
}

export function prorationFactor(joinedOn, leftOn, month) {
  const dim = daysInMonth(month);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(dim).padStart(2, "0")}`;
  const start = joinedOn > monthStart ? joinedOn : monthStart;
  const end = leftOn && leftOn < monthEnd ? leftOn : monthEnd;
  if (start > end) return 0;
  return (dayOfMonth(end) - dayOfMonth(start) + 1) / dim;
}

const EPS = 1e-9;

export function distribute(total, weights) {
  if (!Number.isInteger(total)) throw new Error("Total must be an integer");
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sumW);
  const shares = raw.map((r) => Math.floor(r + EPS));
  let leftover = total - shares.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r + EPS) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  let k = 0;
  while (leftover > 0) {
    shares[order[k % order.length].i] += 1;
    leftover -= 1;
    k += 1;
  }
  return shares;
}

export function equalSplit(amount, members, month) {
  const weights = members.map((m) => prorationFactor(m.joinedOn, m.leftOn ?? null, month));
  const shares = distribute(amount, weights);
  return members.map((m, i) => ({ memberId: m.id, share: shares[i] }));
}

export function percentSplit(amount, members, percents) {
  const weights = members.map((m) => Number(percents?.[m.id] ?? 0));
  const shares = distribute(amount, weights);
  return members.map((m, i) => ({ memberId: m.id, share: shares[i] }));
}

export function amountSplit(members, amounts) {
  return members.map((m) => ({ memberId: m.id, share: Math.floor(Number(amounts?.[m.id] ?? 0)) }));
}

export function validatePercentSplit(percents) {
  const values = Object.values(percents);
  if (values.some((v) => !Number.isInteger(Number(v)))) {
    return { ok: false, message: STRINGS.errors.percentSum };
  }
  const sum = values.reduce((a, b) => a + Number(b), 0);
  if (sum !== 100) return { ok: false, message: STRINGS.errors.percentSum };
  return { ok: true };
}

export function validateAmountSplit(amounts, total) {
  const sum = Object.values(amounts).reduce((a, b) => a + Number(b), 0);
  if (sum !== total) return { ok: false, message: STRINGS.errors.amountSum };
  return { ok: true };
}

export function mealCosts(totalBazar, halves) {
  if (!Number.isInteger(totalBazar)) throw new Error("Bazar total must be an integer");
  return distribute(totalBazar, halves);
}

export function totalHalves(halves) {
  return halves.reduce((a, b) => a + b, 0);
}

export function mealRate(totalBazar, halves) {
  const th = totalHalves(halves);
  if (th === 0) return null;
  return Math.round((totalBazar / (th / 2)) * 100) / 100;
}

export function mealBalance(mealCost, contributed, settlementsPaid = 0, settlementsReceived = 0) {
  return mealCost - contributed - settlementsPaid + settlementsReceived;
}

export function billBalance(sharesOwed, approvedPayments, openingBalance = 0) {
  return sharesOwed + openingBalance - approvedPayments;
}

export function settlementBalanceAfter(balance, amount, direction) {
  return direction === "paid" ? balance - amount : balance + amount;
}

export function formatTaka(n) {
  return Math.abs(Math.trunc(n)).toLocaleString("en-IN");
}

export function statusFor(balance, pendingCount = 0) {
  let color, text;
  if (balance > 0) {
    color = "red";
    text = STRINGS.status.due(formatTaka(balance));
  } else if (balance === 0) {
    color = "green";
    text = STRINGS.status.clear;
  } else {
    color = "blue";
    text = STRINGS.status.ahead(formatTaka(balance));
  }
  return { color, text, pending: pendingCount };
}
