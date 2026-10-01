// Firebase Migration Utility
// Import collections from old Firebase project to new one
// Usage: window.cicMigrateFromOldFirebase()

import { db } from "../core/db.js";
import { toast } from "../core/utils.js";

const MIGRATION_KEY = "CIC KANO:migrationState";
import { FIRESTORE_COLLECTIONS } from "../core/db.js";
const BACKUP_COLLECTIONS = FIRESTORE_COLLECTIONS;

export function saveMigrationState(state) {
  localStorage.setItem(MIGRATION_KEY, JSON.stringify(state));
}

export function loadMigrationState() {
  try {
    return JSON.parse(localStorage.getItem(MIGRATION_KEY) || "{}");
  } catch {
    return {};
  }
}

export async function importFromJSON(jsonData) {
  if (!jsonData || typeof jsonData !== "object") {
    throw new Error("Invalid JSON data");
  }

  let imported = 0;
  const state = loadMigrationState();
  state.importedAt = Date.now();
  state.collectionStats = {};

  for (const [col, records] of Object.entries(jsonData)) {
    if (!Array.isArray(records) && typeof records === "object") {
      const recordArray = Object.values(records);
      try {
        recordArray.forEach((rec) => {
          if (rec && rec.id) {
            db.save(col, rec, { sync: false });
            imported++;
          }
        });
        state.collectionStats[col] = recordArray.length;
        console.info(`[MIGRATION] Imported ${recordArray.length} records to ${col}`);
      } catch (e) {
        console.warn(`[MIGRATION] Error importing ${col}:`, e.message);
      }
    }
  }

  state.totalImported = imported;
  saveMigrationState(state);
  return { imported, collections: Object.keys(state.collectionStats) };
}

// ─── Browser-based export (for exporting current data) ────────────────────────
export function exportCurrentData() {
  const backup = {};
  BACKUP_COLLECTIONS.forEach((col) => {
    const records = db.list(col);
    if (records.length > 0) {
      backup[col] = records;
    }
  });
  return backup;
}

export function downloadBackupAsJSON() {
  const backup = exportCurrentData();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cic-kano-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  console.info("[MIGRATION] Backup exported:", backup);
  toast("Backup exported to downloads", "success");
}

// ─── File import handler ──────────────────────────────────────────────────────
export async function importFromFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      try {
        const file = e.target.files?.[0];
        if (!file) return reject(new Error("No file selected"));

        const text = await file.text();
        const data = JSON.parse(text);
        const result = await importFromJSON(data);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    };
    input.click();
  });
}

// ─── Validation & repair utilities ────────────────────────────────────────────
export function validateImportedData() {
  const report = {
    users: db.list("users").length,
    userRoles: db.list("userRoles").length,
    students: db.list("students").length,
    staff: db.list("staff").length,
    invoices: db.list("invoices").length,
    receipts: db.list("receipts").length,
    attendance: db.list("attendance").length,
    counters: db.list("counters").length,
    issues: []
  };

  // Check for admin accounts
  const roles = db.list("userRoles");
  const hasAdmin = roles.some((r) => r.role === "Super Admin" || r.role === "Admin");
  if (!hasAdmin) {
    report.issues.push("No admin accounts found");
  }

  // Check for orphaned records
  const students = db.list("students");
  const staffList = db.list("staff");
  const users = db.list("users");

  if (students.length > 0 && users.length === 0) {
    report.issues.push(`${students.length} students but no user profiles`);
  }

  if (staffList.length > 0 && users.length === 0) {
    report.issues.push(`${staffList.length} staff but no user profiles`);
  }

  console.table(report);
  return report;
}

// ─── Quick migrate to new Firebase (from localStorage backup) ───────────────────
export async function quickMigrateLocalStorage() {
  let migrated = 0;
  const collections = FIRESTORE_COLLECTIONS;

  for (const col of collections) {
    try {
      const raw = localStorage.getItem("CIC KANO:" + col);
      if (!raw) continue;
      const records = JSON.parse(raw);
      Object.values(records).forEach((rec) => {
        if (rec && rec.id) {
          db.save(col, rec, { sync: false });
          migrated++;
        }
      });
      console.info(`[QUICK MIGRATE] ${col}: migrated`, Object.keys(records).length);
    } catch (e) {
      console.warn(`[QUICK MIGRATE] Failed for ${col}:`, e.message);
    }
  }

  console.info(`[QUICK MIGRATE] Total records migrated: ${migrated}`);
  toast(`Migrated ${migrated} records to cloud`, "success");
  return migrated;
}

// ─── Expose to window for console access ──────────────────────────────────────
window.cicExportData = exportCurrentData;
window.cicDownloadBackup = downloadBackupAsJSON;
window.cicImportFromFile = importFromFile;
window.cicValidateImport = validateImportedData;
window.cicQuickMigrate = quickMigrateLocalStorage;
window.cicMigrationState = loadMigrationState;

export default {
  importFromJSON,
  exportCurrentData,
  downloadBackupAsJSON,
  importFromFile,
  validateImportedData,
  quickMigrateLocalStorage
};
