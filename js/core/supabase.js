// Supabase adapter: offline-first records with Realtime and incremental reconciliation.
import { store } from "./store.js";
import { db, setSyncHandler, markSyncTime, flushQueue } from "./db.js";

export const SUPABASE_URL = "https://hzwxnyfncpqlgbkcadkj.supabase.co";
export const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6d3hueWZuY3BxbGdia2NhZGtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2ODI4MTAsImV4cCI6MjEwNjI1ODgxMH0.36rU7Ua9kCUvNlI0JF1cvFOM8g0yTaMw7tMJyb4zJXQ";
export const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6d3hueWZuY3BxbGdia2NhZGtqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDY4MjgxMCwiZXhwIjoyMTA2MjU4ODEwfQ.Kv2gn6aKcvKc66TcIO6-rf7gw1lw33bfmrcPQnGigxA";
const PAGE_SIZE = 1000;
const RECONCILE_INTERVAL_MS = 120_000;

export const state = { ready: false, authReady: false, authChecking: false, online: navigator.onLine, mode: localStorage.getItem("HALQA:mode") || "local", cloudStatus: "local", cloudError: "", fsInitialized: false, client: null, realtimeStatus: "disconnected" };
let realtimeChannel = null;
let realtimeStopping = false;
let reconcileTimer = null;
let hydrationPromise = null;
let networkHandlersInstalled = false;
let lastCloudPullAt = null;
let realtimeRetryTimer = null;

function toSnakeCase(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const res = {};
  for (const k of Object.keys(obj)) {
    const snake = k.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    res[snake] = obj[k];
  }
  return res;
}

const MAX_SYNC_LOG = 500;
const _syncLog = [];

export function getSyncLog() { return _syncLog.slice(); }
export function clearSyncLog() { _syncLog.length = 0; }

function classifyError(e) {
  const code = (e && e.code) || "";
  const msg = (e && e.message) || String(e);
  const isPermission = code === "42501" || msg.includes("permission") || msg.includes("row-level security");
  return {
    errorCode: code || "unknown",
    errorMsg: msg,
    status: isPermission ? "denied" : "failed",
    rawError: e
  };
}

function syncLog(entry) {
  const rec = { ts: Date.now(), ...entry };
  _syncLog.unshift(rec);
  if (_syncLog.length > MAX_SYNC_LOG) _syncLog.length = MAX_SYNC_LOG;

  if (localStorage.getItem("CIC_DEBUG") === "true") {
    const icon = rec.status === "ok" ? "✓" : rec.status === "denied" ? "✗ DENIED" : "✗ FAIL";
    const msg = `[Sync][${rec.db}][${rec.op}] ${rec.path} → ${icon}`;

    if (rec.status === "ok") {
      console.debug(msg);
    } else if (rec.status === "denied") {
      console.debug(msg, "[Handled by RBAC]");
    } else {
      const detail = [rec.errorCode, rec.errorMsg].filter(Boolean).join(" — ");
      console.warn(msg, detail || "");
    }
  }

  window.dispatchEvent(new CustomEvent("sync:log", { detail: rec }));
  return rec;
}


function toCamelCase(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const res = {};
  for (const k of Object.keys(obj)) {
    const camel = k.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    res[camel] = obj[k];
  }
  return res;
}

export async function directSaveSetting(name, payload) {
  if (state.client && state.online && state.ready) {
    const { error } = await state.client
      .from("legacy_records")
      .upsert({ collection: "settings", record_id: name, payload: payload, updated_at: new Date().toISOString() }, { onConflict: "collection,record_id" });
    if (error) {
      console.error("[SETTINGS] Direct Supabase upsert failed:", error);
      return false;
    }
    return true;
  }
  return false;
}

// Used before sign-in to hydrate only public website content through the
// server-side allowlist. It cannot request arbitrary records.
export async function fetchPublicLandingSettings() {
  if (!state.client) await initCloud();
  if (!state.client || !state.online) return null;
  const { data, error } = await state.client.functions.invoke("get-public-landing-settings", { body: {} });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data || null;
}

