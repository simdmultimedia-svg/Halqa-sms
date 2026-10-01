import { db } from "../core/db.js";
import { lazyListen } from "../core/adapter.js";
import { el, toast, naira, num, modal, uuid } from "../core/utils.js";
import { card, pageHead, btn, input, select, field } from "../core/ui.js";
import { voucherDoc } from "../core/documents.js";
import { printHtml, downloadPdf } from "../core/print.js";
import { nextVoucherNo } from "../core/idgen.js";
import { can } from "../core/rbac.js";
import { roundCurrency } from "../core/calculations.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function render(root, ctx) {
  lazyListen("paymentVouchers");
  if (!can(ctx.user.role, "manageSalary")) { root.appendChild(pageHead("Payment Voucher")); root.appendChild(card("Access", [el("p", { class: "muted", text: "Only Admin / Accountant can generate vouchers." })])); return; }
  root.appendChild(pageHead("Payment Voucher", "Generate a consolidated staff salary payment voucher from finalized payslips."));
  const now = new Date();
  const monthSel = select(() => MONTHS.map((m, i) => ({ value: i, label: m, selected: i === now.getMonth() })));
  const yearInp = input({ type: "number", value: String(now.getFullYear()), style: "width:110px" });
  root.appendChild(card("Build Voucher", [el("div", { class: "row" }, [field("Month", monthSel), field("Year", yearInp),
    el("div", { style: "align-self:flex-end" }, [btn("Build", { variant: "primary", onclick: () => build() })])])]));
  const host = el("div");
  root.appendChild(host);

  function build() {
    const key = `${yearInp.value}-${String(num(monthSel.value) + 1).padStart(2, "0")}`;
    const payslips = db.query("payslips", (p) => p.month === key && p.payslipNo);
    if (!payslips.length) return toast("No finalized payslips for that month. Finalize payslips in Salary first.", "error", 4500);
    const rows = payslips.map((p) => {
      const staff = db.get("staff", p.staffId) || {};
      const gross = roundCurrency(num(p.basic) + num(p.officeAllowance) + num(p.specialAllowance) + num(p.bonus));
      return { name: p.staffName, basic: num(p.basic), officeAllowance: num(p.officeAllowance), specialAllowance: num(p.specialAllowance),
        bonus: num(p.bonus), gross, paye: 0, loan: 0, lateness: num(p.latenessDeduction), absence: num(p.absenceDeduction), otherDeductions: num(p.deduction),
        net: num(p.netPay), accountNumber: staff.accountNumber || "", bank: staff.bankName || "", remarks: "",
        bonuses: p.bonuses || [], deductions: p.deductions || [] };
    });
    const voucher = { id: uuid(), month: key, monthLabel: `${MONTHS[num(monthSel.value)]}`, year: yearInp.value, section: "All", rows, total: rows.reduce((a, r) => a + r.net, 0), createdAt: Date.now() };
    const html = voucherDoc(voucher);
    const prev = el("div", { class: "doc-preview", style: "overflow:auto" });
    prev.innerHTML = `<div style="font-family:Arial">${html}</div>`;
    host.innerHTML = "";
    const c = card(`Voucher \u2014 ${voucher.monthLabel} ${voucher.year} (${rows.length} staff, ${naira(voucher.total)})`, [prev]);
    c.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [
      btn("Save & Number", { variant: "success", onclick: async () => { voucher.voucherNo = await nextVoucherNo(); db.save("vouchers", voucher); toast("Voucher saved " + voucher.voucherNo, "success"); } }),
      btn("Print", { onclick: () => printHtml(html, { title: "Voucher " + voucher.monthLabel, orientation: "landscape" }) }),
      btn("Download PDF", { variant: "primary", onclick: () => downloadPdf(html, { title: "Payment Voucher", filename: `Voucher_${key}.pdf` }) })
    ]));
    host.appendChild(c);
  }
}
