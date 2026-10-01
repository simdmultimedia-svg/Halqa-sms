// Family Ledger core logic. The Family Ledger is the master financial account:
// it consolidates every child's invoices (charges) and receipts (payments) into one
// running account per parent/guardian. The ledger is DERIVED from the existing
// invoices/receipts so every charge and payment automatically flows into it.
import { db } from "./db.js";
import { num, uuid } from "./utils.js";
import { nextFamilyId } from "./idgen.js";
import { applyPayment, invoiceForStudent } from "./billing.js";

// Default multi-child discount tiers (editable from Settings -> familyDiscount).
const DEFAULT_TIERS = [
  { minChildren: 5, percent: 15 },
  { minChildren: 4, percent: 10 },
  { minChildren: 3, percent: 5 }
];

function familyDiscountPolicy() {
  const s = db.setting("familyDiscount") || {};
  return {
    tiers: Array.isArray(s.tiers) ? s.tiers : DEFAULT_TIERS,
    freeTuitionEnabled: s.freeTuitionEnabled !== false,
    freeTuitionMinChildren: num(s.freeTuitionMinChildren) || 5,
    freeTuitionBeneficiaryMode: s.freeTuitionBeneficiaryMode || "lowest"
  };
}

export function discountTiers() {
  const list = familyDiscountPolicy().tiers;
  return list.slice().sort((a, b) => num(b.minChildren) - num(a.minChildren));
}

export function freeTuitionPolicy() {
  return familyDiscountPolicy();
}

export function discountPercentFor(childCount) {
  const tier = discountTiers().find((t) => childCount >= num(t.minChildren));
  return tier ? num(tier.percent) : 0;
}

export function families() {
  return db.list("families").sort((a, b) => (a.familyId < b.familyId ? -1 : 1));
}

export function getFamily(id) { return db.get("families", id); }

const norm = (p) => String(p || "").replace(/[^0-9]/g, "");

export function familyByPhone(phone) {
  const n = norm(phone);
  if (!n) return null;
  return db.find("families", (f) => norm(f.phone) === n || norm(f.altPhone) === n);
}

// Students belonging to a family: by explicit familyId link, with a phone fallback
// so already-admitted students reconcile without a migration step.
export function familyStudents(family) {
  if (!family) return [];
  const byId = db.query("students", (s) => s.familyId === family.id);
  if (byId.length) return byId;
  const n = norm(family.phone);
  return n ? db.query("students", (s) => !s.familyId && norm(s.parentPhone) === n) : [];
}

// Create or fetch the family for a freshly-admitted student and link them.
export async function ensureFamilyForStudent(student) {
  let fam = familyByPhone(student.parentPhone);
  if (!fam) {
    const familyId = await nextFamilyId(new Date().getFullYear());
    fam = db.save("families", {
      id: uuid(), familyId, parentName: student.parentName || "",
      phone: student.parentPhone || "", altPhone: "", email: "", address: student.address || "",
      occupation: "", nationality: "", status: "Active", studentIds: [], createdAt: Date.now()
    });
  }
  linkStudent(fam, student);
  return fam;
}

export function linkStudent(family, student) {
  if (!family || !student) return;
  const ids = new Set(family.studentIds || []);
  ids.add(student.id);
  family.studentIds = [...ids];
  db.save("families", family);
  if (student.familyId !== family.id) {
    student.familyId = family.id;
    db.save("students", student);
  }
}

export function unlinkStudent(family, studentId) {
  family.studentIds = (family.studentIds || []).filter((x) => x !== studentId);
  db.save("families", family);
  const s = db.get("students", studentId);
  if (s && s.familyId === family.id) { delete s.familyId; s.familyId = ""; db.save("students", s); }
}

// Group all unlinked students that share a parent phone into families. Returns
// a summary { created, linked } so the UI can report what happened.
export async function autoGroupExistingStudents() {
  let created = 0, linked = 0;
  const students = db.list("students");
  for (const s of students) {
    if (s.familyId) continue;
    let fam = familyByPhone(s.parentPhone);
    if (!fam && norm(s.parentPhone)) {
      const familyId = await nextFamilyId(new Date().getFullYear());
      fam = db.save("families", {
        id: uuid(), familyId, parentName: s.parentName || "", phone: s.parentPhone || "",
        altPhone: "", email: "", address: s.address || "", occupation: "", nationality: "",
        status: "Active", studentIds: [], createdAt: Date.now()
      });
      created++;
    }
    if (fam) { linkStudent(fam, s); linked++; }
  }
  return { created, linked };
}

