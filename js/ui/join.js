import { STRINGS } from "../strings.js";
import {
  addMember,
  getMessByPublicId,
  findMemberByName,
  todayISO,
} from "../storage.js";
import { createPasswordEntry, getSessionWithMess } from "../auth.js";
import { $ } from "./common.js";

if (getSessionWithMess()) {
  window.location.href = "member.html";
}

function validName(name) {
  const trimmed = name.trim();
  return trimmed.length >= 2 && trimmed.length <= 30;
}

function showError(message) {
  const el = $("#join-error");
  el.textContent = message ?? "";
  el.hidden = !message;
}

$("#join-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  showError(null);
  $("#join-ok").hidden = true;
  const messId = $("#join-mess-id").value.trim().toUpperCase();
  const name = $("#join-name").value.trim();
  const password = $("#join-password").value;
  if (!validName(name)) {
    showError(STRINGS.errors.badName);
    return;
  }
  if (password.length < 6) {
    showError(STRINGS.errors.badPassword);
    return;
  }
  const mess = getMessByPublicId(messId);
  if (!mess || mess.status !== "active") {
    showError(STRINGS.errors.messNotFound);
    return;
  }
  if (findMemberByName(mess.id, name)) {
    showError(STRINGS.errors.nameTaken);
    return;
  }
  const passwordEntry = await createPasswordEntry(password);
  addMember({
    ...passwordEntry,
    messId: mess.id,
    name,
    role: "member",
    takesPart: true,
    status: "requested",
    joinedOn: null,
    leftOn: null,
    takesPartHistory: [{ from: todayISO().slice(0, 7), value: true }],
  });
  $("#join-ok").hidden = false;
  $("#join-ok").textContent = STRINGS.errors.waitingForManager;
  event.target.querySelectorAll("input").forEach((input) => {
    input.value = "";
  });
});
