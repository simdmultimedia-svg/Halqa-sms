// js/modules/backupSync.js
//
// Centralised backup upload / restore / cross-device sync engine.
//
// DESIGN RULES (non-negotiable):
//   1. Backup JSON blobs live ONLY in Supabase Storage (private "backups" bucket).
//   2. Supabase table `backup_metadata` holds lightweight pointer rows only.
//   3. Restore NEVER uses { sync: true } — restored records must NOT be re-uploaded.
//   4. window.__CICK_RESTORE_IN_PROGRESS guards against sync loops.
//   5. CIC KANO:lastRestoredBackupVersion (localStorage) prevents duplicate restores.
//   6. A safety snapshot is written to IndexedDB BEFORE every remote restore.
//   7. No Firebase / Firestore dependencies anywhere in this file.
//   8. Service-role key is NOT used — anon key + RLS policies are sufficient.

import { state } from "../core/supabase.js";
import { store }  from "../core/store.js";
import { idbGet, idbSet } from "../core/idb.js";
import { FIRESTORE_COLLECTIONS } from "../core/db.js";
import { getCurrentUser } from "../core/auth.js";
import { toast } from "../core/utils.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const BUCKET            = "backups";
const META_TABLE        = "backup_metadata";
const SCHOOL_ID         = "default"; // single-tenant; extend when multi-tenant needed
const SCHEMA_VERSION    = "1";
const LS_RESTORED_VER   = "CIC KANO:lastRestoredBackupVersion";
const IDB_SAFETY_KEY    = "emergencyBackupSnapshot";
const RESTORE_FLAG      = "__CICK_RESTORE_IN_PROGRESS";
const UPLOAD_FLAG       = "__CICK_UPLOAD_IN_PROGRESS";

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Compute SHA-256 of a string/Blob; returns lowercase hex */
async function sha256(input) {
  let buffer;
  if (input instanceof Blob) {
    buffer = await input.arrayBuffer();
  } else {
    buffer = new TextEncoder().encode(String(input));
  }
  const hashBuf = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Show/hide a full-screen overlay with a message */
let _overlay = null;
function showOverlay(message, showSpinner = true) {
  if (!_overlay) {
    _overlay = document.createElement("div");
    _overlay.id = "backup-sync-overlay";
    _overlay.style.cssText = [
      "position:fixed;inset:0;z-index:99999",
      "background:rgba(15,23,42,0.82)",
      "display:flex;flex-direction:column;align-items:center;justify-content:center",
      "gap:16px;color:#fff;font-family:inherit;font-size:1rem;backdrop-filter:blur(4px)"
    ].join(";");
    document.body.appendChild(_overlay);
  }
  _overlay.innerHTML = `
    ${showSpinner ? `<div style="width:40px;height:40px;border:3px solid rgba(255,255,255,.3);
      border-top-color:#60a5fa;border-radius:50%;animation:bspin .8s linear infinite"></div>` : ""}
    <span style="max-width:320px;text-align:center;line-height:1.5">${message}</span>
  `;
  if (!document.getElementById("bspin-style")) {
    const s = document.createElement("style");
    s.id = "bspin-style";
    s.textContent = "@keyframes bspin{to{transform:rotate(360deg)}}";
    document.head.appendChild(s);
  }
  _overlay.style.display = "flex";
}

function hideOverlay() {
  if (_overlay) _overlay.style.display = "none";
}

/** Returns true only when supabase client is ready and authenticated */
function isClientReady() {
  return state.client && state.ready && state.authReady && state.online;
}

/** Persist the version of the last successfully restored backup */
function saveRestoredVersion(version) {
  localStorage.setItem(LS_RESTORED_VER, String(version));
}

function getRestoredVersion() {
  const v = localStorage.getItem(LS_RESTORED_VER);
  return v ? Number(v) : 0;
}

// ─── Safety Snapshot ──────────────────────────────────────────────────────────

/**
 * Capture the full in-memory store and persist to IndexedDB only.
 * NOT saved to localStorage (too large). NOT synced to cloud.
 */
async function createSafetySnapshot() {
  const snap = { capturedAt: Date.now(), data: {} };
  FIRESTORE_COLLECTIONS.forEach(col => {
    snap.data[col] = store.map(col); // plain object {id: record}
  });
  await idbSet(IDB_SAFETY_KEY, snap);
  console.info("[BACKUP] Safety snapshot saved to IndexedDB.");
  return snap;
}

/** Restore from the IndexedDB safety snapshot (emergency fallback only) */
async function restoreFromSafetySnapshot() {
  const snap = await idbGet(IDB_SAFETY_KEY);
  if (!snap || !snap.data) {
    console.warn("[BACKUP] No safety snapshot available.");
    return false;
  }
  Object.entries(snap.data).forEach(([col, records]) => {
    store.clear(col);
    const arr = Object.values(records);
    if (arr.length > 0) store.mergeRemote(col, arr);
  });
  console.info("[BACKUP] Safety snapshot restored from IndexedDB.");
  return true;
}

// ─── Upload (Admin only) ──────────────────────────────────────────────────────

/**
 * Upload the current in-memory snapshot to Supabase Storage and insert metadata.
 *
 * @param {object} ctx           - App context: { user }
 * @param {Function} onProgress  - Called with (percent 0-100)
 * @param {Function} onStatus    - Called with a status string for UI
 * @returns {Promise<object>}    - The inserted backup_metadata row
 */
export async function uploadBackup(ctx, onProgress, onStatus) {
  if (window[UPLOAD_FLAG]) throw new Error("An upload is already in progress.");
  if (!isClientReady())   throw new Error("Cloud connection not ready. Please ensure you are online.");

  window[UPLOAD_FLAG] = true;
  try {
    // 1. Build snapshot JSON
    onStatus?.("Building snapshot…");
    const snapshot = { app: "CIC KANO-SMS", schemaVersion: SCHEMA_VERSION, exportedAt: Date.now(), data: {} };
    FIRESTORE_COLLECTIONS.forEach(col => { snapshot.data[col] = store.map(col); });
    const jsonStr    = JSON.stringify(snapshot);
    const blob       = new Blob([jsonStr], { type: "application/json" });
    const byteSize   = blob.size;
    const version    = Date.now(); // unix ms — monotonically increasing
    const path       = `${SCHOOL_ID}/${version}_backup.json`;

    // 2. Compute checksum
    onStatus?.("Computing checksum…");
    onProgress?.(5);
    const checksum = await sha256(blob);
    onProgress?.(10);

    // 3. Count records
    let recordCount = 0;
    FIRESTORE_COLLECTIONS.forEach(col => { recordCount += store.all(col).length; });

    // 4. Upload blob to private Storage bucket
    onStatus?.("Uploading backup to cloud…");

    // Supabase JS v2 does not support onUploadProgress natively in the browser SDK;
    // simulate incremental progress using a timed interval during the upload.
    let progressVal = 10;
    const progressTimer = setInterval(() => {
      progressVal = Math.min(progressVal + 5, 85);
      onProgress?.(progressVal);
    }, 400);

    const { error: uploadError } = await state.client.storage
      .from(BUCKET)
      .upload(path, blob, {
        upsert:       true,
        cacheControl: "3600",
        contentType:  "application/json"
      });

    clearInterval(progressTimer);
    onProgress?.(90);

    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

    // 5. Mark all previous active backups as superseded
    onStatus?.("Updating backup registry…");
    await state.client
      .from(META_TABLE)
      .update({ status: "superseded" })
      .eq("school_id", SCHOOL_ID)
      .eq("status", "active");

    // 6. Insert lightweight metadata row — triggers Realtime for all other devices
    const { data: authData, error: authError } = await state.client.auth.getUser();
    if (authError) {
      await state.client.storage.from(BUCKET).remove([path]);
      throw new Error(`Auth verification failed: ${authError.message}`);
    }
    const createdBy = authData?.user?.id || null;

    const user = getCurrentUser(); // for email fallback
    const meta = {
      school_id:        SCHOOL_ID,
      created_by:       createdBy,
      created_by_email: user?.email || ctx?.user?.email || authData?.user?.email || "",
      storage_path:     path,
      backup_version:   version,
      schema_version:   SCHEMA_VERSION,
      checksum,
      status:           "active",
      record_count:     recordCount,
      file_size_bytes:  byteSize
    };

    console.info(`[BACKUP] Supabase Auth User ID: ${createdBy}`);
    console.info(`[BACKUP] Metadata created_by: ${meta.created_by}`);
    console.info("[BACKUP] Metadata insert starting...");

    const { data: metaRow, error: metaError } = await state.client
      .from(META_TABLE)
      .insert(meta)
      .select()
      .single();

    if (metaError) {
      // Rollback: delete the orphaned backup file from Storage
      console.warn(`[BACKUP] Metadata insert failed. Rolling back storage file: ${path}`);
      await state.client.storage.from(BUCKET).remove([path]);
      throw new Error(`Metadata insert failed: ${metaError.message}`);
    }

    onProgress?.(100);
    onStatus?.("Backup uploaded successfully");
    console.info("[BACKUP] Upload complete. Version:", version, "Path:", path, "Size:", byteSize, "bytes");

    // Mark the uploading device so it skips its own Realtime event
    saveRestoredVersion(version);

    return metaRow;
  } finally {
    window[UPLOAD_FLAG] = false;
  }
}

// ─── Restore (all devices) ────────────────────────────────────────────────────

/**
 * Download and atomically restore a backup identified by a metadata row.
 * Safe-guards: version dedup, checksum verification, safety snapshot, loop prevention.
 *
 * @param {object} meta   - A row from public.backup_metadata
 * @param {string} source - "remote-realtime" | "remote-bootstrap" | "remote-reconnect"
 */
export async function restoreFromMetadata(meta, source = "remote-realtime") {
  // ── Loop guard ──
  if (window[RESTORE_FLAG]) {
    console.info("[BACKUP] Restore already in progress — skipping duplicate event.");
    return;
  }

  // ── Version guard ──
  const restoredVersion = getRestoredVersion();
  if (meta.backup_version <= restoredVersion) {
    console.info(`[BACKUP] Skipping restore: received v${meta.backup_version}, already at v${restoredVersion}`);
    return;
  }

  if (!isClientReady()) {
    console.warn("[BACKUP] Client not ready — deferring restore.");
    return;
  }

  window[RESTORE_FLAG] = true;
  console.info(`[BACKUP] Starting restore — source:${source} version:${meta.backup_version} path:${meta.storage_path}`);

  try {
    // ── 1. UI: notify user ──
    showOverlay("New backup available — synchronizing…");
    toast("New backup available — synchronizing…", "info", 5000);

    // ── 2. Safety snapshot ──
    showOverlay("Creating safety snapshot…");
    await createSafetySnapshot();

    // ── 3. Download backup blob from private Storage ──
    showOverlay("Downloading backup from cloud…");
    const { data: blobData, error: dlError } = await state.client.storage
      .from(BUCKET)
      .download(meta.storage_path);

    if (dlError) throw new Error(`Download failed: ${dlError.message}`);
    if (!blobData) throw new Error("Download returned empty data.");

    // ── 4. Verify checksum ──
    showOverlay("Verifying backup integrity…");
    const computedHash = await sha256(blobData);
    if (computedHash !== meta.checksum) {
      throw new Error(
        `Backup verification failed. Expected ${meta.checksum}, got ${computedHash}`
      );
    }
    console.info("[BACKUP] Checksum verified ✓");

    // ── 5. Parse JSON ──
    showOverlay("Parsing backup data…");
    const jsonStr = await blobData.text();
    let backup;
    try { backup = JSON.parse(jsonStr); }
    catch (e) { throw new Error("Backup JSON is invalid: " + e.message); }

    if (!backup || !backup.data || typeof backup.data !== "object") {
      throw new Error("Backup structure is invalid — missing .data property.");
    }

    // ── 6. Schema version check ──
    const bvSchema = String(backup.schemaVersion || "1");
    if (bvSchema !== SCHEMA_VERSION) {
      throw new Error(
        `Schema version mismatch: backup=${bvSchema}, app=${SCHEMA_VERSION}. Upgrade required.`
      );
    }

    // ── 7. Atomic restore ──
    showOverlay("Restoring data…");

    // Clear then merge — all with origin:"remote" so NO re-upload happens
    FIRESTORE_COLLECTIONS.forEach(col => {
      const records = backup.data[col];
      if (!records) return;

      // Handle both object-map {id: record} and array [] formats
      const arr = Array.isArray(records) ? records : Object.values(records);
      if (arr.length === 0) return;

      store.clear(col);
      // mergeRemote is the batch write path — does not trigger sync queue
      store.mergeRemote(col, arr);
    });

    // ── 8. Persist restored version ──
    saveRestoredVersion(meta.backup_version);

    // ── 9. Rebuild UI state ──
    showOverlay("Refreshing application…", false);

    // Emit events so active views re-render without a full page reload
    window.dispatchEvent(new CustomEvent("app:backup-restored", {
      detail: { version: meta.backup_version, source, recordCount: meta.record_count }
    }));
    window.dispatchEvent(new CustomEvent("master-data-updated"));
    window.dispatchEvent(new CustomEvent("app:settings-updated", { detail: { batch: true } }));

    console.info(`[BACKUP] Restore complete ✓ — source:${source} version:${meta.backup_version}`);

    // ── 10. Success UI ──
    hideOverlay();
    toast("Synchronization completed ✓", "success", 5000);

  } catch (err) {
    console.error("[BACKUP] Restore failed:", err.message);
    hideOverlay();
    toast(`Restore failed: ${err.message} — previous data preserved.`, "error", 8000);

    // Roll back to safety snapshot
    try {
      const rolled = await restoreFromSafetySnapshot();
      if (rolled) {
        toast("Emergency snapshot recovered.", "info", 4000);
        window.dispatchEvent(new CustomEvent("master-data-updated"));
      }
    } catch (rbErr) {
      console.error("[BACKUP] Safety snapshot restore also failed:", rbErr.message);
    }
  } finally {
    window[RESTORE_FLAG] = false;
  }
}

// ─── Bootstrap check (offline / fresh-device recovery) ───────────────────────

/**
 * Called at the end of bootstrapMasterData().
 * Fetches the latest active backup_metadata row and restores if newer than local.
 * Handles: fresh devices (no version), offline devices that reconnected, normal logins.
 */
export async function checkLatestBackupOnBoot() {
  if (!isClientReady()) {
    console.info("[BACKUP] checkLatestBackupOnBoot: client not ready — skipping.");
    return;
  }

  try {
    const { data, error } = await state.client
      .from(META_TABLE)
      .select("*")
      .eq("school_id", SCHOOL_ID)
      .eq("status", "active")
      .order("backup_version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("[BACKUP] checkLatestBackupOnBoot query error:", error.message);
      return;
    }

    if (!data) {
      console.info("[BACKUP] No active backup found in cloud — skipping.");
      return;
    }

    const localVersion = getRestoredVersion();
    if (data.backup_version <= localVersion) {
      console.info(`[BACKUP] Bootstrap: already at v${localVersion} — no restore needed.`);
      return;
    }

    console.info(`[BACKUP] Bootstrap: found newer backup v${data.backup_version} (local v${localVersion})`);
    await restoreFromMetadata(data, "remote-bootstrap");
  } catch (err) {
    console.warn("[BACKUP] checkLatestBackupOnBoot unexpected error:", err.message);
  }
}

// ─── Realtime event handler (called from supabase.js startListeners) ─────────

/**
 * Handle an INSERT event on backup_metadata from Supabase Realtime.
 * The uploader's own device is skipped (already at that version).
 *
 * @param {object} newRow - The newly inserted backup_metadata row
 */
export async function handleRemoteBackupEvent(newRow) {
  if (!newRow || !newRow.backup_version || !newRow.storage_path) {
    console.warn("[BACKUP] Received malformed backup_metadata Realtime event:", newRow);
    return;
  }

  const currentUser = getCurrentUser();
  // The device that uploaded already persisted the version — will fail version guard
  // We still let it through the version guard naturally (it's the same version).
  // No special email check needed; version dedup handles it cleanly.

  console.info("[BACKUP] Realtime: new backup event received, version:", newRow.backup_version);
  await restoreFromMetadata(newRow, "remote-realtime");
}

// ─── Reconnect hook ───────────────────────────────────────────────────────────

/**
 * Called by supabase.js when the browser comes back online (reconcileDevices).
 * Checks for any backup uploaded while this device was offline.
 */
export async function onReconnect() {
  console.info("[BACKUP] Online event — checking for missed backup updates.");
  await checkLatestBackupOnBoot();
}
