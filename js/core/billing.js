// Shared billing logic for invoices, payments and receipts.
import { db } from "./db.js";
import { num, uuid, naira } from "./utils.js";
import { calculateInvoiceTotal, calculateTotalPaid, calculateOutstandingBalance, roundCurrency } from "./calculations.js";
import { nextInvoiceNo, nextReceiptNo } from "./idgen.js";
import * as cfg from "./config.js";
import { computeAllDeductions } from "./scholarships.js";
import { buildUniformLines } from "../modules/uniforms.js";

export function computeStatus(total, paid) {
  total = num(total); paid = num(paid);
  if (paid <= 0) return "UNPAID";
  if (paid >= total) return "PAID";
  return "PARTIALLY PAID";
}

function safeArray(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  if (value && typeof value === "object") return Object.values(value).filter((v) => typeof v === "string");
  return [];
}

// Build the list of service line items for an admission/registration selection.
function hasIndividualBooks(sectionId, classId) {
  if (!classId) return false;
  const session = cfg.currentSession();
  return db.query("books", b =>
    (b.status || "available") === "available" && num(b.stock) > 0 &&
    (!b.sectionId || b.sectionId === sectionId) &&
    (!b.classId || b.classId === classId) &&
    (!b.session || b.session === session)
  ).length > 0;
}

export function buildServiceLines(sectionId, opts = {}) {
  opts = opts && typeof opts === "object" ? opts : {};
  const { uniformType = "", uniformSelection = null, classId = "", includeBooks = false } = opts;
  const serviceIds = safeArray(opts.serviceIds);
  const lines = [];
  cfg.services().forEach((s) => {
    if (s.type === "uniform") {
      if (uniformSelection) lines.push(...buildUniformLines(sectionId, classId, uniformSelection));
      else if (uniformType) lines.push({ id: s.id, name: `Uniform (${uniformType})`, amount: cfg.uniformPrice(sectionId, uniformType), type: "uniform", optional: false, meta: { uniformType } });
    } else if (s.type === "books") {
      if (includeBooks && !hasIndividualBooks(sectionId, classId) && cfg.booksPrice(sectionId) > 0) lines.push({ id: s.id, name: "Books", amount: cfg.booksPrice(sectionId), type: "book", optional: true, legacyBookCharge: true });
    } else if (serviceIds.includes(s.id)) {
      const unitPrice = cfg.servicePrice(s.id, sectionId);
      if (unitPrice > 0) lines.push({ id: s.id, name: s.name, amount: unitPrice, unitPrice, quantity: 1, type: "fee", optional: !!s.optional });
    }
  });
  return lines;
}

export function buildProgramFeeLines(student, { session = cfg.currentSession(), term = cfg.currentTerm() } = {}) {
  if (!student) return [];
  const programIds = cfg.studentProgramIds(student, { activeOnly: true, session, term });
  return programIds.map((programId) => {
    const p = cfg.program(programId);
    if (!p || (p.status || "Active") !== "Active") return null;
    if (p.session && p.session !== "All Sessions" && p.session !== session) return null;
    if (p.term && p.term !== "All Terms" && p.term !== term) return null;
    const amount = num(p.fee);
    if (amount <= 0) return null;
    return {
      id: "program:" + p.id,
      name: `${p.name} Program Fee`,
      amount,
      type: "program",
      optional: false,
      programId: p.id,
      sectionId: p.sectionId || ""
    };
  }).filter(Boolean);
}

function mergeProgramLines(student, services, session, term) {
  const programLines = buildProgramFeeLines(student, { session, term });
  if (!programLines.length) return services || [];
  const programIds = new Set(programLines.map((l) => l.programId));
  const manual = (services || []).filter((s) => {
    if (s.type === "program" || String(s.id || "").startsWith("program:")) return false;
    if ((s.name || "").toLowerCase().includes("tuition fee")) return false;
    if (s.programId && programIds.has(s.programId)) return false;
    return true;
  });
  return [...programLines, ...manual];
}

