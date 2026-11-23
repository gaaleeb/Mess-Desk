import { STRINGS } from "../strings.js";
import {
  listMembers,
  listPayments,
  listBazar,
  listMeals,
  listAuditLog,
  listBillItems,
  addBillItem,
  updateBillItem,
  deleteBillItem,
  listMonthlyBills,
  addMonthlyBill,
  updateMonthlyBill,
  isBillItemUsed,
  addMonthClose,
  deleteMonthClose,
  getMonthClose,
  listMonthCloses,
  addAuditLog,
  updateMember,
  addMember,
  deleteMember,
  setMealEntry,
  isMonthClosed,
  todayISO,
} from "../storage.js";
import { logout, createPasswordEntry, can } from "../auth.js";
import {
  approveEntry,
  rejectEntry,
  editEntry,
  deleteEntry,
  pendingEntries,
  countPendingForMember,
  memberName,
} from "../approvals.js";
import {
  monthTotals,
  closingSnapshot,
  participantsFor,
} from "../ledger.js";
import {
  validatePercentSplit,
  validateAmountSplit,
  daysInMonth,
} from "../calc.js";
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
  csvEscape,
  downloadFile,
  toast,
} from "./common.js";

const session = requireSession();
if (!session) throw new Error("redirect");
const { member, mess } = session;
if (member.role !== "manager") {
  window.location.href = "member.html";
}
const messId = mess.id;
const today = todayISO();
const thisMonth = today.slice(0, 7);
let selectedMonth = thisMonth;
let detailMemberId = null;
let sortKey = "name";
let sortDir = 1;
let behindOnly = false;
let splitBillId = null;

$("#appnav").innerHTML = renderAppNav({ active: "manager", canSeeManager: true });
$("#logout-btn").addEventListener("click", (e) => {
  e.preventDefault();
  logout();
  window.location.href = "index.html";
});

function membersMap() {
  return Object.fromEntries(listMembers(messId).map((m) => [m.id, m]));
}

function nameOf(id) {
  return memberName(messId, id);
}

function requireCan(action) {
  if (!can({ member, mess }, action)) {
    toast(STRINGS.errors.notAllowed);
    return false;
  }
  return true;
}
function activateTab(name) {
  $$("#manager-tabs .tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.tab === name));
  showView(name);
  if (name === "bills") renderBills();
  if (name === "members") renderMembers();
  if (name === "report") renderReport();
  if (name === "settings") renderSettings();
  if (name === "member-detail") renderMemberDetail();
}
$$("#manager-tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab));
});

$("#prev-month").addEventListener("click", () => {
  selectedMonth = monthShift(selectedMonth, -1);
  renderAll();
});
$("#next-month").addEventListener("click", () => {
  if (selectedMonth >= thisMonth) return;
  selectedMonth = monthShift(selectedMonth, 1);
  renderAll();
});

function renderTiles(totals) {
  const collected = listPayments(messId, { month: selectedMonth, state: "approved", ledger: "bill" })
    .filter((p) => p.kind === "payment")
    .reduce((sum, p) => sum + p.amount, 0);
  const pendingCount = pendingEntries(messId, { month: selectedMonth }).length;
  const tiles = [
    ["Bills due", `BDT ${fmtBDT(totals.publishedBillTotal)}`],
    ["Collected", `BDT ${fmtBDT(collected)}`],
    ["Meal rate", totals.noMeals ? STRINGS.status.noMeals : `BDT ${totals.mealRate.toFixed(2)}${totals.provisional ? " (provisional)" : ""}`],
    ["Bazar total", `BDT ${fmtBDT(totals.bazarTotal)}`],
    ["Total meals", String(totals.totalMeals)],
    ["Pending", String(pendingCount)],
  ];
  $("#summary-tiles").innerHTML = tiles
    .map(([label, value]) => `<div class="tile"><div class="tile-label">${esc(label)}</div><div class="tile-value">${esc(value)}</div></div>`)
    .join("");
}

function renderNumbersCheck(totals) {
  const el = $("#numbers-check");
  if (totals.numbersOk) {
    el.className = "ok-strip";
    el.textContent = "Numbers check OK";
  } else {
    el.className = "notice";
    el.textContent = `Numbers do not add up — bill shares sum to ${fmtBDT(totals.sumBillShares)} vs ${fmtBDT(totals.publishedBillTotal)} published, meal balances sum to ${fmtBDT(totals.sumMealBalances)}.`;
  }
}

function renderJoinRequests() {
  const requested = listMembers(messId).filter((m) => m.status === "requested");
  const box = $("#join-requests");
  if (requested.length === 0) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  $("#join-requests-list").innerHTML = requested
    .map(
      (m) => `<div class="approval-main" style="padding: 6px 0"><span><strong>${esc(m.name)}</strong> wants to join</span>
        <span class="row">
          <button class="btn btn--ghost btn--small accept-join" data-id="${m.id}" type="button">Accept</button>
          <button class="btn btn--ghost btn--small decline-join" data-id="${m.id}" type="button">Decline</button>
        </span></div>`,
    )
    .join("");
  $$(".accept-join", box).forEach((btn) =>
    btn.addEventListener("click", () => {
      updateMember(btn.dataset.id, { status: "active", joinedOn: today });
      addAuditLog({ messId, actorId: member.id, action: "join-accept", entity: "member", entityId: btn.dataset.id, before: { status: "requested" }, after: { status: "active", joinedOn: today } });
      toast("Member accepted");
      renderAll();
    }),
  );
  $$(".decline-join", box).forEach((btn) =>
    btn.addEventListener("click", () => {
      const target = listMembers(messId).find((m) => m.id === btn.dataset.id);
      deleteMember(btn.dataset.id);
      addAuditLog({ messId, actorId: member.id, action: "join-decline", entity: "member", entityId: btn.dataset.id, before: { name: target?.name }, after: null });
      toast("Request declined");
      renderAll();
    }),
  );
}

