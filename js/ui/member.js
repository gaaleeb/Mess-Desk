import { STRINGS } from "../strings.js";
import {
  listMeals,
  listPayments,
  listBazar,
  listMembers,
  setMealEntry,
  addAuditLog,
  isMonthClosed,
  todayISO,
  listBillItems,
  listMonthlyBills,
} from "../storage.js";
import { logout, can } from "../auth.js";
import { submitPayment, submitBazar, withdrawPayment, withdrawBazar, countPendingForMember } from "../approvals.js";
import { monthTotals, mealDebtFor, oldDateWarn, pendingBazarAmountWarn } from "../ledger.js";
import { daysInMonth } from "../calc.js";
import {
  $,
  $$,
  esc,
  fmtBDT,
  monthLabel,
  monthShift,
  renderAppNav,
  requireSession,
  showView,
  statusLineHTML,
  toast,
} from "./common.js";

const session = requireSession();
if (!session) throw new Error("redirect");
const { member, mess } = session;
const messId = mess.id;
const today = todayISO();
const thisMonth = today.slice(0, 7);
let selectedMonth = thisMonth;

$("#appnav").innerHTML = renderAppNav({ active: "member", canSeeManager: member.role === "manager" });
$("#logout-btn").addEventListener("click", (e) => {
  e.preventDefault();
  logout();
  window.location.href = "index.html";
});

function monthClosed(month) {
  return isMonthClosed(messId, month);
}

function mealsAllowed() {
  if (!can({ member, mess }, "editOwnMeals")) {
    toast(STRINGS.errors.notAllowed);
    return false;
  }
  return true;
}

function ownRow() {
  const totals = monthTotals(messId, selectedMonth);
  return { totals, row: totals.perMember.find((r) => r.member.id === member.id) };
}

function renderLedgerCards() {
  const { totals, row } = ownRow();
  $("#month-label").textContent = monthLabel(selectedMonth);
  $("#greeting").textContent = `Welcome, ${row.member.name} — ${monthLabel(selectedMonth)}`;

  $("#bills-status").innerHTML = statusLineHTML(row.billBalance, countPendingForMember(messId, member.id, selectedMonth));
  $("#bills-owed").textContent = `BDT ${fmtBDT(row.sharesOwed)}`;
  $("#bills-paid").textContent = `BDT ${fmtBDT(row.billsPaid)}`;
  const openingBills = $("#opening-bills-line");
  if (row.openingBill !== 0) {
    openingBills.hidden = false;
    openingBills.textContent = `Includes opening balance carried forward: BDT ${fmtBDT(row.openingBill)}`;
  } else {
    openingBills.hidden = true;
  }

  $("#meals-status").innerHTML = statusLineHTML(row.mealBalance, countPendingForMember(messId, member.id, selectedMonth));
  $("#meal-eaten").textContent = `BDT ${fmtBDT(row.mealCost)}`;
  $("#meal-putin").textContent = `BDT ${fmtBDT(row.contributed)}`;
  $("#provisional-tag").hidden = !totals.provisional;
  const openingMeals = $("#opening-meals-line");
  if (row.openingMeal !== 0) {
    openingMeals.hidden = false;
    openingMeals.textContent = `Includes opening balance carried forward: BDT ${fmtBDT(row.openingMeal)}`;
  } else {
    openingMeals.hidden = true;
  }

  const pending = countPendingForMember(messId, member.id, selectedMonth);
  const strip = $("#pending-strip");
  if (pending > 0) {
    strip.hidden = false;
    strip.innerHTML = `<span class="badge-pending">${pending} pending</span> waiting for the manager <button class="btn btn--ghost btn--small" id="pending-view" type="button">View</button>`;
    $("#pending-view").addEventListener("click", () => {
      showView("history");
      renderHistory();
    });
  } else {
    strip.hidden = true;
  }

  $("#next-month").disabled = selectedMonth >= thisMonth;
}

