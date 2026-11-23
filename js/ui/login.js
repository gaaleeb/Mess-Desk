import { STRINGS } from "../strings.js";
import { login, getSessionWithMess } from "../auth.js";
import { seedDemo } from "../seed.js";
import { $, toast } from "./common.js";

if (getSessionWithMess()) {
  window.location.href = "member.html";
}

function showError(message) {
  const el = $("#login-error");
  el.textContent = message ?? "";
  el.hidden = !message;
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  showError(null);
  const messId = $("#login-mess-id").value.trim();
  const name = $("#login-name").value.trim();
  const password = $("#login-password").value;
  const result = await login(messId, name, password);
  if (!result.ok) {
    showError(result.error);
    return;
  }
  window.location.href = result.member.role === "manager" ? "manager.html" : "member.html";
});

$("#seed-demo-btn").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  const result = await seedDemo();
  button.disabled = false;
  if (result.already) {
    toast(`Demo mess already exists: ${result.publicId} (Rahim / demo123)`);
  } else {
    toast(`Demo mess ${result.publicId} created — log in as Rahim / demo123`);
  }
});
