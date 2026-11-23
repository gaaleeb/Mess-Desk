import { STRINGS } from "../strings.js";
import {
  createMess,
  uniquePublicId,
  listAllMesses,
  addMember,
  addBillItem,
  todayISO,
} from "../storage.js";
import { createPasswordEntry, login, getSessionWithMess } from "../auth.js";
import { $, toast } from "./common.js";

if (getSessionWithMess()) {
  window.location.href = "member.html";
}

function validName(name) {
  const trimmed = name.trim();
  return trimmed.length >= 2 && trimmed.length <= 30;
}

const createForm = $("#create-form");
const createPublicId = $("#create-public-id");
createPublicId.value = uniquePublicId(listAllMesses());

function showError(message) {
  const el = $("#create-error");
  el.textContent = message ?? "";
  el.hidden = !message;
}

$("#copy-id-btn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(createPublicId.value);
    toast(STRINGS.copied);
  } catch {
    createPublicId.select();
    document.execCommand("copy");
    toast(STRINGS.copied);
  }
});

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError(null);
  const messName = $("#create-mess-name").value.trim();
  const managerName = $("#create-manager-name").value.trim();
  const password = $("#create-password").value;
  const joinAsMember = $("#create-join-member").checked;
  if (!validName(messName) || !validName(managerName)) {
    showError(STRINGS.errors.badName);
    return;
  }
  if (password.length < 6) {
    showError(STRINGS.errors.badPassword);
    return;
  }
  const candidate = createPublicId.value;
  const mess = createMess({ name: messName, publicId: candidate });
  const passwordEntry = await createPasswordEntry(password);
  const joinedOn = todayISO();
  addMember({
    ...passwordEntry,
    messId: mess.id,
    name: managerName,
    role: "manager",
    takesPart: joinAsMember,
    status: "active",
    joinedOn,
    leftOn: null,
    takesPartHistory: [{ from: joinedOn.slice(0, 7), value: joinAsMember }],
  });
  const standardTemplate = [
    ["Rent", "fixed"],
    ["Gas", "fixed"],
    ["Electricity", "variable"],
    ["Maid", "fixed"],
    ["Garbage", "fixed"],
    ["Internet", "fixed"],
    ["Other", "variable"],
  ];
  for (const [name, type] of standardTemplate) {
    addBillItem({ messId: mess.id, name, type, defaultAmount: 0 });
  }
  const result = await login(mess.publicId, managerName, password);
  if (!result.ok) {
    toast(mess.publicId);
    return;
  }
  window.location.href = "manager.html";
});