function dayName(dateISO) {
  return new Date(`${dateISO}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}

function renderMeals() {
  const closed = monthClosed(selectedMonth);
  const dim = daysInMonth(selectedMonth);
  const meals = listMeals(messId, selectedMonth).filter((m) => m.memberId === member.id);
  const byDate = new Map(meals.map((m) => [m.date, m]));
  const tbody = $("#meals-table tbody");
  tbody.innerHTML = "";
  const joinedOn = member.joinedOn ?? selectedMonth + "-01";
  for (let day = 1; day <= dim; day += 1) {
    const date = `${selectedMonth}-${String(day).padStart(2, "0")}`;
    const beforeJoin = date < joinedOn && member.status !== "requested";
    const isToday = date === today;
    const isFuture = date > today;
    const halves = byDate.get(date)?.halves ?? 0;
    const mealsValue = halves / 2;
    const tr = document.createElement("tr");
    tr.className = isToday ? "meal-row--today" : isFuture ? "meal-row--future" : "";
    const disabled = closed || beforeJoin;
    tr.innerHTML = `
      <td>${esc(date.slice(5))}</td>
      <td>${esc(dayName(date))}</td>
      <td class="num">
        <span class="meal-counter">
          <button type="button" class="meal-btn" data-delta="-1" ${disabled || halves <= 0 ? "disabled" : ""} aria-label="Less">−</button>
          <span class="meal-count">${mealsValue}</span>
          <button type="button" class="meal-btn" data-delta="1" ${disabled ? "disabled" : ""} aria-label="More">+</button>
        </span>
      </td>
      <td class="muted">${beforeJoin ? "not joined" : "saved"}</td>`;
    tr.querySelectorAll(".meal-btn").forEach((btn) => {
      btn.addEventListener("click", () => changeMeals(date, Number(btn.dataset.delta)));
    });
    tbody.appendChild(tr);
  }
  const totalHalves = meals.reduce((sum, m) => sum + m.halves, 0);
  const { totals, row } = ownRow();
  $("#total-meals").textContent = `Total meals: ${totalHalves / 2}`;
  $("#my-meal-cost").textContent = `My meal cost so far: BDT ${fmtBDT(row.mealCost)}`;
  $("#meal-rate-line").textContent = totals.noMeals ? STRINGS.status.noMeals : `Meal rate: BDT ${totals.mealRate.toFixed(2)}`;
  $("#meals-readonly-note").hidden = !closed;
  $("#meals-title").textContent = `Meals — ${monthLabel(selectedMonth)}`;
  $("#copy-yesterday").disabled = closed;
  $("#set-remaining-apply").disabled = closed;
}

function changeMeals(date, delta) {
  if (monthClosed(selectedMonth) || !mealsAllowed()) return;
  const existing = listMeals(messId, date.slice(0, 7)).find((m) => m.memberId === member.id && m.date === date);
  const before = existing?.halves ?? 0;
  const next = Math.min(20, Math.max(0, before + delta));
  if (next === before) return;
  setMealEntry({ messId, memberId: member.id, date, halves: next });
  addAuditLog({
    messId,
    actorId: member.id,
    action: "meal-edit",
    entity: "meal",
    entityId: `${member.id}:${date}`,
    before: { halves: before },
    after: { halves: next },
  });
  renderMeals();
  renderLedgerCards();
}

$("#copy-yesterday").addEventListener("click", () => {
  if (!mealsAllowed()) return;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yISO = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  if (yISO.slice(0, 7) !== selectedMonth) {
    toast("Yesterday is outside this month");
    return;
  }
  const entry = listMeals(messId, selectedMonth).find((m) => m.memberId === member.id && m.date === yISO);
  if (!entry) {
    toast("No meals yesterday to copy");
    return;
  }
  setMealEntry({ messId, memberId: member.id, date: today, halves: entry.halves });
  addAuditLog({
    messId,
    actorId: member.id,
    action: "meal-edit",
    entity: "meal",
    entityId: `${member.id}:${today}`,
    before: { halves: listMeals(messId, selectedMonth).find((m) => m.memberId === member.id && m.date === today)?.halves ?? 0 },
    after: { halves: entry.halves },
  });
  renderMeals();
  renderLedgerCards();
});

$("#set-remaining-apply").addEventListener("click", () => {
  if (!mealsAllowed()) return;
  const n = Number($("#set-remaining-n").value);
  if (!Number.isInteger(n) || n < 0 || n > 10) return;
  const dim = daysInMonth(selectedMonth);
  const startDay = selectedMonth === thisMonth ? Number(today.slice(8, 10)) : 1;
  if (!window.confirm(`Set every remaining day of ${monthLabel(selectedMonth)} to ${n} meals?`)) return;
  for (let day = startDay; day <= dim; day += 1) {
    const date = `${selectedMonth}-${String(day).padStart(2, "0")}`;
    const existing = listMeals(messId, selectedMonth).find((m) => m.memberId === member.id && m.date === date);
    const before = existing?.halves ?? 0;
    if (before === n * 2) continue;
    setMealEntry({ messId, memberId: member.id, date, halves: n * 2 });
    addAuditLog({
      messId,
      actorId: member.id,
      action: "meal-edit",
      entity: "meal",
      entityId: `${member.id}:${date}`,
      before: { halves: before },
      after: { halves: n * 2 },
    });
  }
  renderMeals();
  renderLedgerCards();
});

$("#prev-month").addEventListener("click", () => {
  const previous = monthShift(selectedMonth, -1);
  const limit = monthShift(thisMonth, -12);
  selectedMonth = previous < limit ? limit : previous;
  renderLedgerCards();
  renderMeals();
});
$("#next-month").addEventListener("click", () => {
  selectedMonth = monthShift(selectedMonth, 1);
  renderLedgerCards();
  renderMeals();
});

$("#go-pay-bills").addEventListener("click", () => {
  renderBillsView();
  showView("bills");
});
$("#go-add-bazar").addEventListener("click", () => {
  renderBazarView();
  showView("bazar");
});
$("#go-settle").addEventListener("click", () => {
  renderSettleView();
  showView("settle");
});
$("#go-history").addEventListener("click", () => {
  renderHistory();
  showView("history");
});
$$(".back-btn").forEach((btn) => btn.addEventListener("click", () => showView("dashboard")));

function dateInputBounds(input, { disallowFuture = true } = {}) {
  const joined = member.joinedOn ?? today;
  input.min = joined;
  if (disallowFuture) input.max = today;
}

function renderBillsView() {
  const items = Object.fromEntries(listBillItems(messId).map((i) => [i.id, i]));
  const bills = listMonthlyBills(messId, selectedMonth).filter((b) => b.published);
  const { totals } = ownRow();
  const shareByBillId = new Map();
  for (const row of totals.perBill) {
    shareByBillId.set(row.bill.id, { itemName: row.itemName, share: row.shares[member.id] ?? 0, amount: row.bill.amount });
  }
  const tbody = $("#my-bills-table tbody");
  tbody.innerHTML = "";
  let totalAmount = 0;
  let totalShare = 0;
  for (const bill of bills) {
    const entry = shareByBillId.get(bill.id);
    const itemName = entry?.itemName ?? items[bill.itemId]?.name ?? "?";
    const share = entry?.share ?? 0;
    totalAmount += bill.amount;
    totalShare += share;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${esc(itemName)}</td><td class="num">${fmtBDT(bill.amount)}</td><td class="num">${share ? fmtBDT(share) : "—"}</td>`;
    tbody.appendChild(tr);
  }
  $("#bills-total-amount").textContent = `BDT ${fmtBDT(totalAmount)}`;
  $("#bills-total-share").textContent = `BDT ${fmtBDT(totalShare)}`;
  $("#bills-empty").hidden = bills.length > 0;
  const amountInput = $("#pay-amount");
  amountInput.value = "";
  dateInputBounds($("#pay-date"));
  $("#pay-date").value = today;
  $("#pay-note").value = "";
  $("#pay-error").hidden = true;
  $("#pay-warning").hidden = true;
}