function settlementLabel(p) {
  const to = p.paidTo ? nameOf(p.paidTo) : "?";
  return `Settlement → ${to}`;
}

function entryDescription(kind, entry) {
  if (kind === "payment") {
    return entry.kind === "settlement" ? settlementLabel(entry) : `Paid BDT ${fmtBDT(entry.amount)} (${entry.ledger === "bill" ? "bills" : "meal fund"})`;
  }
  const cats = (entry.lines ?? []).map((l) => STRINGS.bazar.categories[l.category] ?? l.category).join(", ");
  return `Bazar BDT ${fmtBDT(entry.total)} (${cats})`;
}

function filterControls() {
  return {
    type: $("#filter-type").value,
    memberId: $("#filter-member").value,
    date: $("#filter-date").value,
  };
}

function renderApprovals() {
  const all = pendingEntries(messId, { month: selectedMonth });
  const map = membersMap();
  const memberFilter = $("#filter-member");
  const currentValue = memberFilter.value;
  memberFilter.innerHTML =
    `<option value="">All members</option>` +
    listMembers(messId)
      .map((m) => `<option value="${m.id}">${esc(m.name)}</option>`)
      .join("");
  memberFilter.value = currentValue;

  const { type, memberId, date } = filterControls();
  const shown = all.filter(({ kind, entry }) => {
    if (type === "payment" && !(kind === "payment" && entry.kind === "payment")) return false;
    if (type === "settlement" && !(kind === "payment" && entry.kind === "settlement")) return false;
    if (type === "bazar" && kind !== "bazar") return false;
    if (memberId && entry.memberId !== memberId) return false;
    if (date && entry.date !== date) return false;
    return true;
  });
  $("#approvals-count").textContent = String(shown.length);
  $("#approve-all-shown").disabled = shown.length === 0;
  const list = $("#approvals-list");
  list.innerHTML = shown
    .map(
      ({ kind, entry }) => `<div class="approval-row" data-kind="${kind}" data-id="${entry.id}">
        <div class="approval-main">
          <div>
            <strong>${esc(map[entry.memberId]?.name ?? "?")}</strong> — ${esc(entryDescription(kind, entry))}<br />
            <span class="muted">${esc(entry.date)} · ${kind === "bazar" ? "bazar" : entry.kind}</span>
          </div>
          <div class="row">
            <strong style="font-family: var(--font-num)">BDT ${fmtBDT(kind === "bazar" ? entry.total : entry.amount)}</strong>
            <button class="btn btn--ghost btn--small" data-action="ok" type="button">OK</button>
            <button class="btn btn--ghost btn--small" data-action="edit" type="button">Edit</button>
            <button class="btn btn--ghost btn--small" data-action="show-reject" type="button">No</button>
          </div>
        </div>
        <div class="approval-edit" hidden>
          <input type="number" class="field edit-amount" min="1" step="1" value="${kind === "bazar" ? entry.total : entry.amount}" aria-label="Amount" />
          <input type="date" class="field edit-date" value="${esc(entry.date)}" aria-label="Date" />
          <button class="btn btn--ghost btn--small" data-action="save" type="button">Save</button>
          <button class="btn btn--small" data-action="save-approve" type="button">Save &amp; approve</button>
          ${kind === "bazar" ? '<span class="muted">Editing a bazar entry replaces category lines with one line.</span>' : ""}
        </div>
        <div class="approval-edit reject-row" hidden>
          <input type="text" class="field reject-reason" placeholder="Reason (at least 3 characters)" minlength="3" aria-label="Rejection reason" />
          <button class="btn btn--danger btn--small" data-action="reject" type="button">Reject</button>
        </div>
      </div>`,
    )
    .join("");
  $("#approvals-empty").hidden = shown.length > 0;
}

$("#filter-type").addEventListener("change", renderApprovals);
$("#filter-member").addEventListener("change", renderApprovals);
$("#filter-date").addEventListener("change", renderApprovals);
$("#clear-filters").addEventListener("click", () => {
  $("#filter-type").value = "all";
  $("#filter-member").value = "";
  $("#filter-date").value = "";
  renderApprovals();
});
$("#copy-mess-id").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(mess.publicId);
    toast(STRINGS.copied);
  } catch {
    toast(mess.publicId);
  }
});

$("#approvals-list").addEventListener("click", (event) => {
  const actionEl = event.target.closest("[data-action]");
  if (!actionEl) return;
  const row = actionEl.closest(".approval-row");
  const { kind, id } = row.dataset;
  const action = actionEl.dataset.action;
  if (action === "ok") {
    const res = approveEntry({ member, mess }, { messId, id, kind });
    toast(res.ok ? "Approved" : res.error);
    renderAll();
    return;
  }
  if (action === "edit") {
    $(".approval-edit:not(.reject-row)", row).hidden = !$(".approval-edit:not(.reject-row)", row).hidden;
    return;
  }
  if (action === "show-reject") {
    $(".reject-row", row).hidden = !$(".reject-row", row).hidden;
    return;
  }
  if (action === "save" || action === "save-approve") {
    const amount = Number($(".edit-amount", row).value);
    const date = $(".edit-date", row).value;
    if (!Number.isInteger(amount) || amount < 1) {
      toast(STRINGS.errors.badAmount);
      return;
    }
    let patch;
    if (kind === "bazar") {
      patch = { date, lines: [{ category: "others", amount }] };
    } else {
      patch = { amount, date };
    }
    const saved = editEntry({ member, mess }, { messId, id, kind, patch });
    if (!saved.ok) {
      toast(saved.error);
      return;
    }
    if (action === "save-approve") {
      const approved = approveEntry({ member, mess }, { messId, id, kind });
      toast(approved.ok ? "Saved and approved" : approved.error);
    } else {
      toast("Saved");
    }
    renderAll();
    return;
  }
  if (action === "reject") {
    const reason = $(".reject-reason", row).value;
    const res = rejectEntry({ member, mess }, { messId, id, kind, reason });
    toast(res.ok ? "Rejected" : res.error);
    renderAll();
  }
});

