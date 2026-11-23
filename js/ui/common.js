import { STRINGS } from "../strings.js";
import { formatTaka, statusFor } from "../calc.js";
import { getSessionWithMess } from "../auth.js";

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function fmtBDT(n) {
  return formatTaka(n);
}

export function monthLabel(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function monthShift(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function statusCircleHTML(color) {
  const label = { red: "!", green: "OK", blue: "+", orange: "…" }[color] ?? "?";
  return `<span class="status-circle status-circle--${color}" aria-hidden="true">${label}</span>`;
}

export function statusLineHTML(balance, pendingCount = 0) {
  const status = statusFor(balance, pendingCount);
  const badge = status.pending > 0 ? `<span class="badge-pending">${esc(STRINGS.status.pending(status.pending))}</span>` : "";
  return `<span class="status-line">${statusCircleHTML(status.color)}<span class="status-text"><strong>${esc(status.text)}</strong>${badge ? ` ${badge}` : ""}</span></span>`;
}

export function toast(message, root = document) {
  const el = $("#toast", root) ?? document.body.appendChild(Object.assign(document.createElement("div"), { id: "toast", className: "toast" }));
  el.textContent = message;
  el.classList.add("toast--show");
  window.clearTimeout(toast._timer);
  toast._timer = window.setTimeout(() => el.classList.remove("toast--show"), 2600);
}

export function showView(name, root = document) {
  $$("[data-view]", root).forEach((section) => {
    section.hidden = section.dataset.view !== name;
  });
  $$("[data-nav]", root).forEach((link) => {
    link.classList.toggle("nav__link--active", link.dataset.nav === name);
  });
}

export function requireSession() {
  const session = getSessionWithMess();
  if (!session) {
    window.location.href = "index.html";
    return null;
  }
  return session;
}

export function requireManager(session) {
  if (session.member.role !== "manager") {
    window.location.href = "member.html";
    return false;
  }
  return true;
}

export function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function downloadFile(filename, content, mime = "text/csv") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function renderAppNav({ active, canSeeManager }) {
  const managerLink = canSeeManager ? `<a data-nav="manager" href="manager.html">${esc(STRINGS.nav.manager)}</a>` : "";
  return `
    <nav class="appnav">
      <a class="appnav__brand" href="member.html">${esc(STRINGS.appName)}</a>
      <div class="appnav__links">
        <a class="${active === "member" ? "is-active" : ""}" href="member.html">${esc(STRINGS.nav.dashboard)}</a>
        ${managerLink}
        <a href="#" id="logout-btn">${esc(STRINGS.logout)}</a>
      </div>
    </nav>`;
}
