// Record-level activity logging used by Staff Activities and Student Activities.
// Each entry is an atomic record in the "activities" collection (Firebase-sync-safe).
// SECURITY: Activities are role-filtered — users only see entries relevant to them.
import { db } from "./db.js";
import { uuid } from "./utils.js";
import { getCurrentUser } from "./auth.js";

export function logActivity({ module = "", action = "", description = "", studentId = "", staffId = "",
  user = "", refId = "", targetRole = "", targetUserId = "", classId = "", sectionId = "", title = "" } = {}) {
  const cu = getCurrentUser();
  return db.save("activities", {
    id: uuid(), at: Date.now(),
    module, action, description,
    title: title || action,
    studentId: studentId || "",
    staffId: staffId || "",
    userId: cu?.uid || "",
    user: user || cu?.email || "", refId: refId || "",
    targetRole: targetRole || "",
    targetUserId: targetUserId || "",
    classId: classId || "",
    sectionId: sectionId || "",
    read: false
  });
}

// Resolve the staff record for the acting user (matched by email).
export function staffForUser(user) {
  if (!user) return null;
  return db.find("staff", (s) => s.email && user.email && s.email.toLowerCase() === user.email.toLowerCase());
}

export function studentActivities(studentId) {
  return db.query("activities", (a) => a.studentId === studentId).sort((a, b) => b.at - a.at);
}

export function staffActivities(staffId) {
  return db.query("activities", (a) => a.staffId === staffId).sort((a, b) => b.at - a.at);
}

// Role-filtered activities for the current logged-in user.
// Each role only sees what's relevant to them.
export function activitiesForUser(currentUser) {
  if (!currentUser) return [];
  const role = (currentUser.role || "").toLowerCase().replace(/\s+/g, "_");
  const uid = currentUser.uid || "";

  return db.query("activities", (a) => {
    // Super Admin and Admin see everything
    if (["super_admin", "admin"].includes(role) ||
        ["Super Admin", "Admin"].includes(currentUser.role)) return true;

    // Principal sees all academic + teacher activities
    if (["principal", "vice_principal"].includes(role) ||
        ["Principal", "Vice Principal"].includes(currentUser.role)) {
      return !["payroll", "salary", "payslip"].includes(a.module?.toLowerCase());
    }

    // Accountant sees finance activities only
    if (role === "accountant" || currentUser.role === "Accountant") {
      const fin = ["fees", "invoice", "receipt", "payment", "salary", "scholarship", "discount", "expense"];
      return fin.some(f => (a.module || "").toLowerCase().includes(f)) ||
             a.targetRole === "Accountant";
    }

    // Teacher sees own activities + class activities
    if (role === "teacher" || currentUser.role === "Teacher") {
      return a.staffId === (currentUser.staffId || "") ||
             a.targetRole === "Teacher" ||
             a.targetRole === "Staff" ||
             ["attendance", "exams", "results", "assignment", "lesson"].some(m =>
               (a.module || "").toLowerCase().includes(m));
    }

    // Staff sees own activities
    if (role === "staff" || currentUser.role === "Staff") {
      return a.staffId === (currentUser.staffId || "") ||
             a.targetRole === "Staff" ||
             a.targetUserId === uid;
    }

    // Student / Parent sees only own student activities
    if (["student", "parent"].includes(role) ||
        ["Student", "Parent"].includes(currentUser.role)) {
      // For student logins, match via studentId stored in the user session
      const studentId = currentUser.studentId || "";
      return (studentId && a.studentId === studentId) ||
             a.targetUserId === uid ||
             (a.targetRole === "Student" && (!a.targetUserId || a.targetUserId === uid));
    }

    // Default: only show explicitly targeted activities
    return a.targetUserId === uid;
  }).sort((a, b) => b.at - a.at);
}
