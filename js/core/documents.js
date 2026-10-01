// Branded printable document templates. Every document pulls the school header from
// the central branding settings so a single logo upload appears everywhere.
import { headerHtml, getBranding } from "./branding.js";
import { makeQr } from "./print.js";
import { naira, fmtDate, fmtDateTime, escapeHtml, num, ordinal } from "./utils.js";
import * as cfg from "./config.js";

const statusBadge = (status) => {
  const s = (status || "UNPAID").toUpperCase();
  const cls = s === "PAID" ? "green" : s === "PARTIALLY PAID" || s === "PART PAYMENT" ? "orange" : "red";
  return `<span class="badge ${cls}">${s}</span>`;
};

// School appreciation message shown on every invoice and receipt.
const appreciation = () => {
  const b = getBranding();
  return `<div class="doc-appreciation center" style="margin-top:10px;font-style:italic;font-weight:600">${escapeHtml(b.schoolName)} appreciates your dedication and commitment to excellence.</div>`;
};

function paymentAccountHtml() {
  const acct = cfg.schoolAccount();
  if (!(acct.bankName || acct.accountName || acct.accountNumber || acct.branch || acct.referenceInstruction)) return "";
  return `<table class="doc-table">
    <tr><th colspan="2">Payment Instructions</th></tr>
    ${acct.bankName ? `<tr><td><b>Bank Name</b></td><td>${escapeHtml(acct.bankName)}</td></tr>` : ""}
    ${acct.accountName ? `<tr><td><b>Account Name</b></td><td>${escapeHtml(acct.accountName)}</td></tr>` : ""}
    ${acct.accountNumber ? `<tr><td><b>Account Number</b></td><td>${escapeHtml(acct.accountNumber)}</td></tr>` : ""}
    ${acct.branch ? `<tr><td><b>Branch</b></td><td>${escapeHtml(acct.branch)}</td></tr>` : ""}
    <tr><td><b>Reference</b></td><td>${escapeHtml(acct.referenceInstruction || "Use Admission Number as Payment Reference")}</td></tr>
  </table>`;
}

function feePaymentDeadline() {
  const acct = cfg.schoolAccount();
  const deadline = acct.feePaymentDeadline || cfg.sessions().feePaymentDeadline || cfg.sessions().nextTermBegins || "";
  return deadline ? fmtDate(deadline) : "To be announced";
}

function invoiceFooterHtml(qr = "") {
  const acct = cfg.schoolAccount();
  const b = getBranding();
  const accountName = acct.accountName || b.schoolName || "Halqatu Zaid bin Sabit Kano";
  const accountNumber = acct.accountNumber || "0814837554";
  const bankName = acct.bankName || "GTBANK";
  const instruction = acct.referenceInstruction || "Use Admission Number as Payment Reference";
  return `<div class="invoice-footer">
    <div class="invoice-footer-grid" style="display:flex; justify-content: space-between;">
      <div style="flex: 1;">
        <div class="invoice-section-title">Account Details</div>
        <div class="invoice-footer-line"><b>Account Name</b><span>${escapeHtml(accountName)}</span></div>
        <div class="invoice-footer-line"><b>Account Number</b><span>${escapeHtml(accountNumber)}</span></div>
        <div class="invoice-footer-line"><b>Bank Name</b><span>${escapeHtml(bankName)}</span></div>
      </div>
      <div style="flex: 1; padding-left: 20px;">
        <div class="invoice-section-title">Payment Instructions</div>
        <div class="invoice-footer-note">${escapeHtml(instruction)}</div>
        <div class="invoice-footer-note">Please notify the school immediately after payment${b.phone ? " via " + escapeHtml(b.phone) : ""}.</div>
        <div class="invoice-deadline">Fee Payment Deadline: ${escapeHtml(feePaymentDeadline())}</div>
      </div>
      ${qr ? `<div style="text-align:right; margin-left:20px;">${qr}<div style="font-size:10px; color:#777; margin-top:4px; text-align:center;">Scan to verify</div></div>` : ""}
    </div>
    <div class="invoice-notice">
      Important Notice: Students with outstanding school fees may not be eligible to write examinations and must clear all outstanding payments before resuming for the next term.
    </div>
  </div>`;
}

function receiptFooterHtml(qr = "") {
  return `<div style="display:flex; justify-content:space-between; align-items:flex-end;">
    <div class="note center" style="font-weight:700;font-size:13px; flex:1;">
      Thank you for your Payment.<br>
      We appreciate Your Prompt Settlement.
    </div>
    ${qr ? `<div style="text-align:right;">${qr}<div style="font-size:10px; color:#777; margin-top:4px; text-align:center;">Scan to verify</div></div>` : ""}
  </div>`;
}

function signatureLine(title, name, image, phone) {
  return `<div class="sig-box" style="text-align:center; width: 220px;">
    <div style="min-height:20px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:2px;">
      ${image ? `<img src="${image}" style="max-height:35px;max-width:150px;object-fit:contain">` : ""}
    </div>
    <div style="border-top:1px solid #000; width: 100%; padding-top: 2px; line-height: 1.3; font-size: 12px;">
      <div style="font-weight:bold">${escapeHtml(name)}</div>
      <div>${escapeHtml(title)}</div>
      ${phone ? `<div>${escapeHtml(phone)}</div>` : ""}
    </div>
  </div>`;
}

function approvalSignaturesHtml() {
  const b = getBranding();
  const sig = cfg.schoolSignatures();
  const name = sig.directorName || b.directorName || b.proprietorName || "Zahradden Suraj";
  const phone = sig.contactPhone || b.phone || "08034760436";
  return `<div class="signature-section">
    <div class="sig-row">
      ${signatureLine("Proprietor/Director", name, sig.directorSignature, phone)}
    </div>
  </div>`;
}

