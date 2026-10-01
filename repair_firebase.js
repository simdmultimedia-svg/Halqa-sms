const fs = require('fs');

let content = fs.readFileSync('js/core/firebase.js', 'utf-8');

// The corrupted block starts at line 603: if (localStorage.getItem("CIC_DEBUG") === "true") {
// And ends at line 608: }

// I will replace everything from `export async function refreshCloudData` down to `function installAuthWatcher()` with the correct, newly written pure-Firestore versions of the 3 functions.

const newFunctions = `export async function refreshCloudData({ startRealtime = true } = {}) {
  if (state.mode !== "cloud" || !state.ready || !navigator.onLine) return { ok: false, reason: "cloud-not-ready" };
  const ready = await waitForAuthReady();
  if (!ready) return { ok: false, reason: "auth-not-ready" };

  const { collection, getDocs, query, limit } = state.sdk.firestore;
  const currentUser = state.auth.currentUser;
  const uid = (currentUser && currentUser.uid);
  const roleRec = uid ? db.get("userRoles", uid) : null;
  const role = normaliseRole((roleRec && roleRec.role) || "");
  const readable = rootReadableCollections(role);

  const ESSENTIAL_COLLECTIONS = ["settings", "users", "userRoles"];
  const essentialReadable = readable.filter(c => ESSENTIAL_COLLECTIONS.includes(c));
  const backgroundReadable = readable.filter(c => !ESSENTIAL_COLLECTIONS.includes(c));

  if (localStorage.getItem("CIC_DEBUG") === "true") {
    console.info("[SYNC] Essential refresh starting", { role, essential: essentialReadable.length, background: backgroundReadable.length });
  }
  window.dispatchEvent(new CustomEvent("sync:refresh", { detail: { status: "start" } }));

  const _t0 = performance.now();
  console.time("[TRACE] refreshCloudData()");

  const loadOne = async (col) => {
    const t0col = performance.now();
    try {
      let rowCount = 0;
      if (FIRESTORE_COLLECTIONS.includes(col)) {
        const snap = await getDocs(query(collection(state.fs, col), limit(fsLimit(col))));
        rowCount = snap.size;
        snap.forEach((doc) => {
          const data = doc.data();
          if (data != null && typeof data === "object") db.applyRemote(col, doc.id, { ...data, id: data.id || doc.id });
        });
        syncLog({ db: "FS", col, path: col, op: "refresh", status: "ok" });
      }
      console.log(\`[BOOT STEP] load:\${col}: \${Math.round(performance.now() - t0col)}ms (\${rowCount} records)\`);
      return { col, count: rowCount };
    } catch (e) {
      const { errorCode, errorMsg, status } = classifyError(e);
      syncLog({ db: "FS", col, path: col, op: "refresh", status, errorCode, errorMsg });
      return { col, count: 0 };
    }
  };

  const results = await Promise.all(essentialReadable.map(loadOne));
  const counts = {};
  results.forEach(({ col, count }) => { counts[col] = count; });

  setCloudCounts(counts);
  const refreshedAt = markSyncTime();
  localStorage.setItem("CIC KANO:lastCloudRefresh", refreshedAt);

  if (startRealtime) startListeners();

  const elapsed = Math.round(performance.now() - _t0);
  window.CICKANOPerf = window.CICKANOPerf || {};
  window.CICKANOPerf.cloudRefreshTime = elapsed;
  console.timeEnd("[TRACE] refreshCloudData()");
  window.dispatchEvent(new CustomEvent("sync:refresh", { detail: { status: "done", counts } }));
  if (localStorage.getItem("CIC_DEBUG") === "true") {
    console.info("[SYNC] Essential refresh complete", { elapsed });
  }

  if (backgroundReadable.length > 0) {
    const schedule = window.requestIdleCallback || ((cb) => setTimeout(cb, 100));
    schedule(() => refreshBackgroundCloudData(backgroundReadable));
  }

  return { ok: true, counts };
}

async function refreshBackgroundCloudData(collections) {
  if (!collections || !collections.length) return;
  
  const { collection, getDocs, query, limit } = state.sdk.firestore;

  const _t0 = performance.now();
  console.time("[TRACE] refreshBackgroundCloudData()");

  const bgLoadOne = async (col) => {
    const t0col = performance.now();
    try {
      let rowCount = 0;
      if (FIRESTORE_COLLECTIONS.includes(col)) {
        const snap = await getDocs(query(collection(state.fs, col), limit(fsLimit(col))));
        rowCount = snap.size;
        snap.forEach((doc) => {
          const data = doc.data();
          if (data != null && typeof data === "object") db.applyRemote(col, doc.id, { ...data, id: data.id || doc.id });
        });
        syncLog({ db: "FS", col, path: col, op: "bg-refresh", status: "ok" });
      }
      console.log(\`[BOOT STEP] bg:\${col}: \${Math.round(performance.now() - t0col)}ms (\${rowCount} records)\`);
    } catch (e) {
      const { errorCode, errorMsg, status } = classifyError(e);
      syncLog({ db: "FS", col, path: col, op: "bg-refresh", status, errorCode, errorMsg });
    }
  };

  const BATCH_SIZE = 5;
  for (let i = 0; i < collections.length; i += BATCH_SIZE) {
    const batch = collections.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(batch.map(bgLoadOne));
  }

  const elapsed = Math.round(performance.now() - _t0);
  window.CICKANOPerf = window.CICKANOPerf || {};
  window.CICKANOPerf.bgRefreshTime = elapsed;
  console.timeEnd("[TRACE] refreshBackgroundCloudData()");
  if (localStorage.getItem("CIC_DEBUG") === "true") {
    console.info("[SYNC] Background refresh complete", { collections: collections.length, elapsed });
  }
  window.dispatchEvent(new CustomEvent("sync:refresh", { detail: { status: "bg-done", elapsed } }));
}

function installSyncHandler() {
  const { firestore } = state.sdk;

  setSyncHandler(async (op) => {
    if (!state.ready || !state.authReady || !navigator.onLine) {
      if (localStorage.getItem("CIC_DEBUG") === "true") {
        console.warn("[QUEUE FLUSH] Skipped — not ready:", { ready: state.ready, authReady: state.authReady, online: navigator.onLine });
      }
      return false;
    }

    const currentUser = state.auth.currentUser;
    const uid = (currentUser && currentUser.uid) || "(none)";
    const path = \`\${op.col}/\${op.id}\`;
    const { doc, getDoc, setDoc, deleteDoc } = firestore;

    try {
      if (FIRESTORE_COLLECTIONS.includes(op.col)) {
        const fsRef = doc(state.fs, op.col, op.id);
        if (op.action === "remove" || op.action === "delete") {
          await deleteDoc(fsRef);
        } else {
          const cloudSnap = await getDoc(fsRef).catch(() => null);
          const cloudData = cloudSnap && typeof cloudSnap.exists === 'function' && cloudSnap.exists() ? cloudSnap.data() : null;
          if (cloudData && recordStamp(cloudData) > recordStamp(op.data)) {
            console.warn("[SYNC SKIP] Cloud record is newer; local queued write dropped", { path, cloudUpdatedAt: recordStamp(cloudData), localUpdatedAt: recordStamp(op.data) });
            db.applyRemote(op.col, op.id, { ...cloudData, id: cloudData.id || op.id });
            syncLog({ db: "FS", col: op.col, path, op: "skip-stale-local", status: "ok" });
            return true;
          }
          await setDoc(fsRef, op.data);
        }
        syncLog({ db: "FS", col: op.col, path, op: op.action, status: "ok" });
        return true;
      }
    } catch (e) {
      const { errorCode, errorMsg, status } = classifyError(e);
      if (status === "denied") {
        console.warn(\`[SYNC DROPPED] permission_denied on \${path} — op will not be retried.\`, \`uid: \${uid}  col: \${op.col}  id: \${op.id}\`);
        toast(\`⚠️ Sync denied for \${op.col} — check your permissions or contact admin.\`, "warning");
        syncLog({ db: "FS", col: op.col, path, op: op.action, status: "dropped", errorCode, errorMsg, rawError: e });
        return true;
      }
      if (status !== "denied") {
          console.warn("[SYNC FAILED]", path, "uid:", uid, "code:", errorCode, "msg:", errorMsg);
      }
      syncLog({ db: "FS", col: op.col, path, op: op.action, status, errorCode, errorMsg, rawError: e });
      return false;
    }
  });
}
`;

const startIndex = content.indexOf('export async function refreshCloudData');
const endIndex = content.indexOf('// ─── Auth state watcher ───────────────────────────────────────────────────────');

if (startIndex !== -1 && endIndex !== -1) {
  content = content.substring(0, startIndex) + newFunctions + "\n" + content.substring(endIndex);
  fs.writeFileSync('js/core/firebase.js', content, 'utf-8');
  console.log('Repaired firebase.js');
} else {
  console.log('Could not find markers');
}