$("#approve-all-shown").addEventListener("click", () => {
  const rows = $$("#approvals-list .approval-row");
  let approved = 0;
  for (const row of rows) {
    const res = approveEntry({ member, mess }, { messId, id: row.dataset.id, kind: row.dataset.kind });
    if (res.ok) approved += 1;
  }
  toast(`${approved} approved`);
  renderAll();
});

function statusMini(balance) {
  if (balance > 0) return `<span class="status-mini status-mini--red">BDT ${fmtBDT(balance)} due</span>`;
  if (balance < 0) return `<span class="status-mini status-mini--blue">BDT ${fmtBDT(-balance)} ahead</span>`;
  return `<span class="status-mini status-mini--green">Clear</span>`;
}

function renderGrid() {
  const totals = monthTotals(messId, selectedMonth);
  let rows = totals.perMember.filter((r) => r.participant);
  if (behindOnly) rows = rows.filter((r) => r.billBalance > 0 || r.mealBalance > 0);
  rows.sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === "string") return sortDir * av.localeCompare(bv);
    return sortDir * (av - bv);
  });
  const tbody = $("#member-grid tbody");
  tbody.innerHTML = rows
    .map(
      (r) => `<tr>
        <td>${esc(r.member.name)}${r.member.role === "manager" ? ' <span class="muted">(manager)</span>' : ""}</td>
        <td class="num">${fmtBDT(r.sharesOwed)}</td>
        <td class="num">${fmtBDT(r.billsPaid)}</td>
        <td>${statusMini(r.billBalance)}</td>
        <td class="num">${r.meals}</td>
        <td class="num">${fmtBDT(r.mealCost)}</td>
        <td>${statusMini(r.mealBalance)}</td>
        <td>
          <button class="icon-btn expand-btn" data-id="${r.member.id}" type="button" aria-label="Bills breakdown">bills</button>
          <button class="icon-btn detail-btn" data-id="${r.member.id}" type="button">detail</button>
        </td>
      </tr>
      <tr class="expand-row" data-for="${r.member.id}" hidden><td colspan="8">${perBillBreakdown(totals, r.member.id)}</td></tr>`,
    )
    .join("");
  tbody.querySelectorAll(".expand-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      const target = tbody.querySelector(`.expand-row[data-for="${btn.dataset.id}"]`);
      target.hidden = !target.hidden;
    }),
  );
  tbody.querySelectorAll(".detail-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      detailMemberId = btn.dataset.id;
      $("#tab-member-detail").hidden = false;
      activateTab("member-detail");
    }),
  );
}

function perBillBreakdown(totals, memberId) {
  if (totals.perBill.length === 0) return "No published bills this month.";
  const rows = totals.perBill
    .map((row) => `<div>${esc(row.itemName)}: <strong>${fmtBDT(row.shares[memberId] ?? 0)}</strong> / BDT ${fmtBDT(row.bill.amount)} (${row.bill.splitMode})</div>`)
    .join("");
  return `<div class="stack" style="gap: 4px; padding: 6px 0">${rows}</div>`;
}

$$(".th-sort").forEach((btn) =>
  btn.addEventListener("click", () => {
    if (sortKey === btn.dataset.sort) sortDir *= -1;
    else {
      sortKey = btn.dataset.sort;
      sortDir = 1;
    }
    renderGrid();
  }),
);
$("#behind-only").addEventListener("change", (e) => {
  behindOnly = e.target.checked;
  renderGrid();
});

function renderAll() {
  const totals = monthTotals(messId, selectedMonth);
  $("#month-label").textContent = monthLabel(selectedMonth);
  $("#next-month").disabled = selectedMonth >= thisMonth;
  $("#mess-title").textContent = `${mess.name} (${mess.publicId})`;
  renderTiles(totals);
  renderNumbersCheck(totals);
  renderJoinRequests();
  renderApprovals();
  renderGrid();
}