function invoiceHeaderHtml(student = null) {
  const b = getBranding();
  const arabicName = b.arabicName || b.schoolNameArabic || "";
  const photoHtml = student && student.passport ? `<img src="${student.passport}" alt="Student Photo" style="width:84px;height:84px;object-fit:cover;border-radius:8px;border:1px solid #ccc;">` : `<div style="width:84px;height:84px;border:1px dashed #ccc;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#999;font-size:10px;">No Photo</div>`;
  return `<div class="invoice-head-grid">
    <div class="invoice-logo-box">${b.logoBase64 ? `<img src="${b.logoBase64}" alt="School Logo">` : `<div class="invoice-logo-placeholder">LOGO</div>`}</div>
    <div class="invoice-school-info">
      <h1>${escapeHtml(b.schoolName)}</h1>
      ${arabicName ? `<div class="invoice-arabic">${escapeHtml(arabicName)}</div>` : ""}
      <div class="invoice-motto">${escapeHtml(b.motto || "The Splendour of a Better Tomorrow")}</div>
      <div>${escapeHtml(b.address || "")}</div>
      <div>${escapeHtml(b.phone || "")}${b.email ? " | " + escapeHtml(b.email) : ""}</div>
    </div>
    <div class="invoice-qr-box">${photoHtml}</div>
  </div>`;
}

function invoiceApprovalSignaturesHtml() {
  const b = getBranding();
  const sig = cfg.schoolSignatures();
  const name = sig.directorName || b.directorName || b.proprietorName || "Zahradden Suraj";
  const phone = sig.contactPhone || b.phone || "08034760436";
  return `<div class="invoice-signatures">
    ${signatureLine("Proprietor/Director", name, sig.directorSignature, phone)}
  </div>`;
}

export function invoiceDoc(inv, student) {
  const clsName = cfg.className(inv.classId || student?.classId);
  const secName = cfg.sectionName(inv.sectionId || student?.sectionId);
  const fmtCls = clsName === "Pending Assignment" ? `<span style="color:var(--danger, red);font-weight:bold;">Pending Assignment</span>` : escapeHtml(clsName);
  const fmtSec = secName === "Pending Assignment" ? `<span style="color:var(--danger, red);font-weight:bold;">Pending Assignment</span>` : escapeHtml(secName);

  const qr = makeQr(JSON.stringify({ inv: inv.invoiceNo, sid: inv.studentId, adm: inv.admissionNo }), 84);
  const rows = (inv.services || []).map((s) => `<tr><td>${escapeHtml(s.name)}</td><td class="right">${naira(s.amount)}</td></tr>`).join("");
  const programText = student ? cfg.studentProgramIds(student).map((id) => cfg.programName(id)).join(", ") : "";
  const payRows = (inv.payments || []).map((p) =>
    `<tr><td>${escapeHtml(p.receiptNo)}</td><td>${fmtDate(p.date)}</td><td class="right">${naira(p.amount)}</td></tr>`).join("")
    || `<tr><td colspan="3" class="muted center">No payments yet</td></tr>`;
  const adjustmentRows = [
    ...(inv.scholarshipBreakdown && inv.scholarshipBreakdown.length
      ? inv.scholarshipBreakdown.map((s) => `<tr class="invoice-good"><td>Scholarship - ${escapeHtml(s.name)}</td><td class="right">- ${naira(s.amount)}</td></tr>`)
      : (inv.scholarship > 0 ? [`<tr class="invoice-good"><td>Scholarship Adjustment</td><td class="right">- ${naira(inv.scholarship || 0)}</td></tr>`] : [])),
    ...(inv.discountBreakdown && inv.discountBreakdown.length
      ? inv.discountBreakdown.map((d) => `<tr class="invoice-warn"><td>Discount - ${escapeHtml(d.name)}</td><td class="right">- ${naira(d.amount)}</td></tr>`)
      : (inv.discount > 0 ? [`<tr class="invoice-warn"><td>Discount</td><td class="right">- ${naira(inv.discount || 0)}</td></tr>`] : []))
  ].join("");
  return `
  <section class="a4-one-page invoice-doc">
  ${invoiceHeaderHtml(student)}
  <div class="invoice-title-row">
    <div>
      <div class="invoice-title">Fee Invoice</div>
      <div class="invoice-subtitle">Official school financial document</div>
    </div>
    <div class="invoice-balance-card"><span>Outstanding Balance</span><b>${naira(inv.balance)}</b></div>
  </div>
  <div class="invoice-details-grid">
    <div><span>Invoice Number</span><b>${escapeHtml(inv.invoiceNo)}</b></div>
    <div><span>Invoice Date</span><b>${fmtDate(inv.createdAt)}</b></div>
    <div><span>Student Name</span><b>${escapeHtml(student?.fullName || inv.studentName)}</b></div>
    <div><span>Admission Number</span><b>${escapeHtml(inv.admissionNo)}</b></div>
    <div><span>Class</span><b>${fmtCls}</b></div>
    <div><span>Section</span><b>${fmtSec}</b></div>
    <div><span>Session</span><b>${escapeHtml(inv.session)}</b></div>
    <div><span>Term</span><b>${escapeHtml(inv.term)}</b></div>
    <div><span>Status</span><b>${statusBadge(inv.status)}</b></div>
    <div><span>Invoice Type</span><b>${escapeHtml(inv.type || "New Student")}</b></div>
  </div>
  <div class="invoice-mini-row">
    <div><b>Student ID:</b> ${escapeHtml(student?.studentId || inv.studentId)}</div>
    <div><b>Programs:</b> ${escapeHtml(programText || cfg.sectionName(student?.sectionId))}</div>
    <div><b>Parent:</b> ${escapeHtml(student?.parentName || "")}${student?.parentPhone ? " | " + escapeHtml(student.parentPhone) : ""}</div>
  </div>
  <table class="doc-table invoice-fee-table">
    <colgroup><col style="width:72%"><col style="width:28%"></colgroup>
    <tr><th>Fee Item</th><th class="right">Amount</th></tr>
    ${rows}
    <tr style="border-top:1px solid #ddd"><td><b>Gross Charges</b></td><td class="right"><b>${naira(inv.grossAmount || (inv.services || []).reduce((a, s) => a + num(s.amount), 0))}</b></td></tr>
    ${adjustmentRows}
    <tr class="totals"><td>Net Amount Payable</td><td class="right">${naira(inv.totalAmount)}</td></tr>
  </table>
  <table class="doc-table invoice-summary-table">
    <tr><th colspan="2">Payment Summary</th></tr>
    <tr><td>Net Amount Payable</td><td class="right">${naira(inv.totalAmount)}</td></tr>
    <tr><td>Amount Paid</td><td class="right">${naira(inv.amountPaid || 0)}</td></tr>
    <tr class="totals"><td>Outstanding Balance</td><td class="right">${naira(inv.balance)}</td></tr>
  </table>
  <table class="doc-table invoice-payments-table">
    <tr><th>Receipt No</th><th>Date</th><th class="right">Amount</th></tr>
    ${payRows}
  </table>
  ${invoiceFooterHtml(qr)}
  ${invoiceApprovalSignaturesHtml()}
  </section>
  `;
}

