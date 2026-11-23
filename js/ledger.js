import {
  listMembers,
  listMonthlyBills,
  listPayments,
  listBazar,
  listMeals,
  listBillItems,
  listMonthCloses,
  getLastClosedMonthBefore,
  isMonthClosed,
  nowISO,
} from "./storage.js";
import {
  equalSplit,
  percentSplit,
  amountSplit,
  distribute,
  mealRate,
  mealBalance,
  billBalance,
  daysInMonth,
} from "./calc.js";
export function takesPartOn(member, month) {
  const history = [...(member.takesPartHistory ?? [])].sort((a, b) => (a.from < b.from ? -1 : 1));
  let value = member.takesPart === true;
  for (const entry of history) {
    if (entry.from <= month) value = entry.value === true;
  }
  return value;
}

export function participantsFor(members, month) {
  const monthEnd = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  const monthStart = `${month}-01`;
  return members.filter((m) => {
    if (m.status === "requested") return false;
    if (!m.joinedOn || m.joinedOn > monthEnd) return false;
    if (m.leftOn && m.leftOn < monthStart) return false;
    return takesPartOn(m, month);
  });
}

export function billSharesForBill(bill, participants, month) {
  const items = participants;
  if (bill.splitMode === "percent") {
    const percents = {};
    for (const split of bill.splits ?? []) percents[split.memberId] = Number(split.value) || 0;
    return percentSplit(bill.amount, items, percents);
  }
  if (bill.splitMode === "amount") {
    const amounts = {};
    for (const split of bill.splits ?? []) amounts[split.memberId] = Number(split.value) || 0;
    return amountSplit(items, amounts);
  }
  return equalSplit(bill.amount, items, month);
}

export function monthSettlements(messId, month, memberId) {
  const paid = listPayments(messId, { month, memberId, state: "approved", ledger: "meal" }).filter(
    (p) => p.kind === "settlement",
  );
  const received = listPayments(messId, { month, state: "approved", ledger: "meal" }).filter(
    (p) => p.kind === "settlement" && p.paidTo === memberId,
  );
  return {
    paid: paid.reduce((sum, p) => sum + p.amount, 0),
    received: received.reduce((sum, p) => sum + p.amount, 0),
  };
}