function renderBills() {
  const closed = isMonthClosed(messId, selectedMonth);
  $("#bills-month-note").textContent = closed
    ? `${monthLabel(selectedMonth)} is closed. Amounts are read-only.`
    : `${monthLabel(selectedMonth)} — not published yet means members cannot see it.`;

  const items = listBillItems(messId);
  const itemsById = Object.fromEntries(items.map((i) => [i.id, i]));
  const templateBody = $("#template-table tbody");
  templateBody.innerHTML = items
    .map(
      (item) => `<tr data-id="${item.id}">
        <td><input type="text" class="field tpl-name" value="${esc(item.name)}" maxlength="40" aria-label="Item name" /></td>
        <td class="num"><input type="number" class="field tpl-amount" min="0" step="1" inputmode="numeric" value="${item.defaultAmount}" aria-label="Default amount" style="width: 120px" /></td>
        <td><button class="icon-btn delete-item" type="button">Remove</button></td>
      </tr>`,
    )
    .join("");
  templateBody.querySelectorAll(".tpl-name").forEach((input) => {
    let lastValid = input.value;
    input.addEventListener("change", () => {
      if (!requireCan("setBillTemplate")) return;
      const row = input.closest("tr");
      const id = row.dataset.id;
      const name = input.value.trim();
      if (name.length < 1 || name.length > 40) {
        input.value = lastValid;
        toast(STRINGS.errors.required);
        return;
      }
      if (name === lastValid) return;
      updateBillItem(id, { name });
      addAuditLog({ messId, actorId: member.id, action: "template-edit", entity: "billItem", entityId: id, before: { name: lastValid }, after: { name } });
      lastValid = name;
      toast("Template updated");
    });
  });
  templateBody.querySelectorAll(".tpl-amount").forEach((input) =>
    input.addEventListener("change", () => {
      if (!requireCan("setBillTemplate")) return;
      const row = input.closest("tr");
      const id = row.dataset.id;
      const amount = Math.max(0, Math.floor(Number(input.value) || 0));
      if (String(amount) !== input.value) input.value = String(amount);
      const before = listBillItems(messId).find((i) => i.id === id);
      if (Number(before?.defaultAmount) === amount) return;
      updateBillItem(id, { defaultAmount: amount });
      addAuditLog({ messId, actorId: member.id, action: "template-edit", entity: "billItem", entityId: id, before: { defaultAmount: before?.defaultAmount }, after: { defaultAmount: amount } });
      toast("Template updated");
    }),
  );
  templateBody.querySelectorAll(".delete-item").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (!requireCan("setBillTemplate")) return;
      const id = btn.closest("tr").dataset.id;
      if (isBillItemUsed(id)) {
        toast("Used by this month's bills — remove the bill row first");
        return;
      }
      deleteBillItem(id);
      toast("Item removed from template");
      renderBills();
    }),
  );

  const bills = listMonthlyBills(selectedMonth);
  const generated = bills.length > 0;
  $("#generate-bills").hidden = generated;
  $("#bills-month-empty").hidden = generated;
  $("#monthly-bills-table").hidden = !generated;
  $("#publish-bills").hidden = !generated || bills.every((b) => b.published);

  const tbody = $("#monthly-bills-table tbody");
  tbody.innerHTML = bills
    .map((bill) => {
      const item = itemsById[bill.itemId];
      const splitLabel = bill.splitMode === "equal" ? "Equal" : bill.splitMode === "percent" ? "Percent" : "Amounts";
      return `<tr data-id="${bill.id}">
        <td>${esc(item?.name ?? "?")}${bill.published ? ' <span class="tag">published</span>' : ""}</td>
        <td class="num"><input type="number" class="field bill-amount" min="0" step="1" value="${bill.amount}" ${closed ? "disabled" : ""} style="width: 120px" /></td>
        <td>${esc(splitLabel)} <button class="icon-btn edit-split" type="button" ${closed ? "disabled" : ""}>Edit</button></td>
        <td></td>
      </tr>`;
    })
    .join("");
  tbody.querySelectorAll(".bill-amount").forEach((input) =>
    input.addEventListener("change", () => {
      if (!requireCan("editBill")) return;
      const id = input.closest("tr").dataset.id;
      const bill = listMonthlyBills(selectedMonth).find((b) => b.id === id);
      const amount = Math.max(0, Math.floor(Number(input.value) || 0));
      if (bill?.published) {
        addAuditLog({ messId, actorId: member.id, action: "edit", entity: "monthlyBill", entityId: id, before: { amount: bill.amount }, after: { amount } });
      }
      updateMonthlyBill(id, { amount });
      renderAll();
    }),
  );
  tbody.querySelectorAll(".edit-split").forEach((btn) =>
    btn.addEventListener("click", () => openSplitPanel(btn.closest("tr").dataset.id)),
  );
}

$("#generate-bills").addEventListener("click", () => {
  if (!requireCan("generateBills")) return;
  if (isMonthClosed(messId, selectedMonth)) return;
  const items = listBillItems(messId).filter((item) => !item.isSpecial);
  for (const item of items) {
    addMonthlyBill({
      messId,
      itemId: item.id,
      month: selectedMonth,
      amount: Math.max(0, Math.floor(Number(item.defaultAmount) || 0)),
      splitMode: "equal",
      splits: [],
      published: false,
    });
  }
  addAuditLog({ messId, actorId: member.id, action: "generate-bills", entity: "month", entityId: selectedMonth, after: { items: items.length } });
  toast("Bills generated — review amounts, then publish");
  renderBills();
});

$("#publish-bills").addEventListener("click", () => {
  if (!requireCan("publishBills")) return;
  const bills = listMonthlyBills(selectedMonth);
  if (bills.some((b) => !Number.isInteger(b.amount) || b.amount < 1)) {
    toast("Every bill needs an amount of at least 1 before publish");
    return;
  }
  for (const bill of bills) updateMonthlyBill(bill.id, { published: true });
  addAuditLog({ messId, actorId: member.id, action: "publish-bills", entity: "month", entityId: selectedMonth, after: { bills: bills.length } });
  toast("Bills published");
  renderBills();
  renderAll();
});

$("#add-item-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!requireCan("setBillTemplate")) return;
  const name = $("#new-item-name").value.trim();
  const amount = Math.max(0, Math.floor(Number($("#new-item-amount").value) || 0));
  if (name.length < 1) return;
  addBillItem({ messId, name, type: "fixed", defaultAmount: amount });
  $("#new-item-name").value = "";
  $("#new-item-amount").value = "";
  renderBills();
});

$("#special-bill-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!requireCan("setBillTemplate")) return;
  if (isMonthClosed(messId, selectedMonth)) {
    toast(STRINGS.errors.monthClosed);
    return;
  }
  const name = $("#special-bill-name").value.trim();
  const amount = Number($("#special-bill-amount").value);
  if (!name || !Number.isInteger(amount) || amount < 1) {
    toast(STRINGS.errors.badAmount);
    return;
  }
  const item = addBillItem({ messId, name, type: "fixed", defaultAmount: 0, isSpecial: true });
  addMonthlyBill({ messId, itemId: item.id, month: selectedMonth, amount, splitMode: "equal", splits: [], published: false });
  $("#special-bill-name").value = "";
  $("#special-bill-amount").value = "";
  toast("Special bill added");
  renderBills();
});

