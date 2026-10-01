// Scholarship & Discount Core Engine
// -  Scholarship deductions apply ONLY to Tuition Fee service lines.
// -  Discount deductions apply to the remaining net amount after scholarship.
// -  All assignments are kept in separate collections; never merged into student records.
import { db } from "./db.js";
import { num, uuid } from "./utils.js";
import * as cfg from "./config.js";

// ─── Constants ────────────────────────────────────────────────────────────────

export const SCHOLARSHIP_TYPES = [
  "Full Scholarship",
  "Partial Scholarship",
  "Percentage Scholarship",
  "Fixed Amount Scholarship",
  "Academic Scholarship",
  "Merit Scholarship",
  "Sports Scholarship",
  "Qur'anic Scholarship",
  "Staff Child Scholarship",
  "Orphan Scholarship",
  "Special Scholarship",
  "Custom Scholarship"
];

export const DISCOUNT_TYPES = [
  "Early Payment Discount",
  "Staff Child Discount",
  "Sibling Discount",
  "Special Approval Discount",
  "Promotional Discount",
  "Family Discount",
  "Staff Discount",
  "Management Discount",
  "Custom Discount"
];

export const SCHOLARSHIP_ROLES = ["Super Admin", "Admin", "Principal", "Proprietor", "Finance Manager", "Accountant"];

// The service name that scholarships target. Case-insensitive match.
const TUITION_SERVICE_NAME = "tuition fee";

function freeTuitionPolicy() {
  const s = db.setting("familyDiscount") || {};
  return {
    freeTuitionEnabled: s.freeTuitionEnabled !== false,
    freeTuitionMinChildren: num(s.freeTuitionMinChildren) || 0,
    freeTuitionBeneficiaryMode: s.freeTuitionBeneficiaryMode || "lowest"
  };
}

// ─── Scholarship Plans ────────────────────────────────────────────────────────

export function listScholarships() {
  return db.list("scholarships").sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}
export function getScholarship(id) { return db.get("scholarships", id); }
export function saveScholarship(data) {
  return db.save("scholarships", { ...data, updatedAt: Date.now() });
}
export function deleteScholarship(id) { db.delete("scholarships", id); }

// ─── Discount Plans ───────────────────────────────────────────────────────────

export function listDiscounts() {
  return db.list("discounts").sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}
export function getDiscount(id) { return db.get("discounts", id); }
export function saveDiscount(data) {
  return db.save("discounts", { ...data, updatedAt: Date.now() });
}
export function deleteDiscount(id) { db.delete("discounts", id); }

// ─── Student Scholarship Assignments ─────────────────────────────────────────

export function listStudentScholarships(studentId) {
  return db.query("studentScholarships", (r) =>
    r.studentId === studentId && r.status === "Active"
  );
}
export function allStudentScholarships() { return db.list("studentScholarships"); }

export function assignScholarship({ studentId, scholarshipId, approvedBy, effectiveSession, effectiveTerm, expirySession, expiryTerm }) {
  const existing = db.query("studentScholarships", (r) =>
    r.studentId === studentId &&
    r.scholarshipId === scholarshipId &&
    r.effectiveSession === effectiveSession &&
    r.effectiveTerm === effectiveTerm &&
    r.status === "Active"
  );
  if (existing.length) return existing[0];

  const plan = getScholarship(scholarshipId);
  if (!plan) throw new Error("Scholarship plan not found");
  if (plan.status && plan.status !== "Active") throw new Error("Scholarship plan is not active.");
  const existingFull = db.query("studentScholarships", (r) =>
    r.studentId === studentId &&
    r.status === "Active" &&
    r.effectiveSession === effectiveSession &&
    (r.effectiveTerm === effectiveTerm || r.effectiveTerm === "All Terms" || effectiveTerm === "All Terms") &&
    r.valueType === "percent" &&
    num(r.value) >= 100
  );
  if (existingFull.length && plan.valueType === "percent" && num(plan.value) >= 100) {
    throw new Error("A full scholarship already exists for this student and period.");
  }

  return db.save("studentScholarships", {
    id: uuid(),
    studentId,
    scholarshipId,
    scholarshipName: plan.name,
    scholarshipType: plan.type,
    valueType: plan.valueType,   // "percent" | "fixed"
    value:     plan.value,
    description: plan.description || plan.notes || "",
    approvedBy,
    approvalDate:    Date.now(),
    effectiveSession,
    effectiveTerm,
    expirySession:   expirySession || "",
    expiryTerm:      expiryTerm   || "",
    status:    "Active",
    createdAt: Date.now()
  });
}