export function monthTotals(messId, month) {
  const members = listMembers(messId);
  const participants = participantsFor(members, month);
  const participantIds = new Set(participants.map((m) => m.id));
  const items = Object.fromEntries(listBillItems(messId).map((i) => [i.id, i]));

  const bills = listMonthlyBills(messId, month).filter((b) => b.published);
  const shares = {};
  for (const id of participantIds) shares[id] = 0;
  const perBill = [];
  for (const bill of bills) {
    const billShares = billSharesForBill(bill, participants, month);
    for (const { memberId, share } of billShares) {
      shares[memberId] = (shares[memberId] ?? 0) + share;
    }
    perBill.push({
      bill,
      itemName: items[bill.itemId]?.name ?? "?",
      shares: Object.fromEntries(billShares.map((s) => [s.memberId, s.share])),
    });
  }

  const billPayments = listPayments(messId, { month, state: "approved", ledger: "bill" }).filter(
    (p) => p.kind === "payment",
  );
  const paidByMember = {};
  for (const payment of billPayments) {
    paidByMember[payment.memberId] = (paidByMember[payment.memberId] ?? 0) + payment.amount;
  }

  const meals = listMeals(messId, month);
  const halvesByMember = {};
  for (const participant of participants) halvesByMember[participant.id] = 0;
  for (const row of meals) {
    if (participantIds.has(row.memberId)) {
      halvesByMember[row.memberId] = (halvesByMember[row.memberId] ?? 0) + row.halves;
    }
  }

  const bazarEntries = listBazar(messId, { month, state: "approved" });
  const bazarByMember = {};
  for (const participant of participants) bazarByMember[participant.id] = 0;
  let bazarTotal = 0;
  for (const entry of bazarEntries) {
    bazarTotal += entry.total;
    if (participantIds.has(entry.memberId)) {
      bazarByMember[entry.memberId] = (bazarByMember[entry.memberId] ?? 0) + entry.total;
    }
  }

  const orderedParticipants = participants;
  const halvesList = orderedParticipants.map((m) => halvesByMember[m.id]);
  const totalHalves = halvesList.reduce((sum, h) => sum + h, 0);
  const costs = distribute(bazarTotal, halvesList);
  const costByMember = {};
  orderedParticipants.forEach((member, index) => {
    costByMember[member.id] = costs[index];
  });

  const lastClose = getLastClosedMonthBefore(messId, month);
  const openingByMember = {};
  for (const row of lastClose?.closing ?? []) {
    openingByMember[row.memberId] = { bill: row.billBalance, meal: row.mealBalance };
  }

  const settlements = {};
  for (const member of members) {
    settlements[member.id] = monthSettlements(messId, month, member.id);
  }

  const perMember = members.map((member) => {
    const participant = participantIds.has(member.id);
    const opening = openingByMember[member.id] ?? { bill: 0, meal: 0 };
    const sharesOwed = shares[member.id] ?? 0;
    const billsPaid = paidByMember[member.id] ?? 0;
    const settlement = settlements[member.id] ?? { paid: 0, received: 0 };
    const halves = halvesByMember[member.id] ?? 0;
    const bazar = bazarByMember[member.id] ?? 0;
    const mealCost = costByMember[member.id] ?? 0;
    const balance = mealBalance(mealCost, bazar, settlement.paid, settlement.received) + opening.meal;
    const billBal = billBalance(sharesOwed, billsPaid, opening.bill);
    const contributed = bazar + settlement.paid;
    return {
      member,
      participant,
      sharesOwed,
      billsPaid,
      openingBill: opening.bill,
      openingMeal: opening.meal,
      billBalance: billBal,
      halves,
      meals: halves / 2,
      mealCost,
      bazar,
      settlementsPaid: settlement.paid,
      settlementsReceived: settlement.received,
      contributed,
      mealBalance: balance,
    };
  });

  const publishedBillTotal = bills.reduce((sum, b) => sum + b.amount, 0);
  const sumBillShares = orderedParticipants.reduce((sum, m) => sum + (shares[m.id] ?? 0), 0);
  const sumMealBalances = perMember.reduce((sum, row) => (row.participant ? sum + row.mealBalance : sum), 0);
  const numbersOk = sumBillShares === publishedBillTotal && sumMealBalances === 0;

  const rate = mealRate(bazarTotal, halvesList);

  return {
    month,
    members,
    participants: orderedParticipants,
    perMember,
    perBill,
    publishedBillTotal,
    sumBillShares,
    sumMealBalances,
    numbersOk,
    bazarTotal,
    totalHalves,
    totalMeals: totalHalves / 2,
    mealRate: rate,
    closed: isMonthClosed(messId, month),
    provisional: !isMonthClosed(messId, month),
    lastCloseMonth: lastClose?.month ?? null,
    noMeals: totalHalves === 0,
  };
}

export function mealDebtFor(messId, month, memberId) {
  const totals = monthTotals(messId, month);
  const row = totals.perMember.find((r) => r.member.id === memberId);
  return row ? Math.max(0, row.mealBalance) : 0;
}

export function closingSnapshot(messId, month) {
  const totals = monthTotals(messId, month);
  return {
    messId,
    month,
    lockedAt: nowISO(),
    closing: totals.perMember.map((row) => ({
      memberId: row.member.id,
      billBalance: row.billBalance,
      mealBalance: row.mealBalance,
    })),
    mealRate: totals.mealRate,
    totalMeals: totals.totalMeals,
    bazarTotal: totals.bazarTotal,
    publishedBillTotal: totals.publishedBillTotal,
  };
}

export function pendingBazarAmountWarn(entryTotal, previousEntries) {
  if (previousEntries.length === 0) return false;
  const avg = previousEntries.reduce((sum, e) => sum + e.total, 0) / previousEntries.length;
  return entryTotal > 3 * avg;
}

export function oldDateWarn(dateISO, todayISO) {
  const then = new Date(`${dateISO}T00:00:00`);
  const now = new Date(`${todayISO}T00:00:00`);
  return (now - then) / 86400000 > 60;
}

export function monthHealth(messId, month) {
  const closes = listMonthCloses(messId).map((c) => c.month).sort();
  return { closedMonths: closes, currentClosed: closes.includes(month) };
}