function openSplitPanel(billId) {
  splitBillId = billId;
  const bill = listMonthlyBills(selectedMonth).find((b) => b.id === billId);
  if (!bill) return;
  const item = listBillItems(messId).find((i) => i.id === bill.itemId);
  $("#split-bill-name").textContent = item?.name ?? "?";
  $("#split-panel").hidden = false;
  $(`input[name="split-mode"][value="${bill.splitMode}"]`).checked = true;
  renderSplitInputs();
}

function renderSplitInputs() {
  const bill = listMonthlyBills(selectedMonth).find((b) => b.id === splitBillId);
  if (!bill) return;
  const mode = $('input[name="split-mode"]:checked').value;
  const participants = participantsFor(listMembers(messId), selectedMonth);
  const container = $("#split-inputs");
  $("#split-error").hidden = true;
  if (mode === "equal") {
    container.innerHTML = participants
      .map((m) => `<div class="field"><label>${esc(m.name)}</label><span class="muted">weight × ${daysInMonth(selectedMonth)}-day month</span></div>`)
      .join("") + '<p class="muted">Equal split with proration by days present (join and leave days counted).</p>';
    return;
  }
  const existing = Object.fromEntries((bill.splits ?? []).map((s) => [s.memberId, s.value]));
  container.innerHTML = participants
    .map(
      (m) => `<div class="field"><label for="split-${m.id}">${esc(m.name)}</label><input type="number" class="field split-value" id="split-${m.id}" data-id="${m.id}" min="0" step="1" value="${existing[m.id] ?? 0}" /></div>`,
    )
    .join("") + (mode === "percent" ? '<p class="muted">Whole numbers; must add up to 100.</p>' : '<p class="muted">Must add up to the bill amount.</p>');
}

$$('input[name="split-mode"]').forEach((radio) => radio.addEventListener("change", renderSplitInputs));

$("#save-split").addEventListener("click", () => {
  if (!requireCan("setSplit")) return;
  const bill = listMonthlyBills(selectedMonth).find((b) => b.id === splitBillId);
  if (!bill) return;
  const mode = $('input[name="split-mode"]:checked').value;
  const errorEl = $("#split-error");
  errorEl.hidden = true;
  if (mode === "equal") {
    updateMonthlyBill(bill.id, { splitMode: "equal", splits: [] });
    addAuditLog({ messId, actorId: member.id, action: "split-edit", entity: "monthlyBill", entityId: bill.id, after: { splitMode: "equal" } });
    toast("Split saved");
    renderAll();
    return;
  }
  const inputs = $$(".split-value", $("#split-inputs"));
  const values = Object.fromEntries(inputs.map((input) => [input.dataset.id, Number(input.value) || 0]));
  const check = mode === "percent" ? validatePercentSplit(values) : validateAmountSplit(values, bill.amount);
  if (!check.ok) {
    errorEl.textContent = check.message;
    errorEl.hidden = false;
    return;
  }
  const splits = Object.entries(values).map(([memberId, value]) => ({ memberId, value }));
  updateMonthlyBill(bill.id, { splitMode: mode, splits });
  addAuditLog({ messId, actorId: member.id, action: "split-edit", entity: "monthlyBill", entityId: bill.id, after: { splitMode: mode, splits } });
  toast("Split saved");
  renderAll();
});

$("#copy-split-all").addEventListener("click", () => {
  if (!requireCan("setSplit")) return;
  const bill = listMonthlyBills(selectedMonth).find((b) => b.id === splitBillId);
  if (!bill) return;
  for (const other of listMonthlyBills(selectedMonth)) {
    if (other.id === bill.id) continue;
    updateMonthlyBill(other.id, { splitMode: bill.splitMode, splits: bill.splits });
  }
  addAuditLog({ messId, actorId: member.id, action: "split-copy-all", entity: "month", entityId: selectedMonth, after: { splitMode: bill.splitMode } });
  toast("Split copied to all bills this month");
  renderAll();
});

$("#close-split").addEventListener("click", () => {
  $("#split-panel").hidden = true;
});

function renderMembers() {
  const members = listMembers(messId).sort((a, b) => a.name.localeCompare(b.name));
  const tbody = $("#members-table tbody");
  tbody.innerHTML = members
    .map(
      (m) => `<tr data-id="${m.id}">
        <td>${esc(m.name)}</td>
        <td>${m.role}</td>
        <td>${m.status}</td>
        <td>${esc(m.joinedOn ?? "—")}</td>
        <td class="row wrap">
          <button class="icon-btn open-detail" type="button">Detail</button>
          <button class="icon-btn rename-member" type="button">Rename</button>
          <button class="icon-btn toggle-member" type="button">${m.status === "active" ? "Deactivate" : "Activate"}</button>
          <button class="icon-btn remove-member" type="button">Remove</button>
        </td>
      </tr>`,
    )
    .join("");
  tbody.querySelectorAll(".open-detail").forEach((btn) =>
    btn.addEventListener("click", () => {
      detailMemberId = btn.closest("tr").dataset.id;
      $("#tab-member-detail").hidden = false;
      activateTab("member-detail");
    }),
  );
  tbody.querySelectorAll(".rename-member").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (!requireCan("renameMember")) return;
      const id = btn.closest("tr").dataset.id;
      const current = listMembers(messId).find((m) => m.id === id);
      const name = window.prompt("New name (2-30 characters)", current?.name ?? "")?.trim();
      if (!name) return;
      if (name.length < 2 || name.length > 30) {
        toast(STRINGS.errors.badName);
        return;
      }
      if (listMembers(messId).some((m) => m.id !== id && m.name.toLowerCase() === name.toLowerCase())) {
        toast(STRINGS.errors.nameTaken);
        return;
      }
      updateMember(id, { name });
      addAuditLog({ messId, actorId: member.id, action: "rename", entity: "member", entityId: id, before: { name: current?.name }, after: { name } });
      toast("Renamed");
      renderMembers();
    }),
  );
  tbody.querySelectorAll(".toggle-member").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (!requireCan("deactivateMember")) return;
      const id = btn.closest("tr").dataset.id;
      const target = listMembers(messId).find((m) => m.id === id);
      if (target?.status === "requested") {
        toast("Accept or decline the join request from the dashboard");
        return;
      }
      if (!target) return;
      if (target.status === "active") {
        updateMember(id, { status: "inactive", leftOn: today });
        addAuditLog({ messId, actorId: member.id, action: "deactivate", entity: "member", entityId: id, before: { status: "active" }, after: { status: "inactive", leftOn: today } });
        toast("Member deactivated");
      } else {
        updateMember(id, { status: "active", leftOn: null });
        addAuditLog({ messId, actorId: member.id, action: "activate", entity: "member", entityId: id, before: { status: target.status }, after: { status: "active", leftOn: null } });
        toast("Member activated");
      }
      renderMembers();
    }),
  );
  tbody.querySelectorAll(".remove-member").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (!requireCan("removeMember")) return;
      const id = btn.closest("tr").dataset.id;
      const hasEntries =
        listPayments(messId, { memberId: id }).length > 0 ||
        listBazar(messId, { memberId: id }).length > 0 ||
        listMeals(messId).some((m) => m.memberId === id);
      if (hasEntries) {
        toast("Member has entries — deactivate instead");
        return;
      }
      if (!window.confirm("Remove this member permanently?")) return;
      deleteMember(id);
      addAuditLog({ messId, actorId: member.id, action: "remove", entity: "member", entityId: id, before: { name: memberName(messId, id) }, after: null });
      toast("Member removed");
      renderMembers();
    }),
  );
}

