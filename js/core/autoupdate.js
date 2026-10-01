import { toast } from "./utils.js";
import { db } from "./db.js";

const VERSION_URL = "/version.json";
let checkInterval;

export function initAutoUpdate() {
  window.APP_VERSION = "1.0.2"; // current local version
  
  // 1. Check on startup
  setTimeout(checkForUpdates, 3000);

  // 2. Check every 5 minutes
  checkInterval = setInterval(checkForUpdates, 300000);

  // 3. Check when tab regains focus
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkForUpdates();
    }
  });

  // 4. Force Update listener (from Firebase Settings)
  window.addEventListener("CIC KANO:store-update:settings", () => {
    checkForceUpdate();
  });
}

async function checkForUpdates() {
  try {
    const res = await fetch(VERSION_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.version && data.version !== window.APP_VERSION) {
      promptUpdate(data.version);
    }
  } catch (err) {
    console.warn("[AutoUpdate] Check failed:", err);
  }
}

let updatePrompted = false;
function promptUpdate(newVer) {
  if (updatePrompted) return;
  updatePrompted = true;
  console.log(`[AutoUpdate] New version ${newVer} available in background.`);
}

let forcingUpdate = false;
function checkForceUpdate() {
  if (forcingUpdate) return;
  const s = db.list("settings");
  if (s.length && s[0].forceUpdate === true) {
    forcingUpdate = true;
    let countdown = 5;
    const msg = document.createElement("div");
    msg.style.cssText = "position:fixed;top:0;left:0;right:0;background:#c0392b;color:white;text-align:center;padding:15px;z-index:999999;font-weight:bold;";
    msg.innerHTML = `⚠️ CRITICAL UPDATE REQUIRED. System will auto-refresh in <span id="fu-cd">${countdown}</span> seconds.`;
    document.body.appendChild(msg);

    const iv = setInterval(() => {
      countdown--;
      document.getElementById("fu-cd").innerText = countdown;
      if (countdown <= 0) {
        clearInterval(iv);
        if ("serviceWorker" in navigator) {
          navigator.serviceWorker.getRegistration().then((reg) => {
            if (reg && reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
          });
        }
        window.location.reload(true);
      }
    }, 1000);
  }
}