// Build the consolidated, chronological ledger for a family.
export function buildLedger(family) {
  const students = familyStudents(family);
  const txns = [];
  students.forEach((stu) => {
    invoiceForStudent(stu.id).forEach((inv) => {
      (inv.services || []).forEach((line) => {
        txns.push({ id: inv.id + ":" + line.id, date: inv.createdAt, student: stu.fullName,
          studentId: stu.id, description: line.name, type: "charge", debit: num(line.amount), credit: 0, ref: inv.invoiceNo });
      });
      // Show detailed scholarship breakdown rows if available, else aggregate
      if (inv.scholarshipBreakdown && inv.scholarshipBreakdown.length) {
        inv.scholarshipBreakdown.forEach((s, idx) => {
          if (num(s.amount) > 0) txns.push({ id: inv.id + ":sch" + idx, date: inv.createdAt, student: stu.fullName, studentId: stu.id, description: `🎓 ${s.name}`, type: "scholarship", debit: 0, credit: num(s.amount), ref: inv.invoiceNo });
        });
      } else if (num(inv.scholarship) > 0) {
        txns.push({ id: inv.id + ":sch", date: inv.createdAt, student: stu.fullName, studentId: stu.id, description: "Scholarship Adjustment", type: "scholarship", debit: 0, credit: num(inv.scholarship), ref: inv.invoiceNo });
      }
      // Show detailed discount breakdown rows if available, else aggregate
      if (inv.discountBreakdown && inv.discountBreakdown.length) {
        inv.discountBreakdown.forEach((d, idx) => {
          if (num(d.amount) > 0) txns.push({ id: inv.id + ":disc" + idx, date: inv.createdAt, student: stu.fullName, studentId: stu.id, description: `🏷️ ${d.name}`, type: "discount", debit: 0, credit: num(d.amount), ref: inv.invoiceNo });
        });
      } else if (num(inv.discount) > 0) {
        txns.push({ id: inv.id + ":disc", date: inv.createdAt, student: stu.fullName, studentId: stu.id, description: "Discount", type: "discount", debit: 0, credit: num(inv.discount), ref: inv.invoiceNo });
      }
      (inv.payments || []).forEach((p, i) => {
        txns.push({ id: inv.id + ":pay" + i, date: p.date, student: stu.fullName, studentId: stu.id,
          description: "Payment Receipt", type: "payment", debit: 0, credit: num(p.amount), ref: p.receiptNo });
      });
    });
  });
  txns.sort((a, b) => (a.date || 0) - (b.date || 0));
  let bal = 0;
  txns.forEach((t) => { bal += t.debit - t.credit; t.balance = bal; });
  return txns;
}

export function familyTotals(family) {
  const students = familyStudents(family);
  let gross = 0, discount = 0, scholarship = 0, payments = 0, outstanding = 0, lastPayment = 0;
  students.forEach((stu) => {
    invoiceForStudent(stu.id).forEach((inv) => {
      gross += (inv.services || []).reduce((a, s) => a + num(s.amount), 0);
      discount += num(inv.discount);
      scholarship += num(inv.scholarship);
      payments += num(inv.amountPaid);
      outstanding += num(inv.balance);
      (inv.payments || []).forEach((p) => { if (p.date > lastPayment) lastPayment = p.date; });
    });
  });
  return { children: students.length, gross, discount, scholarship, totalCharges: gross - discount - scholarship, payments, outstanding, lastPayment };
}

export function nextFamilyInvoiceNo(family) {
  const y = new Date().getFullYear();
  const seq = db.list("familyInvoices").filter((i) => String(i.invoiceNo || "").includes(`FINV-${y}-`)).length + 1;
  const stamp = Date.now().toString(36).toUpperCase();
  return `FINV-${y}-${String(seq).padStart(4, "0")}-${String(family.familyId || "FAM").replace(/[^A-Z0-9]/gi, "").toUpperCase()}-${stamp}`;
}