export async function createInvoice({ student, services, type = "New Student", discount = 0, scholarship = 0, term = cfg.currentTerm(), session = cfg.currentSession(), replaceDuplicate = false } = {}) {
  const duplicate = db.list("invoices").find((inv) =>
    inv.studentId === student.id &&
    inv.session === session &&
    inv.term === term &&
    inv.type === type &&
    inv.status !== "VOID"
  );
  if (duplicate && !replaceDuplicate) {
    const err = new Error("Duplicate Invoice Detected");
    err.code = "duplicate-invoice";
    err.invoice = duplicate;
    throw err;
  }
  if (duplicate && replaceDuplicate) db.delete("invoices", duplicate.id);
  
  // Enforce zero-trust calculations: Use exactly what was passed. No hidden defaults.
  services = Array.isArray(services) ? services : [];
  
  // Debug logging for tracing financial logic
  console.log(`[BILLING] Generating invoice for ${student.fullName} (${type})`);
  console.log(`[BILLING] Services strictly provided by UI:`, services);
  
  const gross = calculateInvoiceTotal(services);
  console.log(`[BILLING] Gross amount securely calculated: ${gross}`);

  // Auto-compute scholarships and discounts assigned to this student
  let finalScholarship = num(scholarship);
  let finalDiscount = num(discount);
  let scholarshipBreakdown = [];
  let discountBreakdown = [];

  try {
    const deductions = computeAllDeductions(student.id, services, gross, session, term);
    if (deductions.scholarshipAmount > 0 || deductions.discountAmount > 0) {
      finalScholarship     = deductions.scholarshipAmount;
      finalDiscount        = deductions.discountAmount;
      scholarshipBreakdown = deductions.scholarshipBreakdown;
      discountBreakdown    = deductions.discountBreakdown;
    }
  } catch (_) {
    // fallback to manually passed values
  }

  const total = roundCurrency(Math.max(0, gross - finalScholarship - finalDiscount));
  const invoiceNo = await nextInvoiceNo();
  const inv = {
    id: uuid(), invoiceNo, studentId: student.id, studentName: student.fullName,
    admissionNo: student.admissionNo, sectionId: student.sectionId, classId: student.classId,
    session, term, type,
    services,
    grossAmount: gross,
    totalAmount: total,
    discount: finalDiscount,
    scholarship: finalScholarship,
    scholarshipBreakdown,
    discountBreakdown,
    amountPaid: 0, balance: total, status: "UNPAID",
    payments: [], createdAt: Date.now()
  };
  db.save("invoices", inv);
  
  const smsCfg = db.setting("smsGateway") || {};
  if (smsCfg.autoInvoice && student.parentPhone) {
    import("./sms.js").then(({ sendSms }) => {
      sendSms(student.parentPhone, `Dear Parent,\n\nSchool fees invoice has been generated for ${student.fullName}.\n\nPlease login to view details.\n\nKCIS`);
    }).catch(console.error);
  }
  
  return inv;
}

export function recalcInvoice(inv) {
  const gross = calculateInvoiceTotal(inv.services);
  inv.grossAmount = gross;
  const total = roundCurrency(Math.max(0, gross - num(inv.discount) - num(inv.scholarship)));
  inv.totalAmount = total;
  inv.amountPaid = calculateTotalPaid(inv.payments);
  inv.balance = calculateOutstandingBalance(inv.totalAmount, inv.amountPaid);
  inv.status = computeStatus(inv.totalAmount, inv.amountPaid);
  db.save("invoices", inv);
  return inv;
}