function localRecordTime(record) { return new Date(record?.updated_at || record?.updatedAt || 0).getTime(); }
async function applyRemoteRow(row) {
  if (row.collection === "settings") {
    // Treat Settings collection as global master data
    try {
      // NOT just the realtime payload - explicitly fetch the newest record
      const { data, error } = await state.client.from("legacy_records").select("*").eq("collection", "settings").eq("record_id", row.record_id).single();
      if (error) throw error;
      if (!data) return;

      const latestRow = data;
      const local = store.get("settings", latestRow.record_id);

      const cloudTime = new Date(latestRow.updated_at).getTime();
      const localTime = localRecordTime(local);

      console.log(`\n[SETTINGS]`);
      console.log(`Cloud Version: ${new Date(latestRow.updated_at).toISOString().replace("T", " ").substring(0, 16)}`);
      console.log(`Local Version: ${local ? new Date(localTime).toISOString().replace("T", " ").substring(0, 16) : "None"}`);

      if (!local || cloudTime > localTime) {
        console.log(`Action: Replace Cache`);
        // Force replace - delete local record, insert fresh record
        if (local) {
          store.remove("settings", latestRow.record_id, { silent: true });
        }
        db.save("settings", { ...latestRow.payload, id: latestRow.record_id, updated_at: latestRow.updated_at }, { sync: false, origin: "remote" });
        localStorage.setItem("HALQA:hasCloudSettings", "true");
        window.dispatchEvent(new CustomEvent("app:settings-updated", { detail: { id: latestRow.record_id } }));
      } else {
        console.log(`Action: Ignore (Local is newer or equal)`);
      }
    } catch (err) {
      console.error("[SETTINGS] Failed to process realtime settings update:", err);
    }
  } else {
    // Normal collections behaviour
    const local = store.get(row.collection, row.record_id);
    if (local && new Date(row.updated_at).getTime() < localRecordTime(local)) return;
    db.save(row.collection, { ...row.payload, id: row.record_id, updated_at: row.updated_at }, { sync: false, origin: "remote" });
  }
}

async function applyNormalizedRow(table, row) {
  console.log("[REALTIME] Applying normalized row to table:", table, row);
  const camelRow = toCamelCase(row);
  const local = store.get(table, camelRow.id);
  const remoteTime = new Date(camelRow.updated_at || camelRow.updatedAt || 0).getTime();
  const localTime = local ? localRecordTime(local) : 0;

  console.log("[REALTIME] Remote time:", remoteTime, "Local time:", localTime);

  // Only update if remote is newer
  if (local && remoteTime <= localTime) {
    console.log("[REALTIME] Skipping - local is newer or equal");
    return;
  }

  db.save(table, camelRow, { sync: false, origin: "remote" });
  console.log("[REALTIME] Applied update to table:", table);
}

async function reconcileDevices() {
  if (!state.ready || !state.authReady || !state.online) return;
  if (!realtimeChannel) void startListeners();
  await flushQueue();
  startReconcileTimer();
}
function installNetworkHandlers() {
  if (networkHandlersInstalled) return;
  networkHandlersInstalled = true;
  window.addEventListener("online", () => { state.online = true; void reconcileDevices(); });
  window.addEventListener("offline", () => { state.online = false; });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void reconcileDevices(); });
}
function startReconcileTimer() {
  if (reconcileTimer) return;
  reconcileTimer = window.setInterval(() => { if (state.ready && state.authReady && state.online) void refreshCloudData(); }, RECONCILE_INTERVAL_MS);
}

