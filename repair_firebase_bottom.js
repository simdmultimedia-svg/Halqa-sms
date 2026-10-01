const fs = require('fs');
let content = fs.readFileSync('js/core/firebase.js', 'utf-8');

const missingContent = `      startListeners();
      flushQueue();
    } else {
      state.authReady = false;
      state.authChecking = false;
      state.cloudStatus = state.mode === "cloud" && state.ready ? "signed-out" : state.cloudStatus;
      stopListeners();
      logFirebaseDiagnostics("auth-signed-out");
    }
    window.dispatchEvent(new CustomEvent("auth:change", { detail: { uid: (user && user.uid) || null } }));
  });
}

// ─── Known-admin bootstrap ────────────────────────────────────────────────────
async function bootstrapKnownAdmin(fbUser) {
  const uid   = fbUser.uid;
  const email = fbUser.email || DEFAULT_SUPER_ADMIN_EMAIL;
  const role  = "Super Admin";

  try {
    const { firestore } = state.sdk;
    const { doc, getDoc, setDoc } = firestore;

    const fsUserRef = doc(state.fs, "users", uid);
    const fsUserSnap = await getDoc(fsUserRef).catch(() => null);
    if (!fsUserSnap || !fsUserSnap.exists()) {
      await setDoc(fsUserRef, {
        id: uid, uid, email, role,
        name: "System Admin",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "Active",
        isSeed: true
      }, { merge: true });
      syncLog({ db: "FS", col: "users", path: "users/" + uid, op: "bootstrap", status: "ok" });
    }

    const fsRoleRef = doc(state.fs, "userRoles", uid);
    const fsRoleSnap = await getDoc(fsRoleRef).catch(() => null);
    if (!fsRoleSnap || !fsRoleSnap.exists()) {
      await setDoc(fsRoleRef, { id: uid, uid, email, role, updatedAt: Date.now(), isSeed: true }, { merge: true });
      syncLog({ db: "FS", col: "userRoles", path: "userRoles/" + uid, op: "bootstrap", status: "ok" });
    }

    if (localStorage.getItem("CIC_DEBUG") === "true") {
      console.info("[Firebase] Admin UID bootstrap complete:", uid);
    }
  } catch (e) {
    const { errorCode, errorMsg, status } = classifyError(e);
    syncLog({ db: "FS", col: "userRoles/users", path: "userRoles/" + uid, op: "bootstrap", status, errorCode, errorMsg });
    console.warn("[Firebase] Admin UID bootstrap failed:", errorMsg);
  }
}

// ─── Counter reservation ──────────────────────────────────────────────────────
function installCounterReservation() {
  const { firestore } = state.sdk;
  window.__CICKANOReserveCounter = async (name) => {
    const { doc, runTransaction } = firestore;
    const counterRef = doc(state.fs, "counters", name);
    return await runTransaction(state.fs, async (transaction) => {
      const snap = await transaction.get(counterRef);
      const cur = snap.exists() ? (Number(snap.data().value) || 0) : 0;
      const next = cur + 1;
      transaction.set(counterRef, { value: next }, { merge: true });
      return next;
    });
  };
}

// ─── Network event handlers ───────────────────────────────────────────────────
window.addEventListener("online", async () => {
  state.online = true;
  window.dispatchEvent(new CustomEvent("net:change", { detail: { online: true } }));
  if (state.mode === "cloud" && !state.ready) {
    const ok = await initCloud();
    if (ok) {
      startListeners();
      window.dispatchEvent(new CustomEvent("net:reconnected", { detail: {} }));
    }
  } else if (state.ready) {
    
    if (state.authReady) {
      if (localStorage.getItem("CIC_DEBUG") === "true") {
        console.info("[QUEUE FLUSH] Back online - flushing pending sync queue");
      }
      flushQueue();
      window.dispatchEvent(new CustomEvent("net:reconnected", { detail: {} }));
    }
  }
});

window.addEventListener("offline", () => {
  state.online = false;
  if (state.ready) {
    
  }
  window.dispatchEvent(new CustomEvent("net:change", { detail: { online: false } }));
});`;

const startIndex = content.indexOf('logFirebaseDiagnostics("auth-confirmed");');
if (startIndex !== -1) {
  content = content.substring(0, startIndex + 'logFirebaseDiagnostics("auth-confirmed");\n'.length) + "\n" + missingContent;
  fs.writeFileSync('js/core/firebase.js', content, 'utf-8');
  console.log("Fixed bottom chunk.");
} else {
  console.log("Could not find start index.");
}