$("#add-member-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireCan("addMember")) return;
  const name = $("#new-member-name").value.trim();
  const password = $("#new-member-password").value;
  if (name.length < 2 || name.length > 30) {
    toast(STRINGS.errors.badName);
    return;
  }
  if (password.length < 6) {
    toast(STRINGS.errors.badPassword);
    return;
  }
  if (listMembers(messId).some((m) => m.name.toLowerCase() === name.toLowerCase())) {
    toast(STRINGS.errors.nameTaken);
    return;
  }
  const passwordEntry = await createPasswordEntry(password);
  const created = addMember({ ...passwordEntry, messId, name, role: "member", takesPart: true, status: "active", joinedOn: today, leftOn: null, takesPartHistory: [{ from: thisMonth, value: true }] });
  addAuditLog({ messId, actorId: member.id, action: "add-member", entity: "member", entityId: created.id, after: { name } });
  $("#new-member-name").value = "";
  $("#new-member-password").value = "";
  toast("Member added");
  renderMembers();
});

$("#back-to-members").addEventListener("click", () => activateTab("members"));

function renderMemberDetail() {
  const target = listMembers(messId).find((m) => m.id === detailMemberId);
  if (!target) {
    activateTab("members");
    return;
  }
  const totals = monthTotals(messId, selectedMonth);
  const row = totals.perMember.find((r) => r.member.id === target.id);
  $("#member-detail-name").textContent = target.name;
  $("#member-detail-meta").textContent = `${target.role} · joined ${target.joinedOn ?? "—"} · ${target.status}${target.takesPart ? "" : " · manages only"}`;
  $("#member-detail-ledgers").innerHTML = row
    ? `<span class="status-text">Bills: ${statusMini(row.billBalance)}</span><span class="status-text">Meals: ${statusMini(row.mealBalance)}</span><span class="muted">Meals ${row.meals}${target.leftOn ? ` · left ${target.leftOn}` : ""}</span>`
    : "";

  const closed = isMonthClosed(messId, selectedMonth);
  const payments = listPayments(messId, { memberId: target.id, month: selectedMonth }).sort((a, b) => (a.date < b.date ? 1 : -1));
  const pBody = $("#detail-payments tbody");
  pBody.innerHTML = payments
    .map(
      (p) => `<tr data-id="${p.id}">
        <td>${esc(p.date)}</td>
        <td>${p.kind === "settlement" ? "Settlement" : "Payment"}</td>
        <td class="num">${fmtBDT(p.amount)}</td>
        <td>${esc(p.state)}${p.reviewNote ? ` <span class="muted">(${esc(p.reviewNote)})</span>` : ""}</td>
        <td class="no-print row"><button class="icon-btn edit-entry" type="button" ${closed ? "disabled" : ""}>Edit</button><button class="icon-btn delete-entry" type="button" ${closed ? "disabled" : ""}>Delete</button></td>
      </tr>`,
    )
    .join("");
  $("#detail-payments-empty").hidden = payments.length > 0;

  const bazarEntries = listBazar(messId, { memberId: target.id, month: selectedMonth }).sort((a, b) => (a.date < b.date ? 1 : -1));
  const bBody = $("#detail-bazar tbody");
  bBody.innerHTML = bazarEntries
    .map(
      (entry) => `<tr data-id="${entry.id}">
        <td>${esc(entry.date)}</td>
        <td>${esc((entry.lines ?? []).map((l) => STRINGS.bazar.categories[l.category] ?? l.category).join(", "))}</td>
        <td class="num">${fmtBDT(entry.total)}</td>
        <td>${esc(entry.state)}${entry.reviewNote ? ` <span class="muted">(${esc(entry.reviewNote)})</span>` : ""}</td>
        <td class="no-print row"><button class="icon-btn edit-entry" type="button" ${closed ? "disabled" : ""}>Edit</button><button class="icon-btn delete-entry" type="button" ${closed ? "disabled" : ""}>Delete</button></td>
      </tr>`,
    )
    .join("");
  $("#detail-bazar-empty").hidden = bazarEntries.length > 0;

  const meals = listMeals(messId, selectedMonth).filter((m) => m.memberId === target.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  const mBody = $("#detail-meals tbody");
  mBody.innerHTML = meals
    .map(
      (m) => `<tr data-date="${m.date}">
        <td>${esc(m.date)}</td>
        <td class="num">${m.halves / 2}</td>
        <td class="no-print"><input type="number" class="field meal-override" min="0" max="20" step="1" value="${m.halves}" ${closed ? "disabled" : ""} style="width: 80px" aria-label="Halves" /></td>
      </tr>`,
    )
    .join("");
  $("#detail-meals-empty").hidden = meals.length > 0;

  const memberEntryIds = new Set([...payments.map((p) => p.id), ...bazarEntries.map((b) => b.id)]);
  const audit = listAuditLog(messId)
    .filter((r) => r.actorId === target.id || memberEntryIds.has(r.entityId) || r.entityId === target.id)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 25);
  $("#detail-audit tbody").innerHTML = audit
    .map((r) => `<tr><td class="audit-row">${esc(r.at)}</td><td>${esc(nameOf(r.actorId) ?? "—")}</td><td>${esc(r.action)}</td><td class="audit-row">${esc(JSON.stringify(r.before))} → ${esc(JSON.stringify(r.after))}</td></tr>`)
    .join("");
  $("#detail-audit-empty").hidden = audit.length > 0;

  $$("#detail-payments .edit-entry").forEach((btn) =>
    btn.addEventListener("click", () => editDetailEntry(btn.closest("tr").dataset.id, "payment")),
  );
  $$("#detail-bazar .edit-entry").forEach((btn) =>
    btn.addEventListener("click", () => editDetailEntry(btn.closest("tr").dataset.id, "bazar")),
  );
  $$("#detail-payments .delete-entry").forEach((btn) =>
    btn.addEventListener("click", () => removeDetailEntry(btn.closest("tr").dataset.id, "payment")),
  );
  $$("#detail-bazar .delete-entry").forEach((btn) =>
    btn.addEventListener("click", () => removeDetailEntry(btn.closest("tr").dataset.id, "bazar")),
  );
  $$("#detail-meals .meal-override").forEach((input) =>
    input.addEventListener("change", () => {
      if (!requireCan("editMemberMeals")) return;
      const date = input.closest("tr").dataset.date;
      const next = Math.min(20, Math.max(0, Math.floor(Number(input.value) || 0)));
      const existing = listMeals(messId, selectedMonth).find((m) => m.memberId === target.id && m.date === date);
      const before = existing?.halves ?? 0;
      setMealEntry({ messId, memberId: target.id, date, halves: next });
      addAuditLog({ messId, actorId: member.id, action: "meal-override", entity: "meal", entityId: `${target.id}:${date}`, before: { halves: before }, after: { halves: next } });
      toast("Meal updated");
      renderAll();
      renderMemberDetail();
    }),
  );
}