export function receiptDoc(receipt, student, invoice) {
  const qr = makeQr(JSON.stringify({ rct: receipt.receiptNo, sid: receipt.studentId }), 84);
  const photoHtml = student && student.passport ? `<img src="${student.passport}" alt="Student Photo" style="width:84px;height:84px;object-fit:cover;border-radius:8px;border:1px solid #ccc;">` : `<div style="width:84px;height:84px;border:1px dashed #ccc;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#999;font-size:10px;">No Photo</div>`;
  return `
  <section class="a4-one-page receipt-doc">
  ${headerHtml()}
  <div class="doc-title">Payment Receipt</div>
  <div class="row" style="display:flex;justify-content:space-between">
    <div class="kv" style="flex:1">
      <div><span>Receipt No:</span> <b>${escapeHtml(receipt.receiptNo)}</b></div>
      <div><span>Date:</span> ${fmtDateTime(receipt.date)}</div>
      <div><span>Student:</span> ${escapeHtml(student?.fullName || receipt.studentName)}</div>
      <div><span>Admission No:</span> ${escapeHtml(receipt.admissionNo)}</div>
      <div><span>Class:</span> ${escapeHtml(cfg.className(student?.classId))}</div>
      <div><span>Invoice:</span> ${escapeHtml(receipt.invoiceNo || "")}</div>
    </div>
    <div style="text-align:center">${photoHtml}</div>
  </div>
  <table class="doc-table">
    <tr><th>Description</th><th class="right">Amount</th></tr>
    <tr><td>Amount Paid (${escapeHtml(receipt.paymentType || "Payment")})</td><td class="right">${naira(receipt.amount)}</td></tr>
    <tr><td>Total Bill</td><td class="right">${naira(receipt.totalBill || invoice?.totalAmount || 0)}</td></tr>
    <tr class="totals"><td>Outstanding Balance</td><td class="right">${naira(receipt.balance)}</td></tr>
  </table>
  <div class="sig-row">
    <div class="sig-box"><div class="sig-line">Cashier: ${escapeHtml(receipt.cashier || "")}</div></div>
    <div class="sig-box"><div class="sig-line">Authorised Signature / Stamp</div></div>
  </div>
  ${receiptFooterHtml(qr)}
  </section>
  `;
}

export function familyReceiptDoc(family, receipts, date, cashier) {
  const qr = makeQr(JSON.stringify({ fam: family.familyId, ts: date }), 84);
  const totalAmount = receipts.reduce((a, r) => a + num(r.amount), 0);

  const receiptRows = receipts.map(r => `
    <tr>
      <td>${escapeHtml(r.studentName || "")}</td>
      <td>${escapeHtml(r.receiptNo || "")}</td>
      <td>${escapeHtml(r.invoiceNo || "")}</td>
      <td class="right">${naira(r.amount)}</td>
    </tr>
  `).join("");

  return `
  <section class="a4-one-page receipt-doc">
  ${headerHtml()}
  <div class="doc-title">Family Payment Receipt</div>
  <div class="row" style="display:flex;justify-content:space-between">
    <div class="kv" style="flex:1">
      <div><span>Family ID:</span> <b>${escapeHtml(family.familyId)}</b></div>
      <div><span>Parent / Guardian:</span> ${escapeHtml(family.parentName || "")}</div>
      <div><span>Date:</span> ${fmtDateTime(date)}</div>
    </div>
  </div>
  <table class="doc-table">
    <tr><th>Student</th><th>Receipt No</th><th>Invoice No</th><th class="right">Amount Allocated</th></tr>
    ${receiptRows}
    <tr class="totals"><td colspan="3">Total Payment Received</td><td class="right">${naira(totalAmount)}</td></tr>
  </table>
  <div class="sig-row">
    <div class="sig-box"><div class="sig-line">Cashier: ${escapeHtml(cashier || "")}</div></div>
    <div class="sig-box"><div class="sig-line">Authorised Signature / Stamp</div></div>
  </div>
  ${receiptFooterHtml(qr)}
  </section>
  `;
}

