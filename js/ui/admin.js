import { ADMIN_CODE } from "../config.js";
import {
  listAllMesses,
  listMembers,
  listAuditLog,
  softDeleteMess,
  restoreMess,
} from "../storage.js";
import { $, esc, toast } from "./common.js";

const gate = $("#admin-gate");
const panel = $("#admin-panel");

function messStats(mess) {
  const members = listMembers(mess.id);
  const memberCount = members.length;
  const log = listAuditLog(mess.id);
  const lastActivity = log.length
    ? log.map((r) => r.at).sort().at(-1)
    : mess.createdAt;
  return { memberCount, lastActivity };
}

function render() {
  const messes = [...listAllMesses()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  $("#admin-count").textContent = `${messes.length} messes`;
  const tbody = $("#admin-table tbody");
  tbody.innerHTML = messes
    .map((mess) => {
      const { memberCount, lastActivity } = messStats(mess);
      const deleted = mess.status === "deleted";
      const action = deleted
        ? `<button class="btn btn--ghost btn--small restore-btn" data-id="${mess.id}" type="button">Restore</button>`
        : `<button class="btn btn--danger btn--small delete-btn" data-id="${mess.id}" data-public="${esc(mess.publicId)}" type="button">Delete</button>`;
      return `<tr>
        <td>${esc(mess.name)}</td>
        <td>${esc(mess.publicId)}</td>
        <td class="num">${memberCount}</td>
        <td>${esc(mess.createdAt)}</td>
        <td>${esc(lastActivity ?? "—")}</td>
        <td>${deleted ? "deleted" : "active"}</td>
        <td>${action}</td>
      </tr>`;
    })
    .join("");
  $("#admin-empty").hidden = messes.length > 0;

  tbody.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const typed = window.prompt(`Type ${btn.dataset.public} to soft-delete this mess`);
      if (typed === btn.dataset.public) {
        softDeleteMess(btn.dataset.id);
        toast("Mess soft-deleted (restorable)");
        render();
      } else if (typed !== null) {
        toast("ID did not match — nothing deleted");
      }
    });
  });
  tbody.querySelectorAll(".restore-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      restoreMess(btn.dataset.id);
      toast("Mess restored");
      render();
    });
  });
}

$("#admin-code-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const code = $("#admin-code").value;
  if (code !== ADMIN_CODE) {
    const error = $("#admin-error");
    error.textContent = "Wrong code";
    error.hidden = false;
    return;
  }
  gate.hidden = true;
  panel.hidden = false;
  render();
});