$("#pay-bill-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const amount = Number($("#pay-amount").value);
  const date = $("#pay-date").value;
  const note = $("#pay-note").value.trim();
  const warning = $("#pay-warning");
  const error = $("#pay-error");
  warning.hidden = true;
  error.hidden = true;
  if (!Number.isInteger(amount) || amount < 1 || amount > 10000000) {
    error.textContent = STRINGS.errors.badAmount;
    error.hidden = false;
    return;
  }
  if (!date || date > today || (member.joinedOn && date < member.joinedOn)) {
    error.textContent = STRINGS.errors.dateRange;
    error.hidden = false;
    return;
  }
  if (oldDateWarn(date, today)) {
    warning.textContent = "That date is more than 60 days ago — double-check it.";
    warning.hidden = false;
  }
  const result = submitPayment(
    { member, mess },
    { messId, memberId: member.id, ledger: "bill", kind: "payment", date, amount, method: $("#pay-method").value, note },
  );
  if (!result.ok) {
    error.textContent = result.error;
    error.hidden = false;
    return;
  }
  toast("Payment submitted for approval");
  showView("dashboard");
  renderLedgerCards();
});

const CATEGORY_KEYS = Object.keys(STRINGS.bazar.categories);
function bazarLineHTML() {
  const options = CATEGORY_KEYS.map((key) => `<option value="${key}">${esc(STRINGS.bazar.categories[key])}</option>`).join("");
  return `<div class="bazar-line">
    <select class="field select bazar-category" aria-label="Category">${options}</select>
    <span class="bazar-amount-wrap"><span class="bazar-prefix">BDT</span><input type="text" inputmode="numeric" pattern="[0-9]*" class="bazar-amount" placeholder="0" aria-label="Amount" autocomplete="off" /></span>
    <button type="button" class="btn btn--ghost btn--small bazar-remove">Remove</button>
  </div>`;
}