export async function initCloud() {
  if (state.mode !== "cloud" || (state.ready && state.client)) return;
  state.cloudStatus = "connecting";
  try {
    if (!window.supabase) await new Promise((resolve, reject) => {
      const script = document.createElement("script"); script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"; script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
    });
    state.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    installNetworkHandlers();
    state.client.auth.onAuthStateChange((_event, session) => {
      state.authReady = Boolean(session);
      window.dispatchEvent(new CustomEvent("auth:change", { detail: { uid: session?.user?.id || null } }));
      if (session && state.ready) void reconcileDevices();
    });
    const { data: { session } } = await state.client.auth.getSession();
    state.authReady = Boolean(session);
    const normalizedTables = [];

    setSyncHandler(async (op) => {
      if (!state.authReady || !state.online) return false;
      const path = `${op.col}/${op.id}`;
      try {
        const isNormalized = normalizedTables.includes(op.col);
        const table = isNormalized ? op.col : "legacy_records";

        if (op.action === "remove") {
          const query = state.client.from(table).delete();
          const { error } = isNormalized
            ? await query.eq("id", op.id)
            : await query.eq("collection", op.col).eq("record_id", String(op.id));
          if (error) throw error;
        } else {
          // Fetch existing record to check for conflict
          let cloudData = null;
          if (isNormalized) {
            const { data, error } = await state.client.from(table).select("*").eq("id", op.id).maybeSingle();
            if (!error && data) cloudData = toCamelCase(data);
          } else {
            const { data, error } = await state.client.from("legacy_records").select("*").eq("collection", op.col).eq("record_id", String(op.id)).maybeSingle();
            if (!error && data) cloudData = data.payload ? { ...data.payload, id: data.record_id, updated_at: data.updated_at } : null;
          }

          if (cloudData) {
            const cloudStamp = localRecordTime(cloudData);
            const localStamp = localRecordTime(op.data);

            if (cloudStamp > localStamp) {
              console.warn("[SYNC CONFLICT] Cloud record is newer; local write dropped", {
                path,
                cloudUpdatedAt: cloudStamp,
                localUpdatedAt: localStamp,
                cloudDevice: cloudData._lastModifiedBy || "unknown",
                localDevice: op.deviceId || "unknown"
              });
              db.applyRemote(op.col, op.id, { ...cloudData, id: cloudData.id || op.id });
              syncLog({ db: "Supabase", col: op.col, path, op: "conflict-skip-stale", status: "ok" });
              return true;
            }
          }

          // Re-inject device tracking to mirror old Firebase logic
          const dataToSync = {
            ...op.data,
            _lastModifiedBy: op.deviceId || localStorage.getItem("HALQA:deviceId") || "device-unknown",
            _lastSyncAt: Date.now()
          };

          const payload = isNormalized
            ? toSnakeCase(dataToSync)
            : { collection: op.col, record_id: String(op.id), payload: dataToSync, updated_at: new Date(dataToSync.updatedAt || Date.now()).toISOString() };

          const onConflict = isNormalized ? "id" : "collection,record_id";
          const { error } = await state.client.from(table).upsert(payload, { onConflict });
          if (error) throw error;
        }
        syncLog({ db: "Supabase", col: op.col, path, op: op.action, status: "ok" });
        return true;
      } catch (error) {
        console.error("Supabase Sync Error:", error);
        const { errorCode, errorMsg, status } = classifyError(error);
        syncLog({ db: "Supabase", col: op.col, path, op: op.action, status, errorCode, errorMsg, rawError: error });
        return false;
      }
    });
    state.ready = true;
    state.cloudStatus = "connected";
    await reconcileDevices();
  } catch (error) { state.cloudError = error.message; state.cloudStatus = "error"; console.error("Supabase init failed", error); }
}

async function fetchCollections(collections) {
  if (!state.ready || !state.authReady) return false;
  if (!state.online) {
    console.warn("[BOOTSTRAP] Offline mode. Proceeding with IndexedDB cache.");
    return true; // Fallback to cache
  }

  const normalizedTables = [];
  const legacyCollections = collections.filter(c => !normalizedTables.includes(c));
  const normCollections = collections.filter(c => normalizedTables.includes(c));

  let attempts = 0;
  while (attempts < 3) {
    try {
      let newestRemoteTimestamp = lastCloudPullAt;
      const batches = new Map();

      // 1. Fetch Legacy Records
      if (legacyCollections.length > 0) {
        let from = 0;
        while (true) {
          let query = state.client.from("legacy_records").select("*").in("collection", legacyCollections).order("updated_at", { ascending: true }).range(from, from + PAGE_SIZE - 1);
          if (lastCloudPullAt) query = query.gte("updated_at", lastCloudPullAt);

          const { data, error } = await query;
          if (error) throw error;

          (data || []).forEach((row) => {
            const local = store.get(row.collection, row.record_id);
            const cloudTime = new Date(row.updated_at).getTime();
            const localTime = localRecordTime(local);

            if (local && cloudTime < localTime) return;

            if (row.collection === "settings") {
              if (local) store.remove("settings", row.record_id, { silent: true });
            }

            const records = batches.get(row.collection) || [];
            records.push({ ...row.payload, id: row.record_id, updated_at: row.updated_at });
            batches.set(row.collection, records);
            if (!newestRemoteTimestamp || row.updated_at > newestRemoteTimestamp) newestRemoteTimestamp = row.updated_at;
          });

          if (!data || data.length < PAGE_SIZE) break;
          from += PAGE_SIZE;
          await new Promise(r => setTimeout(r, 0));
        }
      }

      // 2. Fetch Normalized Tables
      for (const table of normCollections) {
        let from = 0;
        while (true) {
          // Normalize tables usually have 'updated_at' if we added it, assuming they do
          // Or just pull all if no updated_at
          let query = state.client.from(table).select("*").range(from, from + PAGE_SIZE - 1);

          // Try fetching, assuming they don't have updated_at yet in phase 2 unless we added it
          const { data, error } = await query;
          if (error) throw error;

          (data || []).forEach(row => {
            const records = batches.get(table) || [];
            records.push(toCamelCase(row));
            batches.set(table, records);
          });

          if (!data || data.length < PAGE_SIZE) break;
          from += PAGE_SIZE;
          await new Promise(r => setTimeout(r, 0));
        }
      }

      batches.forEach((records, collection) => store.mergeRemote(collection, records));

      if (batches.has("settings")) {
        localStorage.setItem("HALQA:hasCloudSettings", "true");
        window.dispatchEvent(new CustomEvent("app:settings-updated", { detail: { batch: true } }));
      }



      lastCloudPullAt = newestRemoteTimestamp;
      markSyncTime();
      return true;
    } catch (error) {
      attempts++;
      console.error(`[BOOTSTRAP] Fetch failed (Attempt ${attempts}/3):`, error);
      if (attempts >= 3) {
        console.warn("[BOOTSTRAP] Max retries reached. Falling back to IndexedDB cache.");
        return true; // Don't block app start, use local cache
      }
      await new Promise(r => setTimeout(r, 500 * attempts));
    }
  }
  return false;
}