export function payslipDoc(ps, staff) {
  const b = getBranding();

  // Extract values with fallbacks to 0
  const basic = num(ps.basic);
  const officeAllowance = num(ps.officeAllowance);
  const specialAllowance = num(ps.specialAllowance);

  const w1 = num(ps.week1Bonus);
  const w2 = num(ps.week2Bonus);
  const w3 = num(ps.week3Bonus);
  const w4 = num(ps.week4Bonus);
  const adminBonus = num(ps.adminBonus);
  const examBonus = num(ps.examBonus);
  const yearlyIncrease = num(ps.yearlyIncrease);
  const genericBonus = num(ps.bonus);
  const otherBonus = num(ps.otherBonus) + genericBonus + officeAllowance + specialAllowance; // Group unmentioned standard allowances here to avoid data loss

  const paye = num(ps.paye);
  const loan = num(ps.loan);
  const lateness = num(ps.latenessDeduction);
  const absence = ps.absenceDeduction == null ? num(ps.attendanceDeduction) : num(ps.absenceDeduction);
  const otherDed = ps.otherDeductions == null ? num(ps.deduction) : num(ps.otherDeductions);
  const partPayment = num(ps.partPayment);

  const amountPerDay = num(ps.amountPerDay || staff?.amountPerDay);
  const daysWorked = ps.daysWorked || staff?.daysWorked || "";

  const customBonuses = (ps.bonuses || []).map(b => `<tr><td>${escapeHtml(b.reason)}</td><td class="right">${naira(b.amount)}</td></tr>`).join("");
  const customDeductions = (ps.deductions || []).map(d => `<tr><td>${escapeHtml(d.reason)}</td><td><span style="font-size:11px;color:#555;">[Auth: ${escapeHtml(d.authorizedBy)} | Date: ${escapeHtml(d.date)}]</span></td><td class="right">${naira(d.amount)}</td></tr>`).join("");

  const totalCustomBonus = (ps.bonuses || []).reduce((a, b) => a + num(b.amount), 0);
  const totalCustomDed = (ps.deductions || []).reduce((a, d) => a + num(d.amount), 0);

  const totalBonus = w1 + w2 + w3 + w4 + adminBonus + examBonus + otherBonus + totalCustomBonus;
  const salaryPlusBonus = basic + yearlyIncrease + totalBonus;
  const totalDeductions = paye + loan + lateness + absence + otherDed + totalCustomDed;
  const net = ps.netPay == null ? (salaryPlusBonus - totalDeductions - partPayment) : num(ps.netPay);

  const disbDate = fmtDate(ps.payDate || ps.paymentDate || ps.createdAt || Date.now());
  const staffNo = escapeHtml(staff?.staffNo || ps.staffNo || ps.staffId || "");
  const staffName = escapeHtml(staff?.name || ps.staffName || "");
  const bankName = escapeHtml(staff?.bankName || ps.bankName || "");
  const accNo = escapeHtml(staff?.accountNumber || ps.accountNumber || "");

  const sig = cfg.schoolSignatures();
  const directorName = sig.directorName || b.directorName || b.proprietorName || "Zahradden Suraj";
  const contactPhone = sig.contactPhone || b.phone || "08034760436";
  const sigImg = sig.directorSignature ? `<img src="${sig.directorSignature}" style="max-height:60px;display:block;margin:0 auto 4px auto">` : `<div style="height:40px"></div>`;
  const watermarkHtml = b.logoBase64 ? `<img src="${b.logoBase64}" class="doc-watermark" alt="">` : "";

  return `
  <section class="a4-one-page payslip-doc" style="position:relative; overflow:hidden;">
    ${watermarkHtml}
    
    <div style="display:flex; align-items:center; border-bottom: 2px solid #2c3e50; padding-bottom: 15px; margin-bottom: 20px;">
      <div style="flex:0 0 100px;">
        ${b.logoBase64 ? `<img src="${b.logoBase64}" style="width:90px;height:auto">` : `<div style="width:90px;height:90px;background:#eee;border:1px solid #ccc;display:flex;align-items:center;justify-content:center;font-size:10px">LOGO</div>`}
      </div>
      <div style="flex:1; text-align:center;">
        <h1 style="margin:0; font-size:24px; color:#2c3e50; font-weight:bold;">${escapeHtml(b.schoolName)}</h1>
        <div style="font-size:14px; font-weight:bold; margin: 4px 0; letter-spacing: 1px;">MOTTO: ${escapeHtml(b.motto || "The Splendour of a Better Tomorrow")}</div>
        <div style="font-size:13px;">${escapeHtml(b.address || "No. 123 BUK Road, Kano State, Nigeria")}</div>
        <div style="font-size:13px; font-weight:bold;">PHONE: ${escapeHtml(b.phone || "08039361153")}</div>
      </div>
      <div style="flex:0 0 100px;"></div> <!-- Spacer for centering -->
    </div>
    
    <div style="text-align:center; margin-bottom:20px;">
      <h2 style="margin:0; font-size:20px; text-transform:uppercase; text-decoration:underline; letter-spacing:2px;">STAFF PAYSLIP</h2>
    </div>
    
    <div style="margin-bottom:20px;">
      <div style="background:#f8f9fa; border:1px solid #dee2e6; padding:10px; font-weight:bold; margin-bottom:5px;">STAFF INFORMATION</div>
      <table style="width:100%; border-collapse:collapse; font-size:14px;">
        <tr><td style="padding:4px; width:30%;"><b>Disbursement Date:</b></td><td style="padding:4px;">${disbDate}</td></tr>
        <tr><td style="padding:4px;"><b>Staff Work Number:</b></td><td style="padding:4px;">${staffNo}</td></tr>
        <tr><td style="padding:4px;"><b>Staff Name:</b></td><td style="padding:4px;">${staffName}</td></tr>
        <tr><td style="padding:4px;"><b>Bank Name:</b></td><td style="padding:4px;">${bankName}</td></tr>
        <tr><td style="padding:4px;"><b>Account Number:</b></td><td style="padding:4px;">${accNo}</td></tr>
      </table>
    </div>

    <div style="margin-bottom:20px;">
      <div style="background:#f8f9fa; border:1px solid #dee2e6; padding:10px; font-weight:bold; margin-bottom:5px;">WORK INFORMATION</div>
      <table style="width:100%; border-collapse:collapse; font-size:14px;">
        <tr><td style="padding:4px; width:30%;"><b>Amount Per Day:</b></td><td style="padding:4px;">${naira(amountPerDay)}</td></tr>
        <tr><td style="padding:4px;"><b>Days Worked:</b></td><td style="padding:4px;">${escapeHtml(String(daysWorked))}</td></tr>
      </table>
    </div>

    <div style="margin-bottom:20px;">
      <div style="background:#f8f9fa; border:1px solid #dee2e6; padding:10px; font-weight:bold; margin-bottom:5px;">SALARY BREAKDOWN (ADDITIONS)</div>
      <table class="doc-table payslip-table" style="width:100%;">
        <thead>
          <tr><th style="text-align:left;">Description</th><th style="text-align:right; width:150px;">Amount (â‚¦)</th></tr>
        </thead>
        <tbody>
          <tr><td>Basic Salary</td><td class="right">${naira(basic)}</td></tr>
          ${w1 > 0 ? `<tr><td>Week 1 Bonus</td><td class="right">${naira(w1)}</td></tr>` : ""}
          ${w2 > 0 ? `<tr><td>Week 2 Bonus</td><td class="right">${naira(w2)}</td></tr>` : ""}
          ${w3 > 0 ? `<tr><td>Week 3 Bonus</td><td class="right">${naira(w3)}</td></tr>` : ""}
          ${w4 > 0 ? `<tr><td>Week 4 Bonus</td><td class="right">${naira(w4)}</td></tr>` : ""}
          ${adminBonus > 0 ? `<tr><td>Administrative Bonus</td><td class="right">${naira(adminBonus)}</td></tr>` : ""}
          ${examBonus > 0 ? `<tr><td>Exam Bonus</td><td class="right">${naira(examBonus)}</td></tr>` : ""}
          ${yearlyIncrease > 0 ? `<tr><td>Yearly Increase</td><td class="right">${naira(yearlyIncrease)}</td></tr>` : ""}
          ${otherBonus > 0 ? `<tr><td>Other Allowances</td><td class="right">${naira(otherBonus)}</td></tr>` : ""}
          ${customBonuses}
        </tbody>
      </table>
    </div>
    
    <div style="margin-bottom:20px;">
      <div style="background:#f8f9fa; border:1px solid #dee2e6; padding:10px; font-weight:bold; margin-bottom:5px;">DEDUCTIONS</div>
      <table class="doc-table payslip-table" style="width:100%;">
        <thead>
          <tr><th style="text-align:left;">Description</th><th style="text-align:left;">Justification</th><th style="text-align:right; width:150px;">Amount (â‚¦)</th></tr>
        </thead>
        <tbody>
          ${paye > 0 ? `<tr><td>PAYE</td><td>Statutory</td><td class="right">${naira(paye)}</td></tr>` : ""}
          ${loan > 0 ? `<tr><td>Loan Repayment</td><td>Standard</td><td class="right">${naira(loan)}</td></tr>` : ""}
          ${lateness > 0 ? `<tr><td>Lateness Deduction</td><td>Attendance Record</td><td class="right">${naira(lateness)}</td></tr>` : ""}
          ${absence > 0 ? `<tr><td>Absence Deduction</td><td>Attendance Record</td><td class="right">${naira(absence)}</td></tr>` : ""}
          ${otherDed > 0 ? `<tr><td>Other Deduction</td><td>General</td><td class="right">${naira(otherDed)}</td></tr>` : ""}
          ${customDeductions}
          ${totalDeductions === 0 ? `<tr><td colspan="3" class="muted">No deductions recorded</td></tr>` : ""}
        </tbody>
      </table>
    </div>

    <div style="margin-bottom:30px;">
      <div style="background:#f8f9fa; border:1px solid #dee2e6; padding:10px; font-weight:bold; margin-bottom:5px;">TOTALS SECTION</div>
      <table class="doc-table payslip-table" style="width:100%;">
        <thead>
          <tr><th style="text-align:left;">Item</th><th style="text-align:right; width:150px;">Amount</th></tr>
        </thead>
        <tbody>
          <tr><td>Total Additions (Basic + Bonus)</td><td class="right">${naira(salaryPlusBonus)}</td></tr>
          <tr><td>Total Deductions</td><td class="right" style="color:red">- ${naira(totalDeductions)}</td></tr>
          ${partPayment > 0 ? `<tr><td>Part Payment Made</td><td class="right" style="color:red">- ${naira(partPayment)}</td></tr>` : ""}
          <tr>
            <td style="font-size:18px; font-weight:bold; border:2px solid #000; border-right:none; padding:10px;">NET AMOUNT PAYABLE</td>
            <td class="right" style="font-size:18px; font-weight:bold; border:2px solid #000; border-left:none; padding:10px;">${naira(net)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div style="text-align:center; font-style:italic; font-size:14px; margin-bottom:40px; color:#555;">
      Thank you for your service and dedication.<br>
      ${escapeHtml(b.schoolName)} is proud of you.<br>
      We truly appreciate your hard work and commitment.
    </div>

    <div style="text-align:center; margin-top:auto; padding-top:20px;">
      ${sigImg}
      <div style="width:250px; border-top:1px dashed #000; margin:0 auto 8px auto;"></div>
      <div style="font-weight:bold; font-size:16px; margin-bottom:4px;">${escapeHtml(directorName)}</div>
      <div style="font-style:italic; font-size:14px; margin-bottom:4px;">Proprietor/Director</div>
      <div style="font-size:14px;">${escapeHtml(contactPhone)}</div>
    </div>
  </section>
  `;
}