export function revokeStudentScholarship(assignmentId, revokedBy) {
  const rec = db.get("studentScholarships", assignmentId);
  if (!rec) return;
  rec.status    = "Revoked";
  rec.revokedBy = revokedBy;
  rec.revokedAt = Date.now();
  db.save("studentScholarships", rec);
}

// ─── Student Discount Assignments ────────────────────────────────────────────

export function listStudentDiscounts(studentId) {
  return db.query("studentDiscounts", (r) =>
    r.studentId === studentId && r.status === "Active"
  );
}
export function allStudentDiscounts() { return db.list("studentDiscounts"); }

export function assignDiscount({ studentId, discountId, approvedBy, effectiveSession, effectiveTerm, expirySession, expiryTerm }) {
  const existing = db.query("studentDiscounts", (r) =>
    r.studentId === studentId &&
    r.discountId === discountId &&
    r.effectiveSession === effectiveSession &&
    r.effectiveTerm === effectiveTerm &&
    r.status === "Active"
  );
  if (existing.length) return existing[0];

  const plan = getDiscount(discountId);
  if (!plan) throw new Error("Discount plan not found");
  if (plan.status && plan.status !== "Active") throw new Error("Discount plan is not active.");
  const fullScholarship = db.query("studentScholarships", (r) =>
    r.studentId === studentId &&
    r.status === "Active" &&
    r.effectiveSession === effectiveSession &&
    (r.effectiveTerm === effectiveTerm || r.effectiveTerm === "All Terms" || effectiveTerm === "All Terms") &&
    r.valueType === "percent" &&
    num(r.value) >= 100
  );
  if (fullScholarship.length && /(tuition|sibling|family|staff child)/i.test(`${plan.name} ${plan.type}`)) {
    throw new Error("A full tuition scholarship already exists for this student and period. Another tuition discount cannot be applied.");
  }

  return db.save("studentDiscounts", {
    id: uuid(),
    studentId,
    discountId,
    discountName: plan.name,
    discountType: plan.type,
    valueType:    plan.valueType,
    value:        plan.value,
    description: plan.description || plan.notes || "",
    approvedBy,
    approvalDate:    Date.now(),
    effectiveSession,
    effectiveTerm,
    expirySession:   expirySession || "",
    expiryTerm:      expiryTerm   || "",
    status:    "Active",
    createdAt: Date.now()
  });
}

export function revokeStudentDiscount(assignmentId, revokedBy) {
  const rec = db.get("studentDiscounts", assignmentId);
  if (!rec) return;
  rec.status    = "Revoked";
  rec.revokedBy = revokedBy;
  rec.revokedAt = Date.now();
  db.save("studentDiscounts", rec);
}

// ─── Calculation Helpers ──────────────────────────────────────────────────────

// Compute deduction amount given a plan and a base amount.
function calcDeduction(plan, baseAmount) {
  if (!plan || baseAmount <= 0) return 0;
  if (plan.valueType === "percent")
    return Math.min(Math.round((num(plan.value) / 100) * baseAmount), baseAmount);
  return Math.min(num(plan.value), baseAmount);
}

// Extract the tuition fee amount from a services array.
// Scholarships apply ONLY to the Tuition Fee line. All other services are unaffected.
function tuitionAmount(services) {
  if (!Array.isArray(services)) return 0;
  return services
    .filter((s) => (s.name || "").toLowerCase().includes(TUITION_SERVICE_NAME))
    .reduce((a, s) => a + num(s.amount), 0);
}

