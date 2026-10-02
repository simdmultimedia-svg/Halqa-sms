// Role-Based Access Control definitions.
// Permissions are coarse module-level grants plus a few fine-grained action flags.
// Roles are also editable from Settings; this map is the built-in default.
//
// Dual-naming support: the system accepts both TitleCase ("Super Admin") and
// lowercase ("super_admin") role values for full Firebase rules compatibility.

export const ROLES = [
  "Super Admin", "Admin", "Principal", "Vice Principal",
  "Accountant", "Teacher", "Exam Officer", "Librarian", "Receptionist", "Staff", "Parent", "Student"
];

// Normalise any role string to its TitleCase canonical form.
// This ensures that lowercase roles from Firebase auth rules ("super_admin")
// are treated identically to their TitleCase counterparts in JS logic.
export function normaliseRole(role) {
  if (!role) return "";
  const map = {
    "super_admin": "Super Admin",
    "superadmin": "Super Admin",
    "admin": "Admin",
    "principal": "Principal",
    "vice_principal": "Vice Principal",
    "viceprincipal": "Vice Principal",
    "accountant": "Accountant",
    "teacher": "Teacher",
    "exam_officer": "Exam Officer",
    "examofficer": "Exam Officer",
    "librarian": "Librarian",
    "receptionist": "Receptionist",
    "staff": "Staff",
    "parent": "Parent",
    "student": "Student"
  };
  return map[role.toLowerCase().replace(/[\s-]+/g, "_")] || role;
}

// Module keys correspond to router views.
export const MODULES = [
  "dashboard", "revenue", "admission", "enquiries", "admissionproposals", "regterm2", "regterm3", "migration", "students", "studentactivity", "bookshop",
  "family", "fees", "invoices", "bulkinvoice", "receipts",
  "attendance", "exams", "results", "reportcards", "promotion", "staff", "staffactivity", "payslip",
  "salary", "voucher", "expense", "scholarships", "inventory", "reports", "audit", "backup", "settings",
  "appreset", "healthcheck", "syncreport", "usermanagement", "rolediagnostics", "landingeditor", "complaints", "activities", "myprofile", "myresults", "myattendance", "myassignments", "mycbt", "myinvoices", "myreceipts", "myactivities", "lessonplans", "assignments",
  "staffperformance", "staffperformanceroster", "staffroster", "testimonials", "schemeofwork", "examtimetable", "graduations", "recyclebin", "quranlink"
];

const ALL = MODULES.slice();

export const DEFAULT_ROLE_ACCESS = {
  "Super Admin": ALL,
  "Admin": ALL.filter(m => m !== "usermanagement" && m !== "rolediagnostics" && m !== "appreset"),
  "Principal": ["dashboard", "enquiries", "admissionproposals", "results", "reportcards", "staffactivity", "studentactivity", "scholarships", "lessonplans", "assignments", "exams", "staffperformance", "staffperformanceroster", "staffroster", "testimonials", "schemeofwork", "examtimetable", "graduations", "quranlink"],
  "Vice Principal": ["dashboard", "enquiries", "admissionproposals", "results", "reportcards", "staffactivity", "studentactivity", "scholarships", "lessonplans", "assignments", "exams", "staffperformance", "staffperformanceroster", "staffroster", "testimonials", "schemeofwork", "examtimetable", "graduations", "quranlink"],
  "Accountant": ["dashboard", "students", "revenue", "fees", "invoices", "receipts", "family", "scholarships", "reports", "expense", "inventory", "bookshop", "payslip", "voucher", "complaints"],
  "Teacher": ["dashboard", "myprofile", "myattendance", "results", "lessonplans", "assignments", "exams", "mycbt", "payslip", "complaints", "staffroster", "schemeofwork", "examtimetable", "quranlink"],
  "Exam Officer": ["dashboard", "exams", "results", "reportcards", "students", "reports", "examtimetable", "quranlink"],
  "Librarian": ["dashboard", "bookshop", "inventory"],
  "Receptionist": ["dashboard", "admission", "enquiries", "admissionproposals", "students"],
  "Staff": ["myprofile", "myattendance", "payslip", "complaints", "staffroster"],
  "Parent": ["dashboard", "family", "myprofile", "myresults", "myinvoices", "myreceipts", "myactivities", "examtimetable"],
  "Student": ["dashboard", "myprofile", "myresults", "mycbt", "myinvoices", "myreceipts", "myattendance", "myactivities", "myassignments", "complaints", "examtimetable"]
};

export function roleAccess(role) {
  const canonical = normaliseRole(role);
  const custom = (window.__CICKANORoleAccess || {})[canonical] || (window.__CICKANORoleAccess || {})[role];
  const maxAllowed = DEFAULT_ROLE_ACCESS[canonical] || DEFAULT_ROLE_ACCESS[role] || [];
  if (canonical === "Super Admin" || canonical === "Admin") return maxAllowed;
  if (!custom) return maxAllowed;
  return custom.filter((module) => maxAllowed.includes(module));
}

export function canAccess(role, module) {
  const canonical = normaliseRole(role);
  console.log("[DEBUG] canAccess - role:", role, "canonical:", canonical, "module:", module);
  if (canonical === "Super Admin" || canonical === "Admin") {
    console.log("[DEBUG] canAccess - Super Admin/Admin, returning true");
    return true;
  }
  if (!canonical || !DEFAULT_ROLE_ACCESS[canonical]) {
    console.log("[DEBUG] canAccess - no access defined, returning false");
    return false;
  }
  const hasAccess = roleAccess(canonical).includes(module);
  console.log("[DEBUG] canAccess - hasAccess:", hasAccess);
  return hasAccess;
}

export function allowedModules(role) { return roleAccess(role); }

export function firstAllowedModule(role) {
  const access = roleAccess(role);
  return access[0] || null;
}

// Fine-grained capabilities used to hide destructive actions.
export function can(role, capability) {
  const canonical = normaliseRole(role);
  const caps = {
    "factoryReset": ["Super Admin"],
    "manageStaff": ["Super Admin", "Admin"],
    "manageUsers": ["Super Admin", "Admin"],
    "manageRoles": ["Super Admin", "Admin"],
    "manageSettings": ["Super Admin", "Admin"],
    "collectPayment": ["Super Admin", "Admin", "Accountant"],
    "viewAllPayslips": ["Super Admin", "Admin", "Accountant"],
    "manageResults": ["Super Admin", "Admin", "Teacher", "Principal", "Exam Officer"],
    "manageSalary": ["Super Admin", "Admin", "Accountant"],
    "viewAudit": ["Super Admin", "Admin"],
    "promote": ["Super Admin", "Admin"],
    "deleteRecords": ["Super Admin", "Admin"],
    "manageScholarships": ["Super Admin", "Admin", "Principal", "Accountant"],
    "manageExams": ["Super Admin", "Admin", "Teacher", "Exam Officer"],
    "manageTestimonials": ["Super Admin", "Admin", "Principal", "Vice Principal"],
    "manageSchemeOfWork": ["Super Admin", "Admin", "Principal", "Vice Principal", "Teacher"],
    "approveSchemeOfWork": ["Super Admin", "Admin", "Principal", "Vice Principal"],
    "manageExamTimetable": ["Super Admin", "Admin", "Principal", "Vice Principal", "Exam Officer"]
  };
  return (caps[capability] || []).includes(canonical);
}



