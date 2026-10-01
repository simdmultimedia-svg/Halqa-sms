// Sync Audit & Security Verification Engine
// Generates a comprehensive report covering:
//   1. User document integrity (Firestore/users + RTDB/userRoles)
//   2. Role naming consistency (TitleCase ↔ lowercase)
//   3. Missing security rules for written collections
//   4. Permission-denied events from the live sync log
//   5. Sync failures and queue health
//   6. Recommended fixes
//
// This module is a pure read-only reporter — it never modifies data.
import { db, FIRESTORE_COLLECTIONS } from "./db.js";
import { getState, getSyncLog } from "./adapter.js";

// All collections the application writes to (union of RTDB + Firestore + app-level).
const ALL_WRITTEN_COLLECTIONS = [
  // RTDB
  "students", "staff", "families", "familyLedger", "familyInvoices", "payments", "invoices", "receipts",
  "attendance", "staffAttendance", "servicePayments", "results", "resultApprovals",
  "assignments", "lessonPlans", "examQuestions", "cbt", "cbtAttempts", "idCards",
  "behaviour", "activities", "payslips", "paymentVouchers", "staffSalaries",
  "salaryComplaints", "staffLoginMap", "passwordResetRequests", "auditLogs", "migrationLogs", "promotionLogs",
  "expenses", "inventory", "inventoryMoves", "vouchers", "restorePoints",
  "scholarships", "discounts", "studentScholarships", "studentDiscounts",
  "userRoles", "users", "counters", "settings"];

// Canonical role names accepted by the system (both forms).
const VALID_ROLES_TITLECASE = ["Super Admin", "Admin", "Principal", "Vice Principal", "Accountant", "Teacher", "Exam Officer", "Staff", "Parent", "Student"];
const VALID_ROLES_LOWER     = ["super_admin", "admin", "principal", "vice_principal", "accountant", "teacher", "exam_officer", "staff", "parent", "student"];
const ALL_VALID_ROLES        = new Set([...VALID_ROLES_TITLECASE, ...VALID_ROLES_LOWER]);

// Collections that have explicit rules in database.rules.json.
const RTDB_EXPLICIT_RULES = new Set([
  "userRoles", "users", "staffLoginMap", "passwordResetRequests", "counters", "payslips",
  "students", "families", "familyLedger", "familyInvoices", "staff",
  "invoices", "receipts", "payments",
  "attendance", "staffAttendance", "results", "resultApprovals",
  "examQuestions", "cbt", "cbtAttempts", "expenses", "inventory", "inventoryMoves",
  "paymentVouchers", "vouchers", "staffSalaries", "salaryComplaints",
  "activities", "auditLogs", "migrationLogs", "promotionLogs",
  "idCards", "behaviour", "assignments", "lessonPlans",
  "servicePayments", "restorePoints", "books", "bookSales",
  "scholarships", "discounts", "studentScholarships", "studentDiscounts"
]);