export async function bootstrapMasterData() {
  console.log("[BOOTSTRAP] Fetching master data...");
  const collections = ["settings", "userRoles", "users", "academic_sessions", "terms", "classes", "sections", "subjects"];
  const result = await fetchCollections(collections);

  // Check for a newer backup in the cloud (handles fresh-device & offline-recovery scenarios)
  try {
    const { checkLatestBackupOnBoot } = await import("../modules/backupSync.js");
    await checkLatestBackupOnBoot();
  } catch (e) {
    console.warn("[BOOTSTRAP] checkLatestBackupOnBoot error (non-fatal):", e.message);
  }

  // Check for a seed artifact in the cloud (initialization / fallback)
  try {
    const { checkLatestSeedOnBoot } = await import("../modules/seedSync.js");
    await checkLatestSeedOnBoot();
  } catch (e) {
    console.warn("[BOOTSTRAP] checkLatestSeedOnBoot error (non-fatal):", e.message);
  }

  return result;
}

export async function bootstrapUserData() {
  console.log("[BOOTSTRAP] Fetching user data...");
  const collections = ["staff", "students", "family", "myprofile"];
  return fetchCollections(collections);
}

export async function refreshCloudData() {
  if (!state.ready || !state.authReady) return false;
  if (hydrationPromise) return hydrationPromise;

  hydrationPromise = (async () => {
    try {
      let from = 0;
      let newestRemoteTimestamp = lastCloudPullAt;
      while (true) {
        let query = state.client.from("legacy_records").select("*").order("updated_at", { ascending: true }).range(from, from + PAGE_SIZE - 1);
        if (lastCloudPullAt) query = query.gte("updated_at", lastCloudPullAt);
        const { data, error } = await query;
        if (error) throw error;
        const batches = new Map();
        (data || []).forEach((row) => {
          const local = store.get(row.collection, row.record_id);
          if (local && new Date(row.updated_at).getTime() < localRecordTime(local)) return;
          const records = batches.get(row.collection) || [];
          records.push({ ...row.payload, id: row.record_id, updated_at: row.updated_at });
          batches.set(row.collection, records);
          if (!newestRemoteTimestamp || row.updated_at > newestRemoteTimestamp) newestRemoteTimestamp = row.updated_at;
        });
        batches.forEach((records, collection) => store.mergeRemote(collection, records));
        if (!data || data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      lastCloudPullAt = newestRemoteTimestamp;
      markSyncTime();
      return true;
    } catch (error) { console.error("Failed to hydrate from legacy_records:", error); return false; }
    finally { hydrationPromise = null; }
  })();
  return hydrationPromise;
}

export async function startListeners() {
  if (!state.ready || !state.authReady || realtimeChannel) return;
  realtimeStopping = false;
  state.realtimeStatus = "connecting";

  realtimeChannel = state.client.channel("database_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "legacy_records" }, (payload) => {
      if (payload.eventType === "DELETE") db.remove(payload.old.collection, payload.old.record_id, { sync: false });
      else if (payload.new) applyRemoteRow(payload.new);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "users" }, (payload) => {
      console.log("[REALTIME] Users table changed:", payload.eventType);
      if (payload.eventType === "DELETE") db.remove("users", payload.old.id, { sync: false });
      else if (payload.new) applyNormalizedRow("users", payload.new);
      else if (payload.old && payload.new) applyNormalizedRow("users", payload.new);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "user_roles" }, (payload) => {
      console.log("[REALTIME] User roles changed:", payload.eventType);
      if (payload.eventType === "DELETE") db.remove("userRoles", payload.old.id, { sync: false });
      else if (payload.new) applyNormalizedRow("userRoles", payload.new);
      else if (payload.old && payload.new) applyNormalizedRow("userRoles", payload.new);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "roles" }, (payload) => {
      console.log("[REALTIME] Roles changed:", payload.eventType);
      if (payload.eventType === "DELETE") db.remove("roles", payload.old.id, { sync: false });
      else if (payload.new) applyNormalizedRow("roles", payload.new);
      else if (payload.old && payload.new) applyNormalizedRow("roles", payload.new);
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "backup_metadata" }, async (payload) => {
      try {
        const { handleRemoteBackupEvent } = await import("../modules/backupSync.js");
        await handleRemoteBackupEvent(payload.new);
      } catch (e) { console.warn("[BACKUP] handleRemoteBackupEvent error:", e); }
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "seed_metadata" }, async (payload) => {
      try {
        const { handleRemoteSeedEvent } = await import("../modules/seedSync.js");
        await handleRemoteSeedEvent(payload.new);
      } catch (e) { console.warn("[SEED] handleRemoteSeedEvent error:", e); }
    });

  // Add students table if it exists
  realtimeChannel = realtimeChannel.on("postgres_changes", { event: "*", schema: "public", table: "students" }, (payload) => {
    console.log("[REALTIME] Students changed:", payload.eventType);
    if (payload.eventType === "DELETE") db.remove("students", payload.old.id, { sync: false });
    else if (payload.new) applyNormalizedRow("students", payload.new);
    else if (payload.old && payload.new) applyNormalizedRow("students", payload.new);
  });

  // Add staff table if it exists
  realtimeChannel = realtimeChannel.on("postgres_changes", { event: "*", schema: "public", table: "staff" }, (payload) => {
    console.log("[REALTIME] Staff changed:", payload.eventType);
    if (payload.eventType === "DELETE") db.remove("staff", payload.old.id, { sync: false });
    else if (payload.new) applyNormalizedRow("staff", payload.new);
    else if (payload.old && payload.new) applyNormalizedRow("staff", payload.new);
  });

  realtimeChannel.subscribe((status) => {
    console.log("[REALTIME] Channel status:", status);
    if (status === "SUBSCRIBED") {
      state.realtimeStatus = "connected";
      void refreshCloudData();
      return;
    }
    if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
      if (realtimeStopping) return;
      state.realtimeStatus = "reconnecting";
      const failedChannel = realtimeChannel;
      realtimeChannel = null;
      if (failedChannel) void state.client.removeChannel(failedChannel);
      if (!realtimeRetryTimer && state.online && state.authReady) {
        realtimeRetryTimer = window.setTimeout(() => {
          realtimeRetryTimer = null;
          void startListeners();
        }, 3000);
      }
    }
  });
}
export async function stopListeners() {
  realtimeStopping = true;
  if (realtimeChannel) { await state.client.removeChannel(realtimeChannel); realtimeChannel = null; }
  if (realtimeRetryTimer) { window.clearTimeout(realtimeRetryTimer); realtimeRetryTimer = null; }
  state.realtimeStatus = "disconnected";
  if (reconcileTimer) { window.clearInterval(reconcileTimer); reconcileTimer = null; }
}
export function getState() { return state; }
export function setMode(mode) { state.mode = mode; localStorage.setItem("HALQA:mode", mode); if (mode === "cloud") void initCloud(); }
export function logFirebaseDiagnostics(event) { console.log("[Supabase Diagnostics]", event, state); }