export function voucherDoc(voucher) {
  const b = getBranding();
  const lines = (voucher.rows || []).map((r, i) => `
    <tr>
      <td class="center">${i + 1}</td><td>${escapeHtml(r.name)}</td>
      <td class="right">${naira(r.basic)}</td><td class="right">${naira(r.officeAllowance)}</td>
      <td class="right">${naira(r.specialAllowance)}</td><td class="right">${naira(r.bonus)}</td>
      <td class="right">${naira(r.gross)}</td>
      <td class="right">${naira(r.paye)}</td><td class="right">${naira(r.loan)}</td>
      <td class="right">${naira(r.lateness)}</td><td class="right">${naira(r.absence)}</td>
      <td class="right">${naira(r.otherDeductions)}</td>
      <td class="right">${naira(r.net)}</td><td>${escapeHtml(r.accountNumber || "")}</td>
      <td>${escapeHtml(r.bank || "")}</td><td>${escapeHtml(r.remarks || "")}</td>
    </tr>`).join("");
  return `
  <section class="voucher-doc">
  ${headerHtml()}
  <div class="doc-title">Ø³Ù†Ø¯ ØµØ±Ù Ø§Ù„Ø±ÙˆØ§ØªØ¨ / Staff Salary Payment Voucher</div>
  <div style="margin:8px 0"><b>Staff Salary Payment Voucher.</b> Section: ${escapeHtml(voucher.section || "All")} &nbsp; Month: ${escapeHtml(voucher.monthLabel || voucher.month)} &nbsp; Year: ${escapeHtml(String(voucher.year || ""))}</div>
  <table class="doc-table compact wide-table">
    <tr>
      <th rowspan="2">S/N</th><th rowspan="2">Name</th>
      <th colspan="5" class="center">Payment details</th>
      <th colspan="5" class="center">Deductions</th>
      <th colspan="4" class="center">Net pay and Account Details</th>
    </tr>
    <tr>
      <th>Basic</th><th>Office Allow.</th><th>Special Duty</th><th>Bonus</th><th>Gross Pay</th>
      <th>Paye</th><th>Loan</th><th>Lateness</th><th>Absence</th><th>Other</th>
      <th>Net Pay</th><th>Account No.</th><th>Bank</th><th>Remarks</th>
    </tr>
    ${lines}
  </table>
  <div style="margin-top:12px"><b>Total Salary for the month: ${naira(voucher.total)}</b></div>
  
  <div style="margin-top:40px;">
    <h3>Deduction & Bonus Breakdown</h3>
    <table class="doc-table compact">
      <tr><th>Staff</th><th>Type</th><th>Reason</th><th>Amount</th><th>Date</th><th>Authorized By</th></tr>
      ${(voucher.rows || []).flatMap(r => [
    ...(r.bonuses || []).map(b => `<tr><td>${escapeHtml(r.name)}</td><td>Bonus</td><td>${escapeHtml(b.reason)}</td><td>${naira(b.amount)}</td><td>${new Date(b.date).toLocaleDateString()}</td><td>${escapeHtml(b.createdBy)}</td></tr>`),
    ...(r.deductions || []).map(d => `<tr><td>${escapeHtml(r.name)}</td><td>Deduction</td><td>${escapeHtml(d.reason)}</td><td>${naira(d.amount)}</td><td>${new Date(d.date).toLocaleDateString()}</td><td>${escapeHtml(d.createdBy)}</td></tr>`)
  ]).join("") || '<tr><td colspan="6" class="center muted">No detailed bonuses or deductions</td></tr>'}
    </table>
  </div>
  
  ${approvalSignaturesHtml()}
  </section>
  `;
}