function editDetailEntry(id, kind) {
  const list = kind === "payment" ? listPayments(messId) : listBazar(messId);
  const entry = list.find((e) => e.id === id);
  if (!entry) return;
  const current = kind === "payment" ? entry.amount : entry.total;
  const amountText = window.prompt("New amount (BDT)", String(current));
  if (amountText === null) return;
  const amount = Number(amountText);
  if (!Number.isInteger(amount) || amount < 1) {
    toast(STRINGS.errors.badAmount);
    return;
  }
  const dateText = window.prompt("New date (YYYY-MM-DD)", entry.date);
  const date = dateText && /^\d{4}-\d{2}-\d{2}$/.test(dateText.trim()) ? dateText.trim() : entry.date;
  const patch = kind === "payment" ? { amount, date } : { date, lines: [{ category: "others", amount }] };
  const res = editEntry({ member, mess }, { messId, id, kind, patch });
  toast(res.ok ? "Edited and logged" : res.error);
  renderAll();
  renderMemberDetail();
}

function removeDetailEntry(id, kind) {
  if (!window.confirm("Delete this entry permanently? The audit log keeps a record.")) return;
  const res = deleteEntry({ member, mess }, { messId, id, kind });
  toast(res.ok ? "Deleted" : res.error);
  renderAll();
  renderMemberDetail();
}

$("#detail-reset-password").addEventListener("click", async () => {
  if (!requireCan("resetPassword")) return;
  const target = listMembers(messId).find((m) => m.id === detailMemberId);
  if (!target) return;
  const next = window.prompt(`New password for ${target.name} (at least 6 characters)`);
  if (!next) return;
  if (next.length < 6) {
    toast(STRINGS.errors.badPassword);
    return;
  }
  const passwordEntry = await createPasswordEntry(next);
  updateMember(target.id, passwordEntry);
  addAuditLog({ messId, actorId: member.id, action: "reset-password", entity: "member", entityId: target.id, after: { password: "changed" } });
  toast("Password reset");
});

$("#detail-make-manager").addEventListener("click", () => {
  if (!requireCan("transferManager")) return;
  const target = listMembers(messId).find((m) => m.id === detailMemberId);
  if (!target || target.role === "manager") return;
  if (!window.confirm(`Make ${target.name} the manager? You become a regular member.`)) return;
  updateMember(target.id, { role: "manager" });
  updateMember(member.id, { role: "member" });
  addAuditLog({ messId, actorId: member.id, action: "transfer-manager", entity: "member", entityId: target.id, before: { manager: member.id }, after: { manager: target.id } });
  toast(`${target.name} is now the manager`);
  window.location.href = "member.html";
});

