// js/modules/seedSync.js
//
// Seed Data Synchronization Engine
//
// DESIGN RULES (User Constraints):
//   1. Seed data is FALLBACK/INITIALIZATION data only.
//   2. NEVER overwrite existing administrator-managed settings.
//   3. Only apply seed data automatically if the database/settings are genuinely empty.
//   4. Do NOT duplicate the existing legacy_records/settings sync engine.
//   5. Prevent restore/upload loops using { sync: false } or origin: "remote".

import { state } from "../core/supabase.js";
import { store } from "../core/store.js";
import { db } from "../core/db.js";
import { getCurrentUser } from "../core/auth.js";
import { toast } from "../core/utils.js";

const SEED_BUCKET = "seeds";
const SEED_META_TABLE = "seed_metadata";
const SCHOOL_ID = "default";
const SCHEMA_VERSION = "1";
const LS_SEED_VERSION = "CIC KANO:lastSeedVersion";

// Flag to prevent overlapping operations
const RESTORE_FLAG = "__CICK_SEED_RESTORE_IN_PROGRESS";

function isClientReady() {
  return state.client && state.ready && state.authReady && state.online;
}

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

/**
 * Checks if the system is "genuinely empty".
 * We consider the system empty if we have NEVER received any settings from the cloud database.
 */
function isSystemGenuinelyEmpty() {
  const hasCloudSettings = localStorage.getItem("CIC KANO:hasCloudSettings") === "true";
  return !hasCloudSettings;
}

/**
 * Download and apply a seed artifact identified by a metadata row.
 * ONLY applies if forced, or if the system is genuinely empty.
 * 
 * @param {object} meta - A row from public.seed_metadata
 * @param {boolean} force - If true, bypasses the "genuinely empty" check (Admin triggered)
 */
export async function applySeedArtifact(meta, force = false) {
  if (window[RESTORE_FLAG]) {
    console.info("[SEED SYNC] Seed application already in progress.");
    return;
  }

  if (!force && !isSystemGenuinelyEmpty()) {
    console.info("[SEED SYNC] System is not empty. Ignoring seed artifact (respecting Admin settings).");
    localStorage.setItem(LS_SEED_VERSION, String(meta.seed_version));
    return;
  }

  if (!isClientReady()) {
    console.warn("[SEED SYNC] Client not ready - deferring seed download.");
    return;
  }

  window[RESTORE_FLAG] = true;
  console.info(`[SEED SYNC] Downloading artifact: ${meta.storage_path} (Version: ${meta.seed_version})`);

  try {
    const { data: blobData, error: dlError } = await state.client.storage
      .from(SEED_BUCKET)
      .download(meta.storage_path);

    if (dlError) throw new Error(`Download failed: ${dlError.message}`);
    if (!blobData) throw new Error("Download returned empty data.");

    const computedHash = await sha256(blobData);
    if (computedHash !== meta.checksum) {
      throw new Error(`Checksum mismatch. Expected ${meta.checksum}, got ${computedHash}`);
    }
    
    console.info("[SEED SYNC] Checksum verified.");

    const jsonStr = await blobData.text();
    let seedData;
    try { seedData = JSON.parse(jsonStr); }
    catch (e) { throw new Error("Seed JSON is invalid."); }

    if (!seedData || !seedData.settings) {
      throw new Error("Seed structure is invalid - missing .settings property.");
    }

    console.info("[SEED SYNC] Applying seed artifact.");
    
    Object.keys(seedData.settings).forEach(key => {
        const existing = db.setting(key);
        if (force || !existing) {
            db.saveSetting(key, seedData.settings[key], { sync: true });
        }
    });

    localStorage.setItem(LS_SEED_VERSION, String(meta.seed_version));
    
    console.info(`[SEED SYNC] Seed artifact applied successfully.`);
    if (force) {
        toast("Seed data initialized and broadcasted.", "success");
        window.dispatchEvent(new CustomEvent("app:settings-updated", { detail: { batch: true } }));
        window.dispatchEvent(new CustomEvent("master-data-updated"));
    }

  } catch (err) {
    console.error("[SEED SYNC] Failed to apply seed artifact:", err.message);
    if (force) toast(`Seed apply failed: ${err.message}`, "error");
  } finally {
    window[RESTORE_FLAG] = false;
  }
}