// Compute scholarship deduction for a student.
// Base = tuition fee amount only (not gross total).
export function computeScholarshipDeduction(studentId, services, session, term) {
  return { totalScholarship: 0, breakdown: [] };

  const assignments = db.query("studentScholarships", (r) =>
    r.studentId === studentId &&
    r.status === "Active" &&
    r.effectiveSession === session &&
    (r.effectiveTerm === term || r.effectiveTerm === "" || r.effectiveTerm === "All Terms")
  );

  const breakdown = [];
  let total     = 0;
  let remaining = tuition;

  for (const a of assignments) {
    const amt = calcDeduction({ valueType: a.valueType, value: a.value }, remaining);
    if (amt > 0) {
      breakdown.push({ name: a.scholarshipName, amount: amt, assignmentId: a.id, scholarshipId: a.scholarshipId, appliedTo: "Tuition Fee" });
      total    += amt;
      remaining = Math.max(0, remaining - amt);
    }
  }

  // --- Automatic Family Tuition Scholarship (5+ Active Students) ---
  if (remaining > 0) {
    const student = db.get("students", studentId);
    if (student && student.familyId) {
      const family = db.get("families", student.familyId);
      if (family) {
        const famStudents = db.query("students", s => s.familyId === family.id && s.status === "active");
        const policy = freeTuitionPolicy();
        if (policy.freeTuitionEnabled && famStudents.length >= policy.freeTuitionMinChildren) {
          let beneficiaryId = family.freeTuitionBeneficiaryId;
          
          if (!beneficiaryId && policy.freeTuitionBeneficiaryMode !== "manual") {
            let lowestAmt = Infinity;
            let lowestId = null;
            const tService = cfg.services().find(sv => (sv.name || "").toLowerCase().includes("tuition fee"));
            if (tService) {
               famStudents.forEach(s => {
                  const amt = num(cfg.servicePrice(tService.id, s.sectionId));
                  if (amt < lowestAmt) { lowestAmt = amt; lowestId = s.id; }
               });
            }
            beneficiaryId = lowestId || famStudents[0].id;
          }

          if (beneficiaryId === studentId) {
             breakdown.push({ name: `Family Free Tuition (${policy.freeTuitionMinChildren}+ Students)`, amount: remaining, assignmentId: "auto-family", scholarshipId: "auto-family", appliedTo: "Tuition Fee" });
             total += remaining;
             remaining = 0;
          }
        }
      }
    }
  }

  return { totalScholarship: total, breakdown };
}

// Compute discount deduction for a student.
// Base = (grossAmount - scholarshipAmount), i.e. the net after scholarship.
export function computeDiscountDeduction(studentId, afterScholarshipAmount, session, term) {
  if (afterScholarshipAmount <= 0) return { totalDiscount: 0, breakdown: [] };

  const assignments = db.query("studentDiscounts", (r) =>
    r.studentId === studentId &&
    r.status === "Active" &&
    r.effectiveSession === session &&
    (r.effectiveTerm === term || r.effectiveTerm === "" || r.effectiveTerm === "All Terms")
  );

  const breakdown = [];
  let total     = 0;
  let remaining = afterScholarshipAmount;

  for (const a of assignments) {
    const amt = calcDeduction({ valueType: a.valueType, value: a.value }, remaining);
    if (amt > 0) {
      breakdown.push({ name: a.discountName, amount: amt, assignmentId: a.id, discountId: a.discountId });
      total    += amt;
      remaining = Math.max(0, remaining - amt);
    }
  }
  return { totalDiscount: total, breakdown };
}

// Master computation: returns all deduction details for use by billing.
// services[] is the invoice service lines array.
export function computeAllDeductions(studentId, services, grossAmount, session, term) {
  const { totalScholarship, breakdown: scholarshipBreakdown } =
    computeScholarshipDeduction(studentId, services, session, term);

  const afterScholarship = Math.max(0, grossAmount - totalScholarship);

  const { totalDiscount, breakdown: discountBreakdown } =
    computeDiscountDeduction(studentId, afterScholarship, session, term);

  const netAmount = Math.max(0, afterScholarship - totalDiscount);

  return {
    grossAmount,
    scholarshipAmount: totalScholarship,
    discountAmount:    totalDiscount,
    netAmount,
    scholarshipBreakdown,
    discountBreakdown
  };
}