function gradeScaleHtml() {
  return cfg.grading().map((g) => `<tr><td>${g.grade} - ${escapeHtml(g.remark)}</td></tr>`).join("");
}

export function reportCardDoc(student, result, observations = []) {
  const type = cfg.sectionType(student.sectionId);
  if (type === "tahfiz") return tahfizReport(student, result);
  return academicReport(student, result, observations, type);
}

function academicReport(student, result, observations, type) {
  const subjects = result.subjects || [];
  let densityClass = "";
  if (subjects.length > 15) densityClass = " density-extra-compact";
  else if (subjects.length > 10) densityClass = " density-compact";

  const totalCA = subjects.reduce((a, s) => a + num(s.ca), 0);
  const totalExam = subjects.reduce((a, s) => a + num(s.exam), 0);
  const grand = subjects.reduce((a, s) => a + num(s.total), 0);
  const avg = subjects.length ? (grand / subjects.length) : 0;
  const subjRows = subjects.length ? subjects.map((s) =>
    `<tr><td>${escapeHtml(s.name)}</td><td class="center">${num(s.ca)}</td><td class="center">${num(s.exam)}</td><td class="center">${num(s.total)}</td><td class="center">${escapeHtml(s.grade || cfg.gradeFor(s.total).grade)}</td><td>${escapeHtml(s.remark || cfg.gradeFor(s.total).remark)}</td></tr>`
  ).join("") : `<tr><td colspan="6" class="muted">No results found for this term</td></tr>`;
  const obsRows = (observations.length ? observations : defaultObs(type)).map((o) =>
    `<tr><td>${escapeHtml(o.trait)}</td><td class="center">${escapeHtml(o.rating)}</td></tr>`).join("");
  const titleMap = { islamiyya: "Islamiyya Terminal Report Sheet" };
  return `
  <section class="report-card-doc a4-one-page${densityClass}">
  ${headerHtml({ withPassport: true, passport: student.passport })}
  <div class="doc-title">${titleMap[type] || "Terminal Report Sheet"}</div>
  <table class="doc-table">
    <tr><td><b>NAME:</b></td><td>${escapeHtml(student.fullName)}</td><td><b>FINAL GRADE:</b></td><td>${escapeHtml(cfg.gradeFor(avg).grade)}</td></tr>
    <tr><td><b>CLASS:</b></td><td>${escapeHtml(cfg.className(student.classId))}</td><td><b>TOTAL SCORE:</b></td><td>${grand}</td></tr>
    <tr><td><b>TERM ENDING:</b></td><td>${escapeHtml(result.termEnding || "")}</td><td><b>FINAL AVERAGE:</b></td><td>${avg.toFixed(2)}</td></tr>
    <tr><td><b>TERM/SESSION:</b></td><td>${escapeHtml((result.term || "") + " " + (result.session || ""))}</td><td><b>NO. IN CLASS:</b></td><td>${result.classSize || ""}</td></tr>
    <tr><td><b>ADMISSION NO:</b></td><td>${escapeHtml(student.admissionNo)}</td><td><b>CLASS AVERAGE:</b></td><td>${(result.classAverage != null ? Number(result.classAverage).toFixed(2) : "0.00")}%</td></tr>
    <tr><td><b>POSITION:</b></td><td>${result.position ? ordinal(result.position) : ""}</td><td><b>ADMISSION TYPE:</b></td><td>${escapeHtml(cfg.sectionName(student.sectionId))}</td></tr>
  </table>
  <table class="doc-table">
    <tr><th>Subjects</th><th class="center">CA 40%</th><th class="center">Exam 60%</th><th class="center">Total 100%</th><th class="center">Grade</th><th>Remark</th></tr>
    ${subjRows}
    <tr class="totals"><td>TOTAL</td><td class="center">${totalCA}</td><td class="center">${totalExam}</td><td class="center">${grand}</td><td colspan="2" class="center">No. of Subjects Offered: ${subjects.length}</td></tr>
  </table>
  <div class="note"><b>GRADE DETAILS:</b> ${cfg.grading().map((g) => `${g.grade} = ${g.min} - ${g.max}`).reverse().join(", ")}</div>
  <div class="obs-scale-row" style="display:flex;">
    <table class="doc-table" style="flex:1">
      <tr><th colspan="2" class="center">General Observation Rating</th></tr>
      <tr><th>General Observation</th><th class="center">Rating</th></tr>
      ${obsRows}
    </table>
    <table class="doc-table" style="width:200px">
      <tr><th class="center">Scale</th></tr>
      ${gradeScaleHtml()}
    </table>
  </div>
  <div class="remarks-section">
    <table class="doc-table">
      <tr><td><b>CLASS TEACHER'S COMMENT:</b></td><td>${escapeHtml(result.teacherComment || autoComment(avg))}</td></tr>
      <tr><td><b>HEAD TEACHER'S COMMENT:</b></td><td>${escapeHtml(result.headComment || autoComment(avg, true))}</td></tr>
      <tr><td><b>NEXT TERM BEGINS:</b></td><td>${escapeHtml(cfg.sessions().nextTermBegins || "")}</td></tr>
    </table>
    <div class="note fees-reminder"><b>FEES REMINDER:</b> School fees are expected to be settled two weeks before or after resumption.</div>
    ${approvalSignaturesHtml()}
  </div>
  </section>
  `;
}