/**
 * Handle Realtime INSERT on seed_metadata.
 */
export async function handleRemoteSeedEvent(newRow) {
  console.info("[SEED SYNC] Metadata received.");
  if (!newRow || !newRow.seed_version || !newRow.storage_path) return;
  
  const localVersion = Number(localStorage.getItem(LS_SEED_VERSION) || 0);
  if (newRow.seed_version <= localVersion) return;

  console.info(`[SEED SYNC] Version: ${newRow.seed_version}`);
  
  await applySeedArtifact(newRow, false);
}

/**
 * Called on boot to check if there is a newer seed artifact.
 * Only applies it if the system is genuinely empty.
 */
export async function checkLatestSeedOnBoot() {
  if (!isClientReady()) return;

  try {
    const { data, error } = await state.client
      .from(SEED_META_TABLE)
      .select("*")
      .eq("school_id", SCHOOL_ID)
      .eq("status", "active")
      .order("seed_version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return;

    const localVersion = Number(localStorage.getItem(LS_SEED_VERSION) || 0);
    if (data.seed_version > localVersion) {
      await applySeedArtifact(data, false);
    }
  } catch (err) {
    console.warn("[SEED] checkLatestSeedOnBoot unexpected error:", err.message);
  }
}

/**
 * Admin Action: Publish current local settings as a global seed artifact.
 */
export async function publishGlobalSeedData(onStatus) {
  if (!isClientReady()) throw new Error("Cloud connection not ready.");
  
  onStatus?.("Building seed artifact...");
  
  // Gather only the seedable settings
  const seedableKeys = ["branding", "sections", "classes", "subjects", "grading", "fees", "sessions"];
  const seedSettings = {};
  
  seedableKeys.forEach(key => {
      const val = db.setting(key);
      if (val) seedSettings[key] = val;
  });
  
  const snapshot = {
      app: "CIC KANO-SMS",
      schemaVersion: SCHEMA_VERSION,
      exportedAt: Date.now(),
      type: "seed",
      settings: seedSettings
  };
  
  const jsonStr = JSON.stringify(snapshot);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const byteSize = blob.size;
  const version = Date.now();
  const path = `${SCHOOL_ID}/${version}_seed.json`;
  
  onStatus?.("Uploading seed artifact...");
  const checksum = await sha256(blob);
  
  const { error: uploadError } = await state.client.storage
      .from(SEED_BUCKET)
      .upload(path, blob, { upsert: false, cacheControl: "3600", contentType: "application/json" });
      
  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);
  
  onStatus?.("Updating seed registry...");
  
  // Mark old seeds as superseded
  await state.client
      .from(SEED_META_TABLE)
      .update({ status: "superseded" })
      .eq("school_id", SCHOOL_ID)
      .eq("status", "active");
      
  const { data: authData } = await state.client.auth.getUser();
  const createdBy = authData?.user?.id || null;
  const user = getCurrentUser();
  
  const meta = {
      school_id: SCHOOL_ID,
      created_by: createdBy,
      created_by_email: user?.email || authData?.user?.email || "",
      storage_path: path,
      seed_version: version,
      schema_version: SCHEMA_VERSION,
      checksum,
      status: "active",
      file_size_bytes: byteSize
  };
  
  const { error: metaError } = await state.client.from(SEED_META_TABLE).insert(meta);
  
  if (metaError) {
      await state.client.storage.from(SEED_BUCKET).remove([path]);
      throw new Error(`Metadata insert failed: ${metaError.message}`);
  }
  
  // Update local version so we don't trigger on our own event
  localStorage.setItem(LS_SEED_VERSION, String(version));
  
  onStatus?.("Global Seed Data published successfully.");
  console.info("[SEED] Publish complete. Version:", version);
}