function readBazarLines() {
  return $$(".bazar-line", $("#bazar-lines"))
    .map((line) => {
      const raw = $(".bazar-amount", line).value.trim();
      const amount = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
      return { category: $(".bazar-category", line).value, amount };
    })
    .filter((line) => CATEGORY_KEYS.includes(line.category) && Number.isInteger(line.amount) && line.amount > 0);
}

function updateBazarTotal() {
  const total = readBazarLines().reduce((sum, line) => sum + line.amount, 0);
  $("#bazar-total").textContent = `BDT ${fmtBDT(total)}`;
}

function renderBazarView() {
  $("#bazar-lines").innerHTML = bazarLineHTML();
  dateInputBounds($("#bazar-date"));
  $("#bazar-date").value = today;
  $("#bazar-note").value = "";
  $("#bazar-error").hidden = true;
  $("#bazar-warning").hidden = true;
  updateBazarTotal();
}

$("#add-bazar-line").addEventListener("click", () => {
  $("#bazar-lines").insertAdjacentHTML("beforeend", bazarLineHTML());
});
$("#bazar-lines").addEventListener("input", updateBazarTotal);
$("#bazar-lines").addEventListener("click", (event) => {
  const remove = event.target.closest(".bazar-remove");
  if (!remove) return;
  const lines = $$(".bazar-line", $("#bazar-lines"));
  if (lines.length > 1) remove.closest(".bazar-line").remove();
  updateBazarTotal();
});

$("#bazar-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const date = $("#bazar-date").value;
  const note = $("#bazar-note").value.trim();
  const error = $("#bazar-error");
  const warning = $("#bazar-warning");
  error.hidden = true;
  warning.hidden = true;
  const lines = readBazarLines();
  if (lines.length === 0) {
    error.textContent = "Add at least one category line with an amount above 0.";
    error.hidden = false;
    return;
  }
  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  if (!Number.isInteger(total) || total < 1 || total > 10000000) {
    error.textContent = STRINGS.errors.badAmount;
    error.hidden = false;
    return;
  }
  if (!date || date > today || (member.joinedOn && date < member.joinedOn)) {
    error.textContent = STRINGS.errors.dateRange;
    error.hidden = false;
    return;
  }
  if (oldDateWarn(date, today)) {
    warning.textContent = "That date is more than 60 days ago — double-check it.";
    warning.hidden = false;
  } else {
    const own = listBazar(messId, { memberId: member.id });
    if (pendingBazarAmountWarn(total, own)) {
      warning.textContent = "That is more than 3× your usual bazar entry — double-check it.";
      warning.hidden = false;
    }
  }
  const result = submitBazar({ member, mess }, { messId, memberId: member.id, date, note, lines });
  if (!result.ok) {
    error.textContent = result.error;
    error.hidden = false;
    return;
  }
  toast("Bazar cost submitted for approval");
  showView("dashboard");
  renderLedgerCards();
});

function renderSettleView() {
  const debt = mealDebtFor(messId, selectedMonth, member.id);
  $("#settle-debt-line").textContent = debt > 0 ? `Your current meal debt: BDT ${fmtBDT(debt)}` : "You have no meal debt right now.";
  const select = $("#settle-paid-to");
  select.innerHTML = listMembers(messId)
    .filter((m) => m.id !== member.id && m.status === "active" && m.takesPart)
    .map((m) => `<option value="${m.id}">${esc(m.name)}</option>`)
    .join("");
  $("#settle-amount").value = "";
  $("#settle-amount").max = String(debt);
  dateInputBounds($("#settle-date"));
  $("#settle-date").value = today;
  $("#settle-error").hidden = true;
  $("#settle-submit").disabled = debt <= 0 || !select.options.length;
  if (!select.options.length) {
    $("#settle-error").textContent = "No other active members to settle with.";
    $("#settle-error").hidden = false;
  }
}