function tahfizReport(student, result) {
  const t = result.tahfiz || {};
  return `
  <section class="report-card-doc a4-one-page">
  ${headerHtml({ withPassport: true, passport: student.passport })}
  <div class="doc-title">Tahfiz Progress Report</div>
  <table class="doc-table">
    <tr><td><b>NAME:</b></td><td>${escapeHtml(student.fullName)}</td><td><b>CLASS:</b></td><td>${escapeHtml(cfg.className(student.classId))}</td></tr>
    <tr><td><b>ADMISSION NO:</b></td><td>${escapeHtml(student.admissionNo)}</td><td><b>TERM/SESSION:</b></td><td>${escapeHtml((result.term || "") + " " + (result.session || ""))}</td></tr>
  </table>
  <table class="doc-table">
    <tr><th>Indicator</th><th class="center">Value / Rating</th></tr>
    <tr><td>Surahs Memorized</td><td class="center">${escapeHtml(t.surahs || "")}</td></tr>
    <tr><td>New Memorization (this term)</td><td class="center">${escapeHtml(t.newMemorization || "")}</td></tr>
    <tr><td>Revision Performance</td><td class="center">${escapeHtml(t.revision || "")}</td></tr>
    <tr><td>Tajweed</td><td class="center">${escapeHtml(t.tajweed || "")}</td></tr>
    <tr><td>Fluency</td><td class="center">${escapeHtml(t.fluency || "")}</td></tr>
    <tr><td>Accuracy</td><td class="center">${escapeHtml(t.accuracy || "")}</td></tr>
    <tr><td>Discipline</td><td class="center">${escapeHtml(t.discipline || "")}</td></tr>
    <tr><td>Juz Completed</td><td class="center">${escapeHtml(t.juzCompleted || "")}</td></tr>
    <tr><td>Current Juz</td><td class="center">${escapeHtml(t.currentJuz || "")}</td></tr>
    <tr class="totals"><td>Memorization Percentage</td><td class="center">${escapeHtml(String(t.percentage || 0))}%</td></tr>
  </table>
  <table class="doc-table">
    <tr><td><b>TEACHER'S COMMENT:</b></td><td>${escapeHtml(result.teacherComment || "")}</td></tr>
    <tr><td><b>NEXT TERM BEGINS:</b></td><td>${escapeHtml(cfg.sessions().nextTermBegins || "")}</td></tr>
  </table>
  ${approvalSignaturesHtml()}
  </section>
  `;
}

function defaultObs(type) {
  if (type === "islamiyya") return [
    { trait: "Adherence to Islamic Morals", rating: "A" }, { trait: "Attendance", rating: "A" },
    { trait: "Punctuality", rating: "B" }, { trait: "Neatness", rating: "A" }];
  return [
    { trait: "Fluency", rating: "A" }, { trait: "Adjustment to Class", rating: "B" },
    { trait: "Responsiveness", rating: "A" }, { trait: "Sense of Responsibility", rating: "A" },
    { trait: "Relationship with other pupils", rating: "B" }, { trait: "Hand Writing", rating: "A" },
    { trait: "Application to work", rating: "B" }];
}

function autoComment(avg, head = false) {
  if (avg >= 70) return head ? "Excellent result. Keep it up." : "Excellent performance. Well done.";
  if (avg >= 60) return head ? "Very good. Maintain the standard." : "Very good result. Keep working hard.";
  if (avg >= 50) return head ? "Good. Can do better." : "Good performance. Aim higher.";
  if (avg >= 45) return "Fair. More effort required.";
  return head ? "Very Poor. Keep improving." : "Very Poor performance. Keep working hard.";
}

export function idCardDoc(student) {
  const b = getBranding();
  const qr = makeQr(JSON.stringify({ sid: student.studentId, adm: student.admissionNo }), 70);
  return `
  <div class="id-card">
    <div class="id-card-header">
      ${b.logoBase64 ? `<img class="id-card-logo" src="${b.logoBase64}">` : ""}
      <div class="id-card-title">${escapeHtml(b.schoolName)}<div class="id-card-sub">${escapeHtml(b.address)}</div></div>
    </div>
    <div class="id-card-body">
      <div class="id-card-photo">${student.passport ? `<img src="${student.passport}">` : ""}</div>
      <div class="id-card-info">
        <div class="id-card-name">${escapeHtml(student.fullName)}</div>
        <div>Adm: ${escapeHtml(student.admissionNo)}</div>
        <div>ID: ${escapeHtml(student.studentId)}</div>
        <div>${escapeHtml(cfg.sectionName(student.sectionId))} / ${escapeHtml(cfg.className(student.classId))}</div>
        <div>STUDENT IDENTITY CARD</div>
      </div>
      <div class="id-card-qr">${qr}</div>
    </div>
    <div class="id-card-footer">"${escapeHtml(b.motto)}"</div>
  </div>`;
}

export function staffIdCardDoc(staff) {
  const b = getBranding();
  const qr = makeQr(JSON.stringify({ stf: staff.staffNo }), 70);
  return `
  <div class="id-card">
    <div class="id-card-header">
      ${b.logoBase64 ? `<img class="id-card-logo" src="${b.logoBase64}">` : ""}
      <div class="id-card-title">${escapeHtml(b.schoolName)}</div>
    </div>
    <div class="id-card-body">
      <div class="id-card-photo">${staff.passport ? `<img src="${staff.passport}">` : ""}</div>
      <div class="id-card-info">
        <div class="id-card-name">${escapeHtml(staff.name)}</div>
        <div>Staff No: ${escapeHtml(staff.staffNo)}</div>
        <div>${escapeHtml(staff.post || "")}</div>
        <div>${escapeHtml(staff.department || "")}</div>
        <div>STAFF IDENTITY CARD</div>
      </div>
      <div class="id-card-qr">${qr}</div>
    </div>
    <div class="id-card-footer">"${escapeHtml(b.motto)}"</div>
  </div>`;
}