export function familyInvoiceSnapshot(family) {
  const totals = familyTotals(family);
  const children = outstandingInvoices(family).map(({ inv, student }) => ({
    studentId: student.id,
    studentName: student.fullName,
    admissionNo: student.admissionNo || "",
    classId: student.classId,
    invoiceId: inv.id,
    invoiceNo: inv.invoiceNo,
    term: inv.term,
    session: inv.session,
    grossAmount: num(inv.grossAmount) || (inv.services || []).reduce((a, s) => a + num(s.amount), 0),
    scholarship: num(inv.scholarship),
    discount: num(inv.discount),
    totalAmount: num(inv.totalAmount),
    amountPaid: num(inv.amountPaid),
    balance: num(inv.balance),
    services: inv.services || []
  }));
  const gross = children.reduce((a, c) => a + c.grossAmount, 0);
  const scholarship = children.reduce((a, c) => a + c.scholarship, 0);
  const discount = children.reduce((a, c) => a + c.discount, 0);
  const amountPaid = children.reduce((a, c) => a + c.amountPaid, 0);
  const outstanding = children.reduce((a, c) => a + c.balance, 0);
  return {
    familyId: family.id,
    familyCode: family.familyId,
    parentName: family.parentName || "",
    phone: family.phone || "",
    address: family.address || "",
    children,
    totals: {
      ...totals,
      gross,
      scholarship,
      discount,
      totalCharges: Math.max(0, gross - scholarship - discount),
      payments: amountPaid,
      outstanding
    }
  };
}

export function createFamilyInvoice(family, createdBy = "") {
  const snapshot = familyInvoiceSnapshot(family);
  if (!snapshot.children.length) throw new Error("No unpaid child invoices found for this family.");
  const invoice = db.save("familyInvoices", {
    id: uuid(),
    invoiceNo: nextFamilyInvoiceNo(family),
    familyId: family.id,
    familyCode: family.familyId,
    parentName: family.parentName || "",
    phone: family.phone || "",
    address: family.address || "",
    children: snapshot.children,
    grossAmount: snapshot.totals.gross,
    scholarship: snapshot.totals.scholarship,
    discount: snapshot.totals.discount,
    totalAmount: snapshot.totals.totalCharges,
    amountPaid: snapshot.totals.payments,
    balance: snapshot.totals.outstanding,
    status: snapshot.totals.outstanding <= 0 ? "PAID" : "UNPAID",
    createdBy,
    createdAt: Date.now()
  });
  return { invoice, snapshot };
}

// Outstanding invoices for a family, oldest first.
export function outstandingInvoices(family) {
  const out = [];
  familyStudents(family).forEach((stu) => {
    invoiceForStudent(stu.id).forEach((inv) => { if (num(inv.balance) > 0) out.push({ inv, student: stu }); });
  });
  return out.sort((a, b) => (a.inv.createdAt || 0) - (b.inv.createdAt || 0));
}

// Allocate a family payment across children.
// mode "auto": oldest debt first. mode "manual": amounts keyed by invoiceId.
export async function allocateFamilyPayment(family, { amount = 0, mode = "auto", manual = {}, cashier = "" }) {
  const receipts = [];
  if (mode === "manual") {
    for (const { inv } of outstandingInvoices(family)) {
      const pay = num(manual[inv.id]);
      if (pay > 0) { const r = await applyPayment(inv, { amount: Math.min(pay, inv.balance), cashier }); receipts.push(r.receipt); }
    }
    return receipts;
  }
  let remaining = num(amount);
  for (const { inv } of outstandingInvoices(family)) {
    if (remaining <= 0) break;
    if ((inv.payments || []).length >= 2) continue; // billing caps installments
    const pay = Math.min(remaining, num(inv.balance));
    if (pay <= 0) continue;
    const r = await applyPayment(inv, { amount: pay, cashier });
    receipts.push(r.receipt);
    remaining -= pay;
  }
  return receipts;
}