$("#settle-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const debt = mealDebtFor(messId, selectedMonth, member.id);
  const amount = Number($("#settle-amount").value);
  const paidTo = $("#settle-paid-to").value;
  const date = $("#settle-date").value;
  const error = $("#settle-error");
  error.hidden = true;
  if (!Number.isInteger(amount) || amount < 1) {
    error.textContent = STRINGS.errors.badAmount;
    error.hidden = false;
    return;
  }
  if (amount > debt) {
    error.textContent = STRINGS.errors.settlementTooBig;
    error.hidden = false;
    return;
  }
  if (!date || date > today || (member.joinedOn && date < member.joinedOn)) {
    error.textContent = STRINGS.errors.dateRange;
    error.hidden = false;
    return;
  }
  const result = submitPayment(
    { member, mess },
    { messId, memberId: member.id, ledger: "meal", kind: "settlement", paidTo, date, amount, method: "transfer", note: "settle meal balance" },
  );
  if (!result.ok) {
    error.textContent = result.error;
    error.hidden = false;
    return;
  }
  toast("Settlement submitted for approval");
  showView("dashboard");
  renderLedgerCards();
});

function stateCell(entry) {
  const label = { pending: "pending", approved: "approved", rejected: "rejected", withdrawn: "withdrawn" }[entry.state] ?? entry.state;
  const note = entry.reviewNote && entry.state === "rejected" ? `<br><span class="muted">Reason: ${esc(entry.reviewNote)}</span>` : entry.reviewNote === "self-approved" ? '<br><span class="muted">self-approved</span>' : "";
  return `${esc(label)}${note}`;
}

function withdrawCell(kind, entry) {
  return entry.state === "pending" ? `<button class="btn btn--ghost btn--small withdraw-btn" data-kind="${kind}" data-id="${entry.id}" type="button">Withdraw</button>` : "";
}

function renderHistory() {
  const months = [];
  for (let k = 5; k >= 0; k -= 1) months.push(monthShift(thisMonth, -k));
  const tbody = $("#history-table tbody");
  tbody.innerHTML = "";
  for (const month of months) {
    const totals = monthTotals(messId, month);
    const row = totals.perMember.find((r) => r.member.id === member.id);
    if (!row) continue;
    const closing = row.billBalance + row.mealBalance;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${esc(month)}</td><td class="num">${fmtBDT(row.sharesOwed)}</td><td class="num">${fmtBDT(row.billsPaid)}</td><td class="num">${row.meals}</td><td class="num">${fmtBDT(row.mealCost)}</td><td class="num">${fmtBDT(row.bazar)}</td><td class="num">${fmtBDT(closing)}</td>`;
    tbody.appendChild(tr);
  }

  const payments = listPayments(messId, { memberId: member.id }).sort((a, b) => (a.date < b.date ? 1 : -1));
  const paymentsBody = $("#my-payments-table tbody");
  paymentsBody.innerHTML = payments
    .map((p) => {
      const ledgerLabel = p.kind === "settlement" ? "Meal settlement" : p.ledger === "bill" ? "Bills" : "Meal fund";
      return `<tr><td>${esc(p.date)}</td><td class="num">${fmtBDT(p.amount)}<br><span class="muted">${esc(ledgerLabel)}</span></td><td>${stateCell(p)}</td><td>${withdrawCell("payment", p)}</td></tr>`;
    })
    .join("");
  $("#payments-empty").hidden = payments.length > 0;

  const bazarEntries = listBazar(messId, { memberId: member.id }).sort((a, b) => (a.date < b.date ? 1 : -1));
  const bazarBody = $("#my-bazar-table tbody");
  bazarBody.innerHTML = bazarEntries
    .map((entry) => {
      const cats = (entry.lines ?? []).map((l) => STRINGS.bazar.categories[l.category] ?? l.category).join(", ");
      return `<tr><td>${esc(entry.date)}</td><td>${esc(cats)}</td><td class="num">${fmtBDT(entry.total)}</td><td>${stateCell(entry)}</td><td>${withdrawCell("bazar", entry)}</td></tr>`;
    })
    .join("");
  $("#bazar-empty").hidden = bazarEntries.length > 0;

  const meals = listMeals(messId, thisMonth).filter((m) => m.memberId === member.id);
  const mealsBody = $("#my-meals-table tbody");
  mealsBody.innerHTML = meals
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((m) => `<tr><td>${esc(m.date)}</td><td class="num">${m.halves / 2}</td></tr>`)
    .join("");
  $("#meals-empty").hidden = meals.length > 0;

  $$(".withdraw-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const { kind, id } = btn.dataset;
      const result = kind === "payment" ? withdrawPayment({ member, mess }, id) : withdrawBazar({ member, mess }, id);
      if (result.ok) {
        toast("Entry withdrawn");
        renderHistory();
        renderLedgerCards();
      } else {
        toast(result.error);
      }
    });
  });
}

renderLedgerCards();
renderMeals();