// ---- Family Ledger documents ----

function familyMetaRows(family, totals) {
  return `
  <table class="doc-table">
    <tr><th colspan="2">Family / Guardian</th></tr>
    <tr><td><b>Family ID</b></td><td>${escapeHtml(family.familyId)}</td></tr>
    <tr><td><b>Parent / Guardian</b></td><td>${escapeHtml(family.parentName || "")}</td></tr>
    <tr><td><b>Phone</b></td><td>${escapeHtml(family.phone || "")}${family.altPhone ? " / " + escapeHtml(family.altPhone) : ""}</td></tr>
    <tr><td><b>Address</b></td><td>${escapeHtml(family.address || "")}</td></tr>
    <tr><td><b>No. of Children</b></td><td>${totals.children}</td></tr>
  </table>`;
}

export function familyInvoiceDoc(family, students, totals, invoice = null) {
  const qr = makeQr(JSON.stringify({ fam: family.familyId, inv: invoice?.invoiceNo || "preview", kids: totals.children, due: totals.outstanding }), 96);
  const rows = students.map((s) =>
    `<tr><td>${escapeHtml(s.fullName)}</td><td>${escapeHtml(cfg.className(s.classId))}</td>
     <td>${escapeHtml(s.invoiceNo || "")}${s.term ? " / " + escapeHtml(s.term) : ""}</td>
     <td class="right">${naira(s.charges)}</td><td class="right">${naira(s.paid)}</td><td class="right">${naira(s.balance)}</td></tr>`).join("")
    || `<tr><td colspan="6" class="muted center">No unpaid child invoices</td></tr>`;
  return `
  <section class="family-invoice-doc">
  ${headerHtml()}
  <div class="doc-title">Family Invoice</div>
  <table class="doc-table">
    <tr><td><b>Invoice No</b></td><td>${escapeHtml(invoice?.invoiceNo || "Preview Only")}</td><td><b>Date</b></td><td>${fmtDate(invoice?.createdAt || Date.now())}</td></tr>
    <tr><td><b>Status</b></td><td>${escapeHtml(invoice?.status || (totals.outstanding <= 0 ? "PAID" : "UNPAID"))}</td><td><b>Children Included</b></td><td>${totals.children}</td></tr>
  </table>
  <div class="row" style="display:flex;justify-content:space-between;gap:12px">
    <div style="flex:1">${familyMetaRows(family, totals)}</div>
    <div style="text-align:center">${qr}<div class="muted" style="font-size:10px">Scan to verify</div></div>
  </div>
  <table class="doc-table">
    <tr><th>Student</th><th>Class</th><th>Child Invoice</th><th class="right">Net Fees</th><th class="right">Paid</th><th class="right">Balance</th></tr>
    ${rows}
    <tr class="totals"><td colspan="3">Family Total</td><td class="right">${naira(totals.totalCharges)}</td><td class="right">${naira(totals.payments)}</td><td class="right">${naira(totals.outstanding)}</td></tr>
  </table>
  <table class="doc-table">
    <tr><th colspan="2">Summary</th></tr>
    <tr><td>Total Discount</td><td class="right">${naira(totals.discount)}</td></tr>
    <tr><td>Total Scholarship</td><td class="right">${naira(totals.scholarship)}</td></tr>
    <tr><td>Net Charges</td><td class="right">${naira(totals.totalCharges)}</td></tr>
    <tr><td>Total Payments</td><td class="right">${naira(totals.payments)}</td></tr>
    <tr class="totals"><td>Outstanding Balance</td><td class="right">${naira(totals.outstanding)}</td></tr>
  </table>
  <div class="note">One consolidated invoice for all children under ${escapeHtml(family.parentName || "this family")}. Payments may be allocated across children at the Accounts office.</div>
  ${invoiceFooterHtml()}
  ${approvalSignaturesHtml()}
  </section>
  `;
}

export function familyStatementDoc(family, totals, txns, rangeLabel) {
  const qr = makeQr(JSON.stringify({ fam: family.familyId, stmt: 1 }), 84);
  const rows = txns.map((t) =>
    `<tr><td>${fmtDate(t.date)}</td><td>${escapeHtml(t.student)}</td><td>${escapeHtml(t.description)}${t.ref ? " <span class='muted'>(" + escapeHtml(t.ref) + ")</span>" : ""}</td>
     <td class="right">${t.debit ? naira(t.debit) : ""}</td><td class="right">${t.credit ? naira(t.credit) : ""}</td><td class="right">${naira(t.balance)}</td></tr>`).join("")
    || `<tr><td colspan="6" class="muted center">No transactions in this period</td></tr>`;
  return `
  <section class="family-statement-doc">
  ${headerHtml()}
  <div class="doc-title">Family Statement of Account</div>
  <div class="row" style="display:flex;justify-content:space-between;gap:12px">
    <div style="flex:1">${familyMetaRows(family, totals)}</div>
    <div style="text-align:center">${qr}<div class="muted" style="font-size:10px">${escapeHtml(rangeLabel || "")}</div></div>
  </div>
  <table class="doc-table">
    <tr><th>Date</th><th>Student</th><th>Description</th><th class="right">Debit</th><th class="right">Credit</th><th class="right">Balance</th></tr>
    ${rows}
    <tr class="totals"><td colspan="3">Closing Balance</td><td class="right">${naira(totals.gross - totals.discount - totals.scholarship)}</td><td class="right">${naira(totals.payments)}</td><td class="right">${naira(totals.outstanding)}</td></tr>
  </table>
  <div class="sig-row">
    <div class="sig-box"><div class="sig-line">Bursar / Accountant</div></div>
    <div class="sig-box"><div class="sig-line">Authorised Signature / Stamp</div></div>
  </div>
  <div class="note center">Statement generated ${fmtDate(Date.now())}. This is a computer-generated document.</div>
  </section>
  `;
}


