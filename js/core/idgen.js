// Multi-user-safe, offline-safe sequential ID generation using counters.
// When Firebase is available the sync engine provides a transaction-based reservation
// (window.__CICKANOReserveCounter) which guarantees uniqueness across devices.
// Offline, a local counter record is incremented. Counters never use array.length+1.
import { db } from "./db.js";

async function reserve(name) {
  if (typeof window.__CICKANOReserveCounter === "function") {
    try {
      const v = await window.__CICKANOReserveCounter(name);
      if (Number.isFinite(v)) {
        // keep local mirror in step
        db.save("counters", { id: name, value: v }, { sync: false });
        return v;
      }
    } catch (e) {
      console.warn("Counter transaction failed, using local counter", e);
    }
  }
  const cur = db.get("counters", name);
  const value = (cur ? Number(cur.value) : 0) + 1;
  db.save("counters", { id: name, value });
  return value;
}

const pad = (n, w = 3) => String(n).padStart(w, "0");

export async function nextAdmissionId(year = new Date().getFullYear()) {
  let maxSeq = 0;
  const students = db.list("students");
  const totalStudents = students.length;

  students.forEach(s => {
    if (!s.admissionNo) return;
    const parts = s.admissionNo.split("/");
    if (parts.length >= 3) {
      const seq = parseInt(parts[2], 10);
      if (!isNaN(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
  });

  const baseLine = Math.max(maxSeq, totalStudents);

  // Attempt to fast-forward the global counter if we are online and it's lagging
  if (typeof window.__CICKANOFastForwardCounter === "function") {
    try {
      await window.__CICKANOFastForwardCounter("globalAdmissionCounter", baseLine);
    } catch (e) { }
  }

  // Also fast-forward local counter
  const localCounter = db.get("counters", "globalAdmissionCounter");
  if (!localCounter || Number(localCounter.value) < baseLine) {
    db.save("counters", { id: "globalAdmissionCounter", value: baseLine }, { sync: false });
  }

  let admissionId;
  while (true) {
    const n = await reserve("globalAdmissionCounter");
    admissionId = `HALQA/${year}/${pad(n)}`;
    const existing = db.query("students", s => s.admissionNo === admissionId);
    if (existing.length === 0) break;
  }
  return admissionId;
}

export async function nextFamilyId(year = new Date().getFullYear()) {
  let familyId;
  while (true) {
    const n = await reserve("family-" + year);
    familyId = `FAM-${year}-${pad(n)}`;
    const existing = db.query("families", f => f.id === familyId);
    if (existing.length === 0) break;
  }
  return familyId;
}

export async function nextStudentId() {
  let studentId;
  while (true) {
    const n = await reserve("studentId");
    studentId = `STD${pad(n, 5)}`;
    const existing = db.query("students", s => s.studentNo === studentId || s.id === studentId);
    if (existing.length === 0) break;
  }
  return studentId;
}

export async function nextStaffId() {
  let staffId;
  while (true) {
    const n = await reserve("staffId");
    staffId = `STF${pad(n, 4)}`;
    const existing = db.query("staff", s => s.staffNo === staffId || s.id === staffId);
    if (existing.length === 0) break;
  }
  return staffId;
}

export async function nextInvoiceNo() {
  let invoiceNo;
  while (true) {
    const n = await reserve("invoiceNo");
    invoiceNo = `INV${pad(n, 5)}`;
    const existing = db.query("invoices", i => i.invoiceNo === invoiceNo);
    if (existing.length === 0) break;
  }
  return invoiceNo;
}

export async function nextReceiptNo() {
  let receiptNo;
  while (true) {
    const n = await reserve("receiptNo");
    receiptNo = `RCT${pad(n, 5)}`;
    const existing = db.query("receipts", r => r.receiptNo === receiptNo);
    if (existing.length === 0) break;
  }
  return receiptNo;
}

export async function nextPayslipNo(monthKey) {
  const n = await reserve("payslipNo");
  return `PS${pad(n, 5)}`;
}

export async function nextVoucherNo() {
  const n = await reserve("voucherNo");
  return `PV${pad(n, 5)}`;
}

export async function nextExpenseNo() {
  const n = await reserve("expenseNo");
  return `EXP${pad(n, 5)}`;
}