// ─── Main audit function ──────────────────────────────────────────────────────
export async function runSecurityAudit() {
  if (!auth.currentUser) {
    throw new Error("No authenticated user");
  }
  const uid = auth.currentUser.uid;

  const report = {
    generatedAt:      new Date().toISOString(),
    mode:             getState().mode,
    cloudReady:       getState().ready,
    authReady:        getState().authReady,
    currentUserUid:   uid,
    deviceId:         localStorage.getItem("CIC KANO:deviceId") || "unknown",

    // Section results
    userIntegrity:    [],
    roleIssues:       [],
    missingRtdbRules: [],
    
    permissionDenied: [],
    syncFailures:     [],
    multiDeviceConflicts: [],
    syncSuccesses:    0,
    pendingQueueSize: 0,
    recommendations:  []
  };

  // 1. ── User document integrity ──────────────────────────────────────────────
  const allUsers    = db.list("users");
  const allRoles    = db.list("userRoles");
  const roleMap     = Object.fromEntries(allRoles.map((r) => [r.uid || r.id, r]));

  // Check current user UID
  const adminUser   = allUsers.find((u) => u.uid === uid || u.id === uid);
  const adminRole   = roleMap[uid];

  report.userIntegrity.push({
    uid:          uid,
    label:        "Current User",
    hasUserDoc:   !!adminUser,
    hasRoleDoc:   !!adminRole,
    role:         adminRole?.role || adminUser?.role || "MISSING",
    status:       (adminUser && adminRole) ? "ok" : "MISSING"
  });

  if (!adminUser || !adminRole) {
    report.recommendations.push({
      severity: "CRITICAL",
      area:     "User Integrity",
      issue:    `Current User UID ${uid} is missing a ${!adminUser ? "users" : "userRoles"} document.`,
      fix:      "The bootstrapKnownAdmin() function in firebase.js will create these automatically on the next cloud sign-in."
    });
  }

  // Check all other users
  allUsers.forEach((u) => {
    const uid  = u.uid || u.id;
    const role = roleMap[uid];
    report.userIntegrity.push({
      uid,
      email:      u.email,
      hasUserDoc: true,
      hasRoleDoc: !!role,
      role:       role?.role || u.role || "MISSING",
      status:     role ? "ok" : "missing-role-doc"
    });
    if (!role) {
      report.recommendations.push({
        severity: "HIGH",
        area:     "User Integrity",
        issue:    `User ${u.email} (${uid}) has no userRoles document.`,
        fix:      `Call db.save("userRoles", { id: "${uid}", uid: "${uid}", role: "${u.role || "Staff"}", email: "${u.email}" })`
      });
    }
  });

  // 2. ── Role naming validation ───────────────────────────────────────────────
  allRoles.forEach((r) => {
    const uid  = r.uid || r.id;
    if (r.role && !ALL_VALID_ROLES.has(r.role)) {
      report.roleIssues.push({
        uid,
        email:        r.email,
        invalidRole:  r.role,
        suggestion:   _suggestRole(r.role)
      });
      report.recommendations.push({
        severity: "HIGH",
        area:     "Role Naming",
        issue:    `UID ${uid} has unrecognised role "${r.role}".`,
        fix:      `Update userRoles/${uid}.role to one of: ${VALID_ROLES_TITLECASE.join(", ")}`
      });
    }
  });

  // 3. ── Missing RTDB rules ───────────────────────────────────────────────────
  ALL_WRITTEN_COLLECTIONS.forEach((col) => {
    
    if (!RTDB_EXPLICIT_RULES.has(col)) {
      report.missingRtdbRules.push(col);
      report.recommendations.push({
        severity: "MEDIUM",
        area:     "RTDB Rules",
        issue:    `Collection "${col}" is written by the app but has no explicit rule in database.rules.json.`,
        fix:      `Add: "${col}": { ".read": "auth != null", ".write": "auth != null" } to database.rules.json`
      });
    }
  });

  // 4. ── Missing Firestore rules ──────────────────────────────────────────────
  ALL_WRITTEN_COLLECTIONS.forEach((col) => {
    if (!FIRESTORE_EXPLICIT_RULES.has(col)) {
      report.missingFsRules.push(col);
      report.recommendations.push({
        severity: "LOW",
        area:     "Firestore Rules",
        issue:    `Collection "${col}" has no explicit Firestore rule (covered by fallback admin-only rule).`,
        fix:      `Add an explicit match /${col}/{docId} rule if non-admin users need access.`
      });
    }
  });

  // 5. ── Permission-denied events from live sync log ─────────────────────────
  const log = getSyncLog();
  log.forEach((entry) => {
    if (entry.status === "denied") {
      report.permissionDenied.push({
        ts:        new Date(entry.ts).toISOString(),
        db:        entry.db,
        path:      entry.path,
        op:        entry.op,
        errorCode: entry.errorCode,
        errorMsg:  entry.errorMsg
      });
    }
  });

  if (report.permissionDenied.length > 0) {
    const paths = [...new Set(report.permissionDenied.map((e) => e.path))];
    report.recommendations.push({
      severity: "CRITICAL",
      area:     "Permission Denied",
      issue:    `${report.permissionDenied.length} permission_denied event(s) detected on paths: ${paths.join(", ")}`,
      fix:      "Verify the user's role document exists in userRoles/{uid} before any sync attempt. The authReady gate in firebase.js prevents premature writes — ensure onAuthStateChanged fires before flushQueue."
    });
  }

  // 6. ── Sync failures ────────────────────────────────────────────────────────
  log.forEach((entry) => {
    if (entry.status === "failed") {
      report.syncFailures.push({
        ts:        new Date(entry.ts).toISOString(),
        db:        entry.db,
        path:      entry.path,
        op:        entry.op,
        errorCode: entry.errorCode,
        errorMsg:  entry.errorMsg
      });
    }
    if (entry.op === "conflict-skip-stale") {
      report.multiDeviceConflicts.push({
        ts:        new Date(entry.ts).toISOString(),
        path:      entry.path,
        op:        entry.op,
        resolution: "Cloud version kept (newer timestamp)"
      });
    }
    if (entry.status === "ok") report.syncSuccesses++;
  });

  if (report.multiDeviceConflicts.length > 0) {
    const paths = [...new Set(report.multiDeviceConflicts.map((e) => e.path))];
    report.recommendations.push({
      severity: "MEDIUM",
      area:     "Multi-Device Conflicts",
      issue:    `${report.multiDeviceConflicts.length} multi-device conflict(s) detected on paths: ${paths.join(", ")}. Cloud versions were kept.`,
      fix:      "Multi-device conflicts are resolved by timestamp. If a record is being modified on multiple devices simultaneously, the version with the latest updatedAt is kept. Ensure device clocks are synchronized."
    });
  }

  // 7. ── Queue health ─────────────────────────────────────────────────────────
  try {
    const q = JSON.parse(localStorage.getItem("CIC KANO:__syncqueue") || "[]");
    report.pendingQueueSize = q.length;
    if (q.length > 0) {
      const oldestTs = Math.min(...q.map((op) => op.ts || Date.now()));
      const ageMin   = Math.round((Date.now() - oldestTs) / 60000);
      report.recommendations.push({
        severity: ageMin > 5 ? "HIGH" : "LOW",
        area:     "Sync Queue",
        issue:    `${q.length} operation(s) are pending in the sync queue (oldest: ${ageMin} min ago).`,
        fix:      "Ops are retried automatically on reconnect and auth confirmation. If stuck, check the permission-denied log above."
      });
    }
  } catch {}

  return report;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _suggestRole(raw) {
  const s = String(raw).toLowerCase().replace(/[\s-]+/g, "_");
  const map = {
    super_admin: "Super Admin", superadmin: "Super Admin",
    admin: "Admin",
    principal: "Principal",
    vice_principal: "Vice Principal",
    accountant: "Accountant",
    teacher: "Teacher",
    exam_officer: "Exam Officer",
    staff: "Staff"
  };
  return map[s] || "Staff";
}

// ─── Format report as readable text ───────────────────────────────────────────
export function formatAuditReport(report) {
  const lines = [];
  const h = (t) => { lines.push(""); lines.push("═".repeat(60)); lines.push("  " + t); lines.push("═".repeat(60)); };
  const s = (t) => { lines.push(""); lines.push("── " + t); };
  const ok  = (t) => lines.push("  ✓ " + t);
  const warn= (t) => lines.push("  ⚠ " + t);
  const err = (t) => lines.push("  ✗ " + t);
  const inf = (t) => lines.push("  · " + t);

  lines.push("CIC KANO — Firebase Security & Sync Audit Report");
  lines.push("Generated: " + report.generatedAt);
  lines.push("Mode: " + report.mode + " | Cloud Ready: " + report.cloudReady + " | Auth Ready: " + report.authReady);

  h("1. USER DOCUMENT INTEGRITY");
  report.userIntegrity.forEach((u) => {
    const fn = u.status === "ok" ? ok : err;
    fn(`${u.label || u.email || u.uid} — role: ${u.role} | users: ${u.hasUserDoc ? "✓" : "✗"} | userRoles: ${u.hasRoleDoc ? "✓" : "✗"}`);
  });

  h("2. ROLE NAMING ISSUES");
  if (!report.roleIssues.length) { ok("All role values are valid."); }
  else report.roleIssues.forEach((r) => err(`${r.email || r.uid}: "${r.invalidRole}" → suggest "${r.suggestion}"`));

  h("3. MISSING RTDB RULES");
  if (!report.missingRtdbRules.length) { ok("All written collections have RTDB rules."); }
  else report.missingRtdbRules.forEach((c) => warn(c));

  
  if (!report.missingFsRules.length) { ok("All collections have explicit Firestore rules."); }
  else report.missingFsRules.forEach((c) => inf(c + " (covered by fallback)"));
 
  h("4. MULTI-DEVICE CONFLICTS");
  if (!report.multiDeviceConflicts.length) { ok("No multi-device conflicts detected."); }
  else report.multiDeviceConflicts.forEach((c) => warn(`[${c.ts}] ${c.path}: ${c.resolution}`));
 
  s(`Current Device ID: ${report.deviceId}`);

  h("5. PERMISSION DENIED EVENTS");
  if (!report.permissionDenied.length) { ok("No permission_denied errors detected."); }
  else report.permissionDenied.forEach((e) => err(`[${e.ts}] ${e.db} ${e.path} (${e.op}): ${e.errorCode} — ${e.errorMsg}`));

  h("6. SYNC FAILURES");
  if (!report.syncFailures.length) { ok("No sync failures in current session."); }
  else report.syncFailures.forEach((e) => warn(`[${e.ts}] ${e.db} ${e.path} (${e.op}): ${e.errorCode}`));

  s(`Sync successes this session: ${report.syncSuccesses}`);
  s(`Pending queue size: ${report.pendingQueueSize}`);

  h("7. RECOMMENDATIONS");
  if (!report.recommendations.length) { ok("No issues found."); }
  else {
    const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    [...report.recommendations].sort((a, b) => (order[a.severity] || 9) - (order[b.severity] || 9))
      .forEach((r) => {
        const fn = r.severity === "CRITICAL" ? err : r.severity === "HIGH" ? warn : inf;
        fn(`[${r.severity}] ${r.area}: ${r.issue}`);
        lines.push(`       FIX: ${r.fix}`);
      });
  }

  lines.push("");
  lines.push("═".repeat(60));
  lines.push("  END OF REPORT");
  lines.push("═".repeat(60));
  return lines.join("\n");
}


