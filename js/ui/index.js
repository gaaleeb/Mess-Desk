import { getSessionWithMess } from "../auth.js";

if (getSessionWithMess()) {
  window.location.href = "member.html";
}
