import {
  createMess,
  listAllMesses,
  addMember,
  addBillItem,
  addMonthlyBill,
  setMealEntry,
  addBazar,
  addPayment,
  addMonthClose,
  todayISO,
  nowISO,
} from "./storage.js";
import { createPasswordEntry } from "./auth.js";
import { closingSnapshot } from "./ledger.js";
import { daysInMonth } from "./calc.js";

const DEMO_PASSWORD = "demo123";

function prevMonthOf(month) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthOfToday() {
  return todayISO().slice(0, 7);
}

function iso(month, day) {
  return `${month}-${String(day).padStart(2, "0")}`;
}

export async function seedDemo() {
  const existing = listAllMesses().find((m) => m.name === "Demo Flat" && m.status === "active");
  if (existing) return { already: true, publicId: existing.publicId };

  const month = monthOfToday();
  const prev = prevMonthOf(month);
  const todayDay = Number(todayISO().slice(8, 10));
  const prevDays = daysInMonth(prev);
  const prevFirst = iso(prev, 1);

  const mess = createMess({ name: "Demo Flat" });

  const passwordEntry = async () => createPasswordEntry(DEMO_PASSWORD);
  const mkMember = async (name, role, takesPart) => ({
    ...(await passwordEntry()),
    messId: mess.id,
    name,
    role,
    takesPart,
    status: "active",
    joinedOn: prevFirst,
    leftOn: null,
    takesPartHistory: [{ from: prev, value: takesPart }],
  });

  const rahim = addMember(await mkMember("Rahim", "manager", true));
  const karim = addMember(await mkMember("Karim", "member", true));
  const salma = addMember(await mkMember("Salma", "member", true));
  const tania = addMember(await mkMember("Tania", "member", true));
  const roster = [rahim, karim, salma, tania];

  const template = [
    { name: "Rent", type: "fixed", defaultAmount: 12000 },
    { name: "Gas", type: "fixed", defaultAmount: 1000 },
    { name: "Electricity", type: "variable", defaultAmount: 1600 },
    { name: "Maid", type: "fixed", defaultAmount: 1200 },
    { name: "Garbage", type: "fixed", defaultAmount: 200 },
    { name: "Internet", type: "fixed", defaultAmount: 800 },
  ];
  const items = template.map((item) => addBillItem({ messId: mess.id, ...item }));

  const publishBills = (targetMonth) => {
    for (const item of items) {
      const isRent = item.name === "Rent";
      addMonthlyBill({
        messId: mess.id,
        itemId: item.id,
        month: targetMonth,
        amount: item.defaultAmount,
        splitMode: isRent ? "percent" : "equal",
        splits: isRent
          ? [
              { memberId: rahim.id, value: 40 },
              { memberId: karim.id, value: 20 },
              { memberId: salma.id, value: 20 },
              { memberId: tania.id, value: 20 },
            ]
          : [],
        published: true,
      });
    }
  };
  publishBills(prev);
  publishBills(month);

  const halvesFor = (memberId, day) => {
    if (memberId === rahim.id) return day <= 28 ? 5 : 0;
    if (memberId === karim.id) return day <= 30 ? 4 : 0;
    return day <= 20 ? 4 : day <= 30 ? 3 : 0;
  };
  for (const member of roster) {
    for (let day = 1; day <= prevDays; day += 1) {
      const halves = halvesFor(member.id, day);
      if (halves > 0) setMealEntry({ messId: mess.id, memberId: member.id, date: iso(prev, day), halves });
    }
  }

  const prevBazar = [
    { member: rahim, total: 9000, lines: [{ category: "veg", amount: 3000 }, { category: "meat", amount: 2500 }, { category: "fish", amount: 1500 }, { category: "others", amount: 2000 }], day: 8 },
    { member: karim, total: 4000, lines: [{ category: "grains", amount: 1800 }, { category: "oil", amount: 1200 }, { category: "spices", amount: 1000 }], day: 12 },
    { member: salma, total: 6000, lines: [{ category: "fish", amount: 2600 }, { category: "dairy_eggs", amount: 1800 }, { category: "veg", amount: 1600 }], day: 16 },
    { member: tania, total: 5000, lines: [{ category: "meat", amount: 2200 }, { category: "veg", amount: 1800 }, { category: "oil", amount: 1000 }], day: 22 },
  ];
  for (const b of prevBazar) {
    addBazar({
      messId: mess.id,
      memberId: b.member.id,
      date: iso(prev, b.day),
      note: "",
      lines: b.lines,
      total: b.total,
      state: "approved",
      reviewedBy: rahim.id,
      reviewNote: "seed",
    });
  }

  const prevPayments = [
    { member: rahim, amount: 4750, day: 6, state: "approved" },
    { member: karim, amount: 3600, day: 6, state: "approved" },
    { member: salma, amount: 2000, day: 9, state: "approved" },
    { member: salma, amount: 1600, day: 25, state: "pending" },
    { member: tania, amount: 3600, day: 6, state: "approved" },
  ];
  for (const p of prevPayments) {
    addPayment({
      messId: mess.id,
      memberId: p.member.id,
      ledger: "bill",
      kind: "payment",
      month: prev,
      date: iso(prev, p.day),
      amount: p.amount,
      method: "bkash",
      note: "",
      state: p.state,
      reviewedBy: p.state === "approved" ? rahim.id : null,
      reviewNote: p.state === "approved" ? "seed" : "",
      createdAt: nowISO(),
    });
  }
  addPayment({
    messId: mess.id,
    memberId: karim.id,
    ledger: "meal",
    kind: "settlement",
    paidTo: rahim.id,
    month: prev,
    date: iso(prev, 27),
    amount: 2000,
    method: "cash",
    note: "settle meal balance",
    state: "approved",
    reviewedBy: rahim.id,
    reviewNote: "seed",
    createdAt: nowISO(),
  });

  addMonthClose(closingSnapshot(mess.id, prev));

  for (let day = 1; day <= todayDay; day += 1) {
    const halves = [5, 4, 4, 3];
    roster.forEach((member, index) => setMealEntry({ messId: mess.id, memberId: member.id, date: iso(month, day), halves: halves[index] }));
  }
  const currentBazar = [
    { member: rahim, total: 2400, day: Math.max(1, todayDay - 5), lines: [{ category: "veg", amount: 1400 }, { category: "fish", amount: 1000 }], state: "approved" },
    { member: karim, total: 930, day: Math.max(1, todayDay - 2), lines: [{ category: "veg", amount: 480 }, { category: "fish", amount: 450 }], state: "approved" },
    { member: salma, total: 450, day: todayDay, lines: [{ category: "oil", amount: 250 }, { category: "spices", amount: 200 }], state: "pending" },
  ];
  for (const b of currentBazar) {
    addBazar({
      messId: mess.id,
      memberId: b.member.id,
      date: iso(month, b.day),
      note: "",
      lines: b.lines,
      total: b.total,
      state: b.state,
      reviewedBy: b.state === "approved" ? rahim.id : null,
      reviewNote: b.state === "approved" ? "seed" : "",
    });
  }
  addPayment({
    messId: mess.id,
    memberId: karim.id,
    ledger: "bill",
    kind: "payment",
    month: month,
    date: todayISO(),
    amount: 2000,
    method: "cash",
    note: "",
    state: "pending",
    createdAt: nowISO(),
  });

  return { already: false, publicId: mess.publicId };
}
