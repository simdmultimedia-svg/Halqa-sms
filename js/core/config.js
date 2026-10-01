// Convenience accessors over the editable settings. All school structure comes
// from here so no section/class/service/fee is hardcoded in feature modules.
import { db } from "./db.js";
import { num } from "./utils.js";

export function sections() {
  return db.list("sections").slice().sort((a, b) => (a.order || 0) - (b.order || 0));
}
export function section(id) { return db.list("sections").find((s) => s.id === id) || null; }
export function sectionName(id) {
  if (id === "pending-section") return "Pending Assignment";
  const s = section(id); return s ? s.name : id;
}
export function sectionType(id) { const s = section(id); return s ? s.type || "western" : "western"; }

export function classes(sectionId) {
  let list = db.list("classes");
  if (sectionId) list = list.filter((c) => c.section_id === sectionId || c.sectionId === sectionId);
  return list.filter((c) => c.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
}
export function klass(id) { return db.list("classes").find((c) => c.id === id) || null; }
export function className(id) {
  if (id === "pending-class") return "Pending Assignment";
  const c = klass(id); return c ? c.name : id;
}

export function services() {
  return ((db.setting("services") || {}).list || []).filter((s) => s.active !== false);
}

export function programs({ activeOnly = true, session = currentSession(), term = currentTerm() } = {}) {
  let list = ((db.setting("programs") || {}).list || []).slice();
  if (activeOnly) list = list.filter((p) => (p.status || "Active") === "Active");
  if (session) list = list.filter((p) => !p.session || p.session === session || p.session === "All Sessions");
  if (term) list = list.filter((p) => !p.term || p.term === term || p.term === "All Terms");
  return list.sort((a, b) => (a.order || 0) - (b.order || 0) || (a.name || "").localeCompare(b.name || ""));
}
export function program(id) { return ((db.setting("programs") || {}).list || []).find((p) => p.id === id) || null; }
export function programName(id) { const p = program(id); return p ? p.name : sectionName(id); }
export function programForSection(sectionId, opts = {}) {
  return programs(opts).find((p) => p.sectionId === sectionId || p.id === sectionId) || null;
}
export function studentProgramIds(student, opts = {}) {
  const ids = new Set();
  const primary = programForSection(student?.sectionId, opts);
  if (primary) ids.add(primary.id);
  else if (student?.sectionId) ids.add(student.sectionId);
  (student?.programIds || student?.programs || []).forEach((id) => {
    const p = program(id);
    ids.add(p ? p.id : id);
  });
  return [...ids].filter(Boolean);
}

export function studentInSection(student, sectionId) {
  if (!student || !sectionId) return false;
  if (student.sectionId === sectionId) return true;

  if (student.islamiyyaClassId) {
    const cls = klass(student.islamiyyaClassId);
    if (cls && cls.sectionId === sectionId) return true;
  }

  if (student.tahfizClassId) {
    const cls = klass(student.tahfizClassId);
    if (cls && cls.sectionId === sectionId) return true;
  }

  const pIds = studentProgramIds(student);
  if (pIds.includes(sectionId)) return true;

  for (const pid of pIds) {
    const p = program(pid);
    if (p && (p.sectionId === sectionId || p.id === sectionId)) return true;
  }

  const p = program(sectionId);
  if (p && p.sectionId && (student.sectionId === p.sectionId || pIds.includes(p.id))) return true;

  // also check invoices to be fully robust as requested
  if (student.id) {
    const invoices = db.query("invoices", i => i.studentId === student.id && i.session === currentSession() && i.term === currentTerm());
    for (const inv of invoices) {
      for (const svc of (inv.services || [])) {
        if (svc.type === "program" && (svc.sectionId === sectionId || svc.programId === sectionId)) {
          return true;
        }
      }
    }
  }
  return false;
}

export function studentInClass(student, classId) {
  if (!student || !classId) return false;
  if (student.classId === classId) return true;
  if (student.islamiyyaClassId === classId) return true;
  if (student.tahfizClassId === classId) return true;

  const targetClass = klass(classId);
  if (!targetClass) return false;
  if (studentInSection(student, targetClass.sectionId)) {
    if (student.secondaryClasses && student.secondaryClasses[targetClass.sectionId] === classId) return true;
    if (student.secondaryClasses && student.secondaryClasses[targetClass.sectionId]) return false;

    const studentClass = klass(student.classId);
    if (studentClass && studentClass.name === targetClass.name) return true;
  }
  return false;
}

export function schoolAccount() {
  const acct = { ...(db.setting("schoolAccount") || {}) };
  const legacyName = ["com", "panions"].join("");
  if (String(acct.accountName || "").toLowerCase().includes(legacyName)) {
    acct.accountName = "Halqatu Zaid bin Sabit Kano";
  }
  return acct;
}

export function schoolSignatures() {
  return db.setting("schoolSignatures") || {};
}
// Services applicable to a section (those with a configured price, plus uniform/books).
export function servicesForSection(sectionId) {
  return services().filter((s) => {
    if (s.type === "uniform") return true;
    if (s.type === "books") return num((db.setting("books") || {}).bySection?.[sectionId]) > 0;
    return num(s.prices?.[sectionId]) > 0;
  });
}
export function servicePrice(serviceId, sectionId) {
  const s = services().find((x) => x.id === serviceId);
  if (!s) return 0;
  if (s.type === "books") return num((db.setting("books") || {}).bySection?.[sectionId]);
  return num(s.prices?.[sectionId]);
}

export function uniformPrices(sectionId) {
  return (db.setting("uniforms") || {}).bySection?.[sectionId] || {};
}
export function uniformPrice(sectionId, type) {
  return num(uniformPrices(sectionId)[type]);
}
export function booksPrice(sectionId) {
  return num((db.setting("books") || {}).bySection?.[sectionId]);
}

export function subjects(sectionId) {
  let list = (db.setting("subjects") || {}).list || [];
  if (sectionId) list = list.filter((s) => s.sectionId === sectionId);
  return list.filter((s) => s.active !== false);
}

export function mathSettings() {
  return db.setting("mathSettings") || {};
}

export function grading() {
  return [
    { min: 70, max: 100, grade: "A", remark: "Excellent" },
    { min: 60, max: 69.99, grade: "B", remark: "Very Good" },
    { min: 50, max: 59.99, grade: "C", remark: "Good" },
    { min: 45, max: 49.99, grade: "D", remark: "Pass" },
    { min: 40, max: 44.99, grade: "E", remark: "Fair" },
    { min: 0, max: 39.99, grade: "F", remark: "Fail" }
  ];
}
export function gradeFor(total) {
  const t = num(total);
  const g = grading().find((x) => t >= num(x.min) && t <= num(x.max));
  return g || { grade: "F", remark: "Fail" };
}

export function sessions() {
  return db.setting("sessions") || {};
}
export function currentSession() { return sessions().current || ""; }
export function currentTerm() { return sessions().currentTerm || "First Term"; }

export function promotionPaths() { return (db.setting("promotionPaths") || {}).map || {}; }