function renderReport() {
  const totals = monthTotals(messId, selectedMonth);
  $("#report-month-label").textContent = monthLabel(selectedMonth);
  const closed = isMonthClosed(messId, selectedMonth);
  const close = closed ? getMonthClose(messId, selectedMonth) : null;
  $("#closed-banner").hidden = !closed;
  if (closed) $("#closed-banner").textContent = `This month is closed (${close?.lockedAt ?? "locked"}) and cannot be edited.`;
  $("#close-month-btn").hidden = closed;
  const latestClosed = listMonthCloses(messId).map((c) => c.month).sort().at(-1);
  $("#reopen-month-btn").hidden = !(closed && selectedMonth === latestClosed);

  const pending = pendingEntries(messId, { month: selectedMonth });
  const warning = $("#close-pending-warning");
  warning.hidden = closed || pending.length === 0;
  if (!closed && pending.length > 0) warning.textContent = `${pending.length} pending ${pending.length === 1 ? "entry" : "entries"} must be approved or rejected before closing.`;

  const check = $("#report-numbers-check");
  check.className = totals.numbersOk ? "ok-strip" : "notice";
  check.textContent = totals.numbersOk ? "Numbers check OK" : "Numbers do not add up — fix errors before closing.";

  const participants = totals.perMember.filter((r) => r.participant);
  const tbody = $("#report-table tbody");
  tbody.innerHTML = participants
    .map(
      (r) => `<tr><td>${esc(r.member.name)}</td><td class="num">${fmtBDT(r.sharesOwed)}</td><td class="num">${fmtBDT(r.billsPaid)}</td><td class="num">${fmtBDT(r.billBalance)}</td><td class="num">${r.meals}</td><td class="num">${fmtBDT(r.bazar)}</td><td class="num">${fmtBDT(r.mealBalance)}</td><td class="num">${fmtBDT(r.billBalance + r.mealBalance)}</td></tr>`,
    )
    .join("");
  const sum = (key) => participants.reduce((acc, r) => acc + r[key], 0);
  $("#report-foot").innerHTML = `<td>Total</td><td class="num">${fmtBDT(sum("sharesOwed"))}</td><td class="num">${fmtBDT(sum("billsPaid"))}</td><td class="num">${fmtBDT(sum("billBalance"))}</td><td class="num">${sum("meals")}</td><td class="num">${fmtBDT(sum("bazar"))}</td><td class="num">${fmtBDT(sum("mealBalance"))}</td><td class="num">${fmtBDT(sum("billBalance") + sum("mealBalance"))}</td>`;
}

$("#close-month-btn").addEventListener("click", () => {
  if (!requireCan("closeMonth")) return;
  const pending = pendingEntries(messId, { month: selectedMonth });
  if (pending.length > 0) {
    toast("Approve or reject pending entries first");
    return;
  }
  if (isMonthClosed(messId, selectedMonth)) return;
  const snapshot = closingSnapshot(messId, selectedMonth);
  addMonthClose(snapshot);
  addAuditLog({ messId, actorId: member.id, action: "close-month", entity: "month", entityId: selectedMonth, after: { closing: snapshot.closing } });
  toast("Month closed");
  renderReport();
  renderAll();
});

$("#reopen-month-btn").addEventListener("click", () => {
  if (!requireCan("reopenMonth")) return;
  const latestClosed = listMonthCloses(messId).map((c) => c.month).sort().at(-1);
  if (selectedMonth !== latestClosed) {
    toast("Only the most recent closed month can be reopened");
    return;
  }
  if (!window.confirm(`Reopen ${monthLabel(selectedMonth)}? Entries become editable again.`)) return;
  deleteMonthClose(messId, selectedMonth);
  addAuditLog({ messId, actorId: member.id, action: "reopen-month", entity: "month", entityId: selectedMonth, after: null });
  toast("Month reopened");
  renderReport();
  renderAll();
});

$("#export-csv").addEventListener("click", () => {
  const totals = monthTotals(messId, selectedMonth);
  const lines = [
    ["Mess", mess.name, mess.publicId].map(csvEscape).join(","),
    ["Month", selectedMonth].map(csvEscape).join(","),
    ["Meal rate", totals.noMeals ? "no meals yet" : totals.mealRate.toFixed(2)].map(csvEscape).join(","),
    "",
    ["Member", "Bills owed", "Bills paid", "Bill balance", "Meals", "Bazar", "Meal balance", "Net"].map(csvEscape).join(","),
  ];
  for (const r of totals.perMember.filter((r) => r.participant)) {
    lines.push([r.member.name, r.sharesOwed, r.billsPaid, r.billBalance, r.meals, r.bazar, r.mealBalance, r.billBalance + r.mealBalance].map(csvEscape).join(","));
  }
  downloadFile(`${mess.publicId}-${selectedMonth}-report.csv`, lines.join("\r\n"), "text/csv");
});

$("#print-report").addEventListener("click", () => window.print());

function renderSettings() {
  $("#settings-takes-part").checked = member.takesPart === true;
  $("#settings-mess-id").textContent = mess.publicId;
  $("#settings-error").hidden = true;
}

$("#settings-takes-part").addEventListener("change", (event) => {
  const next = event.target.checked;
  const totals = monthTotals(messId, selectedMonth);
  const row = totals.perMember.find((r) => r.member.id === member.id) ?? { billBalance: 0, mealBalance: 0 };
  const error = $("#settings-error");
  error.hidden = true;
  if (!next && (row.billBalance !== 0 || row.mealBalance !== 0)) {
    event.target.checked = true;
    error.textContent = "You cannot switch off membership while your balance is not zero.";
    error.hidden = false;
    return;
  }
  const history = [...(member.takesPartHistory ?? []), { from: thisMonth, value: next }];
  updateMember(member.id, { takesPart: next, takesPartHistory: history });
  member.takesPart = next;
  member.takesPartHistory = history;
  addAuditLog({ messId, actorId: member.id, action: "takes-part-change", entity: "member", entityId: member.id, after: { takesPart: next } });
  toast("Updated");
});

renderAll();