export async function syncStudentProgramInvoice(student, { term = cfg.currentTerm(), session = cfg.currentSession(), type = "Program Assignment" } = {}) {
  const lines = buildProgramFeeLines(student, { session, term });
  const invoices = invoiceForStudent(student.id);
  let inv = invoices.find((i) => i.session === session && i.term === term && (i.services || []).some((s) => s.type === "program" || String(s.id || "").startsWith("program:")));
  if (!inv) inv = invoices.find((i) => i.session === session && i.term === term && num(i.amountPaid) === 0);
  const createProgramInvoice = async () => {
    try { return await createInvoice({ student, services: lines, type, term, session }); }
    catch (error) {
      if (error?.code === "duplicate-invoice") return error.invoice;
      throw error;
    }
  };
  if (!inv && lines.length) return createProgramInvoice();
  if (!inv) return null;
  if (num(inv.amountPaid) > 0) return lines.length ? createProgramInvoice() : inv;
  inv.services = [...lines, ...(inv.services || []).filter((s) => !(s.type === "program" || String(s.id || "").startsWith("program:") || (s.name || "").toLowerCase().includes("tuition fee")))];
  inv.type = inv.type || type;
  inv.session = session;
  inv.term = term;
  return recalcInvoice(inv);
}

export async function applyPayment(inv, { amount, paymentType, cashier }) {
  amount = num(amount);
  if (amount <= 0) throw new Error("Enter a valid amount.");

  if (amount > inv.balance) throw new Error("Amount exceeds the outstanding balance.");
  const receiptNo = await nextReceiptNo();
  const receipt = {
    id: uuid(), receiptNo, invoiceId: inv.id, invoiceNo: inv.invoiceNo,
    studentId: inv.studentId, studentName: inv.studentName, admissionNo: inv.admissionNo,
    amount, paymentType: paymentType || (amount >= inv.balance ? "Full Payment" : "Part Payment"),
    balance: 0, totalBill: inv.totalAmount, cashier: cashier || "", date: Date.now()
  };
  inv.payments = inv.payments || [];
  inv.payments.push({ receiptNo, amount, date: receipt.date });
  recalcInvoice(inv);
  receipt.balance = inv.balance;
  db.save("receipts", receipt);
  db.save("payments", { id: receipt.id, ...receipt });
  
  const smsCfg = db.setting("smsGateway") || {};
  if (smsCfg.autoPayment) {
    const student = db.get("students", inv.studentId);
    if (student && student.parentPhone) {
      import("./sms.js").then(({ sendSms }) => {
        sendSms(student.parentPhone, `Dear Parent,\n\nPayment of Ã¢â€šÂ¦${amount.toLocaleString()} has been received successfully.\n\nThank you.\n\nKCIS`);
      }).catch(console.error);
    }
  }

  return { receipt, invoice: inv };
}

// Optional service removal -> recalc instantly.
export function removeService(inv, serviceLineId) {
  inv.services = (inv.services || []).filter((s) => !(s.id === serviceLineId && s.optional));
  return recalcInvoice(inv);
}

export function invoiceForStudent(studentId) {
  return db.query("invoices", (i) => i.studentId === studentId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function softDeleteInvoice(invoiceId, userEmail) {
  const inv = db.get("invoices", invoiceId);
  if (!inv) return false;
  const deleted = { ...inv, deletedBy: userEmail, deletedDate: Date.now() };
  db.save("deletedInvoices", deleted);
  db.remove("invoices", invoiceId);
  db.save("auditLogs", { id: uuid(), type: "DELETE_INVOICE", uid: userEmail, at: Date.now(), message: `Deleted invoice ${inv.invoiceNo} for ${inv.studentName} (${naira(inv.totalAmount)})` });
  return true;
}

export async function softDeleteReceipt(receiptId, userEmail) {
  const rec = db.get("receipts", receiptId);
  if (!rec) return false;

  const deleted = { ...rec, deletedBy: userEmail, deletedDate: Date.now() };
  db.save("deletedReceipts", deleted);
  db.remove("receipts", receiptId);
  db.remove("payments", receiptId);

  db.save("auditLogs", { id: uuid(), type: "DELETE_RECEIPT", uid: userEmail, at: Date.now(), message: `Deleted receipt ${rec.receiptNo} for ${rec.studentName} (${naira(rec.amount)})` });

  // Accounting Protection: Revert invoice and student ledger
  if (rec.invoiceId) {
    const inv = db.get("invoices", rec.invoiceId);
    if (inv) {
      inv.payments = (inv.payments || []).filter(p => p.receiptNo !== rec.receiptNo);
      recalcInvoice(inv);
    }
  }

  return true;
}







