import { db } from "../core/db.js";
import { el, naira, num, sumBy, fmtDate, fmtDateTime, confirmDialog, toast, modal, escapeHtml, download } from "../core/utils.js";
import { card, pageHead, table, btn, statCard, select, field } from "../core/ui.js";
import * as cfg from "../core/config.js";
import { headerHtml } from "../core/branding.js";
import { printHtml, downloadPdf } from "../core/print.js";
import { families, familyTotals, familyStudents } from "../core/family.js";

export function render(root, ctx) {
  const isAdmin = ["Super Admin", "super_admin", "Admin", "admin"]
    .includes(ctx?.user?.role || "");

  root.appendChild(pageHead("Reports", "Financial and enrolment summaries."));

  const tabBtns = [
    btn("Financial", { variant: "primary", onclick: () => switchTab("financial") }),
    btn("Student Invoices", { onclick: () => switchTab("studentInvoices") }),
    btn("School Fees Breakdown", { onclick: () => switchTab("feesBreakdown") }),
    btn("Class Fee Monitoring", { onclick: () => switchTab("feeEligibility") }),
    btn("Enrolment", { onclick: () => switchTab("enrolment") }),
    btn("Fees by Section", { onclick: () => switchTab("feesBySection") }),
    btn("Scholarship Report", { onclick: () => switchTab("scholarshipReport") }),
    btn("Discount Report", { onclick: () => switchTab("discountReport") }),
    btn("Financial Impact", { onclick: () => switchTab("financialImpact") }),
    btn("Family Revenue", { onclick: () => switchTab("familyRevenue") }),
    btn("Family Outstanding", { onclick: () => switchTab("familyOutstanding") }),
    btn("Net Revenue", { onclick: () => switchTab("netRevenue") }),
  ];
  if (isAdmin) {
    tabBtns.push(btn("🧹 Remove Duplicates", { variant: "danger", onclick: () => switchTab("duplicates") }));
  }

  const tabs = el("div", { class: "row", style: "margin-bottom:14px;flex-wrap:wrap;gap:6px" }, tabBtns);
  root.appendChild(tabs);
  const host = el("div");
  root.appendChild(host);
  let tabCleanup = null;

  function switchTab(name) {
    if (tabCleanup) {
      try { tabCleanup(); } catch (e) { console.warn("Report cleanup failed", e); }
      tabCleanup = null;
    }
    host.innerHTML = "";
    const result = ({ financial, studentInvoices, feesBreakdown, feeEligibility, enrolment, feesBySection, scholarshipReport, discountReport, financialImpact, familyRevenue, familyOutstanding, netRevenue, duplicates }[name] || financial)();
    if (typeof result === "function") tabCleanup = result;
  }

  switchTab("financial");
  return () => { if (tabCleanup) tabCleanup(); };

  // ── Financial ──────────────────────────────────────────────────────────────
  function financial() {
    const payments = db.list("payments");
    const expenses = db.list("expenses");
    const invoices = db.list("invoices");

    const revenue = sumBy(payments, (p) => p.amount);
    const expense = sumBy(expenses, (e) => e.amount);
    const collected = sumBy(invoices, (i) => i.amountPaid);
    const outstanding = sumBy(invoices, (i) => i.balance);
    // Expected Income = sum of every invoice's full billed amount (totalAmount)
    // regardless of whether it has been paid or not.
    const expectedIncome = sumBy(invoices, (i) => i.totalAmount);

    host.innerHTML = "";
    host.appendChild(el("div", { class: "grid grid-4" }, [
      statCard("💰", naira(revenue), "Total Revenue Collected"),
      statCard("📋", naira(expectedIncome), "Total Expected Income"),
      statCard("⚠️", naira(outstanding), "Outstanding Fees"),
      statCard("📉", naira(expense), "Total Expenses"),
      statCard("💵", naira(revenue - expense), "Net Balance"),
      statCard("✅", naira(collected), "Total Collected (Invoices)"),
    ]));

    host.appendChild(card("Recent Payments", [
      table([
        { label: "Receipt", key: "receiptNo" },
        { label: "Student", key: "studentName" },
        { label: "Amount", align: "right", render: (p) => naira(p.amount) },
        { label: "Date", render: (p) => fmtDate(p.date) }
      ], payments.slice().sort((a, b) => b.date - a.date).slice(0, 15), { empty: "No payments" })
    ], btn("Print", { sm: true, onclick: () => printFinancial(revenue, expense, outstanding, expectedIncome) })));
  }

  function studentInvoices() {
    const terms = cfg.sessions().terms || ["First Term", "Second Term", "Third Term"];
    const rows = studentInvoiceRows(db.list("invoices"), terms);
    const totals = terms.map((term) => sumBy(rows, (r) => r[term]));
    const grandTotal = totals.reduce((a, v) => a + v, 0);

    host.innerHTML = "";
    host.appendChild(el("div", { class: "grid grid-4" }, [
      statCard("S", String(rows.length), "Services Billed"),
      statCard("1", naira(totals[0] || 0), terms[0] || "First Term"),
      statCard("2", naira(totals[1] || 0), terms[1] || "Second Term"),
      statCard("3", naira(totals[2] || 0), terms[2] || "Third Term")
    ]));

    host.appendChild(card("Students Invoice Reports", [
      table([
        { label: "S/N", align: "center", key: "sn" },
        { label: "Services", key: "service" },
        ...terms.map((term) => ({ label: term, align: "right", render: (r) => naira(r[term]) })),
        { label: "Total", align: "right", render: (r) => naira(terms.reduce((a, term) => a + num(r[term]), 0)) }
      ], rows, { empty: "No invoice service records found." }),
      el("div", { class: "note", style: "margin-top:12px", text: `Grand Total: ${naira(grandTotal)}` })
    ], btn("Print", { sm: true, onclick: () => printStudentInvoiceReport(rows, terms) })));
  }

  function feesBreakdown() {
    const sessions = cfg.sessions();
    const sessionSel = select(() => uniqueList([cfg.currentSession(), ...(sessions.list || [])]).map((s) => ({ value: s, label: s, selected: s === cfg.currentSession() })));
    const sectionSel = select(() => [{ value: "", label: "All Sections" }, ...cfg.sections().map((s) => ({ value: s.id, label: s.name }))]);
    const studentSel = select(() => [{ value: "", label: "All Students" }]);
    const reportHost = el("div");

    function fillStudents() {
      studentSel.innerHTML = "";
      studentSel.appendChild(el("option", { value: "", text: "All Students" }));
      db.list("students")
        .filter((s) => !sectionSel.value || cfg.studentInSection(s, sectionSel.value))
        .filter((s) => !["graduated", "withdrawn"].includes(String(s.status || "").toLowerCase()))
        .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""))
        .forEach((s) => studentSel.appendChild(el("option", { value: s.id, text: `${s.fullName} (${s.admissionNo || ""})` })));
    }

    function draw() {
      const data = schoolFeesBreakdownData({ session: sessionSel.value, sectionId: sectionSel.value, studentId: studentSel.value });
      reportHost.innerHTML = "";
      reportHost.appendChild(card("School Fees Breakdown", [
        table([
          { label: "S/N", align: "center", key: "sn" },
          { label: "Items", key: "item" },
          { label: "1st Term", align: "right", render: (r) => naira(r["First Term"]) },
          { label: "2nd Term", align: "right", render: (r) => naira(r["Second Term"]) },
          { label: "3rd Term", align: "right", render: (r) => naira(r["Third Term"]) },
          { label: "Total", align: "right", render: (r) => naira(r.total) }
        ], data.rows, { empty: "No fee breakdown records found." })
      ]));
    }

    sectionSel.onchange = () => { fillStudents(); draw(); };
    [sessionSel, studentSel].forEach((s) => s.onchange = draw);
    fillStudents();
    host.appendChild(card("School Fees Breakdown Report", [
      el("div", { class: "form-grid" }, [
        field("Academic Session", sessionSel),
        field("Section", sectionSel),
        field("Student", studentSel)
      ]),
      el("div", { class: "row", style: "margin:10px 0 16px;gap:8px;flex-wrap:wrap" }, [
        btn("Print", { variant: "primary", onclick: () => printHtml(schoolFeesBreakdownHtml(schoolFeesBreakdownData({ session: sessionSel.value, sectionId: sectionSel.value, studentId: studentSel.value })), { title: "School Fees Breakdown" }) }),
        btn("PDF Export", { onclick: () => downloadPdf(schoolFeesBreakdownHtml(schoolFeesBreakdownData({ session: sessionSel.value, sectionId: sectionSel.value, studentId: studentSel.value })), { title: "School Fees Breakdown", filename: "School_Fees_Breakdown.pdf" }) }),
        btn("Excel Export", { onclick: () => exportSchoolFeesBreakdownExcel(schoolFeesBreakdownData({ session: sessionSel.value, sectionId: sectionSel.value, studentId: studentSel.value })) })
      ]),
      reportHost
    ]));
    draw();
    const offs = ["students", "invoices", "settings"].map((collection) => db.on(collection, () => { fillStudents(); draw(); }));
    return () => offs.forEach((off) => { if (typeof off === "function") off(); });
  }

  function feeEligibility() {
    const sessions = cfg.sessions();
    const terms = sessions.terms || ["First Term", "Second Term", "Third Term"];
    const sessionOptions = uniqueList([cfg.currentSession(), ...(sessions.list || [])]).filter(Boolean);
    const state = {
      session: cfg.currentSession(),
      term: cfg.currentTerm(),
      sectionId: "",
      classId: "",
      examStatus: ""
    };

    const sessionSel = select(() => sessionOptions.map((s) => ({ value: s, label: s, selected: s === state.session })));
    const termSel = select(() => terms.map((t) => ({ value: t, label: t, selected: t === state.term })));
    const sectionSel = select(() => [{ value: "", label: "All Sections" }, ...cfg.sections().map((s) => ({ value: s.id, label: s.name }))]);
    const classSel = select(() => [{ value: "", label: "All Classes" }]);
    const statusSel = select(() => [
      { value: "", label: "All Statuses" },
      { value: "ELIGIBLE", label: "ELIGIBLE" },
      { value: "MANAGEABLE", label: "MANAGEABLE" },
      { value: "INACTIVE", label: "INACTIVE" },
      { value: "OTHER", label: "OTHER" }
    ]);
    const reportHost = el("div");

    function fillClasses() {
      classSel.innerHTML = "";
      classSel.appendChild(el("option", { value: "", text: "All Classes" }));
      cfg.classes(sectionSel.value).forEach((c) => classSel.appendChild(el("option", { value: c.id, text: c.name })));
      if (state.classId && [...classSel.options].some((o) => o.value === state.classId)) classSel.value = state.classId;
      else state.classId = "";
    }

    function syncState() {
      state.session = sessionSel.value;
      state.term = termSel.value;
      state.sectionId = sectionSel.value;
      state.classId = classSel.value;
      state.examStatus = statusSel.value;
    }

    function draw() {
      syncState();
      const data = feeEligibilityData(state);
      reportHost.innerHTML = "";
      reportHost.appendChild(el("div", { class: "grid grid-4" }, [
        statCard("S", String(data.rows.length), "Students Monitored"),
        statCard("E", naira(data.totals.expected), "Expected Fees"),
        statCard("P", naira(data.totals.payments), "Payments Made"),
        statCard("O", naira(data.totals.outstanding), "Outstanding Balance"),
        statCard("D", naira(data.totals.discounts), "Discounts"),
        statCard("G", naira(data.totals.scholarships), "Scholarships"),
        statCard("A", String(data.rows.filter((r) => r.active).length), "Active Students"),
        statCard("OK", String(data.rows.filter((r) => r.examStatus === "ELIGIBLE").length), "Exam Eligible")
      ]));

      if (!data.groups.length) {
        reportHost.appendChild(card("Class Fee Monitoring & Examination Eligibility", [
          el("p", { class: "muted", text: "No students or invoices found for the selected filters." })
        ]));
        return;
      }

      data.groups.forEach((group) => {
        reportHost.appendChild(card(`${group.className} / ${group.sectionName}`, [
          table(feeEligibilityColumns(), group.rows, { empty: "No students found." })
        ]));
      });
    }

    [sessionSel, termSel, classSel, statusSel].forEach((node) => { node.onchange = draw; });
    sectionSel.onchange = () => { state.sectionId = sectionSel.value; state.classId = ""; fillClasses(); draw(); };
    fillClasses();

    host.appendChild(card("Class Fee Monitoring & Examination Eligibility Report", [
      el("div", { class: "form-grid" }, [
        field("Session", sessionSel),
        field("Term", termSel),
        field("Section", sectionSel),
        field("Class", classSel),
        field("Fee Status", statusSel)
      ]),
      el("div", { class: "row", style: "margin:10px 0 16px;gap:8px;flex-wrap:wrap" }, [
        btn("Print", { variant: "primary", onclick: () => printHtml(feeEligibilityReportHtml(feeEligibilityData(state), state), { title: "Class Fee Monitoring & Examination Eligibility", orientation: "landscape" }) }),
        btn("PDF Export", { onclick: () => downloadPdf(feeEligibilityReportHtml(feeEligibilityData(state), state), { title: "Class Fee Monitoring & Examination Eligibility", filename: "Class_Fee_Monitoring_Eligibility.pdf" }) }),
        btn("Excel Export", { onclick: () => exportFeeEligibilityExcel(feeEligibilityData(state), state) })
      ]),
      reportHost
    ]));
    draw();

    const offs = ["students", "invoices", "payments", "receipts", "settings"].map((collection) => db.on(collection, draw));
    return () => offs.forEach((off) => { if (typeof off === "function") off(); });
  }

  // ── Enrolment ──────────────────────────────────────────────────────────────
  function enrolment() {
    const students = db.query("students", (s) => s.status !== "graduated");
    const bySec = cfg.sections().map((s) => ({
      section: s.name,
      count: students.filter((x) => cfg.studentInSection(x, s.id)).length
    }));
    const byCls = cfg.classes().map((k) => ({
      k: cfg.sectionName(k.sectionId) + " / " + k.name,
      count: students.filter((x) => cfg.studentInClass(x, k.id)).length
    })).filter((r) => r.count > 0);
    host.innerHTML = "";
    host.appendChild(card("Enrolment by Section", [
      table([
        { label: "Section", key: "section" },
        { label: "Students", align: "right", key: "count" }
      ], bySec)
    ]));
    host.appendChild(card("Enrolment by Class", [
      table([
        { label: "Class", key: "k" },
        { label: "Students", align: "right", key: "count" }
      ], byCls)
    ]));
  }

  // ── Fees by Section ────────────────────────────────────────────────────────
  function feesBySection() {
    const invoices = db.list("invoices");
    const rows = cfg.sections().map((s) => {
      const inv = invoices.filter((i) => i.sectionId === s.id);
      return {
        section: s.name,
        expected: sumBy(inv, (i) => i.totalAmount),
        paid: sumBy(inv, (i) => i.amountPaid),
        bal: sumBy(inv, (i) => i.balance)
      };
    });
    const totExpected = sumBy(rows, (r) => r.expected);
    const totPaid = sumBy(rows, (r) => r.paid);
    const totBal = sumBy(rows, (r) => r.bal);
    host.innerHTML = "";
    host.appendChild(el("div", { class: "grid grid-3" }, [
      statCard("📋", naira(totExpected), "Total Expected Income"),
      statCard("✅", naira(totPaid), "Total Collected"),
      statCard("⚠️", naira(totBal), "Total Outstanding"),
    ]));
    host.appendChild(card("Fee Collection by Section", [
      table([
        { label: "Section", key: "section" },
        { label: "Expected Income", align: "right", render: (r) => naira(r.expected) },
        { label: "Collected", align: "right", render: (r) => naira(r.paid) },
        { label: "Outstanding", align: "right", render: (r) => naira(r.bal) }
      ], rows)
    ]));
  }

  // ── Scholarship Report ─────────────────────────────────────────────────────
  function scholarshipReport() {
    const allSch = db.list("studentScholarships").filter((a) => a.status === "Active");
    const rows = allSch.map((a) => {
      const student = db.get("students", a.studentId);
      const invs = db.query("invoices", (i) => i.studentId === a.studentId);
      const totalApplied = invs.reduce((s, i) => s + num(i.scholarship), 0);
      return {
        student: student?.fullName || a.studentId, admNo: student?.admissionNo || "—",
        scholarship: a.scholarshipName, type: a.scholarshipType,
        value: a.valueType === "percent" ? `${a.value}%` : naira(a.value),
        session: a.effectiveSession, term: a.effectiveTerm,
        totalApplied, approvedBy: a.approvedBy
      };
    });
    host.innerHTML = "";
    host.appendChild(card("Scholarship Report — Active Assignments", [
      table([
        { label: "Student", key: "student" },
        { label: "Adm No", key: "admNo" },
        { label: "Scholarship", key: "scholarship" },
        { label: "Type", key: "type" },
        { label: "Award Value", key: "value" },
        { label: "Total Applied", align: "right", render: (r) => naira(r.totalApplied) },
        { label: "Session", key: "session" },
        { label: "Term", key: "term" },
        { label: "Approved By", key: "approvedBy" }
      ], rows, { empty: "No active scholarship assignments." })
    ]));
  }

  // ── Discount Report ────────────────────────────────────────────────────────
  function discountReport() {
    const allDisc = db.list("studentDiscounts").filter((a) => a.status === "Active");
    const rows = allDisc.map((a) => {
      const student = db.get("students", a.studentId);
      const invs = db.query("invoices", (i) => i.studentId === a.studentId);
      const totalApplied = invs.reduce((s, i) => s + num(i.discount), 0);
      return {
        student: student?.fullName || a.studentId, admNo: student?.admissionNo || "—",
        discount: a.discountName, type: a.discountType,
        value: a.valueType === "percent" ? `${a.value}%` : naira(a.value),
        session: a.effectiveSession, term: a.effectiveTerm, totalApplied
      };
    });
    host.innerHTML = "";
    host.appendChild(card("Discount Report — Active Assignments", [
      table([
        { label: "Student", key: "student" },
        { label: "Adm No", key: "admNo" },
        { label: "Discount", key: "discount" },
        { label: "Type", key: "type" },
        { label: "Award Value", key: "value" },
        { label: "Total Applied", align: "right", render: (r) => naira(r.totalApplied) },
        { label: "Session", key: "session" },
        { label: "Term", key: "term" }
      ], rows, { empty: "No active discount assignments." })
    ]));
  }

  // ── Financial Impact ───────────────────────────────────────────────────────
  function financialImpact() {
    const invoices = db.list("invoices");
    const grossBilled = invoices.reduce((a, i) =>
      a + (num(i.grossAmount) || (i.services || []).reduce((b, s) => b + num(s.amount), 0)), 0);
    const totalScholarships = invoices.reduce((a, i) => a + num(i.scholarship), 0);
    const totalDiscounts = invoices.reduce((a, i) => a + num(i.discount), 0);
    const netBilled = invoices.reduce((a, i) => a + num(i.totalAmount), 0);
    const totalRevenue = db.list("payments").reduce((a, p) => a + num(p.amount), 0);
    const outstanding = invoices.reduce((a, i) => a + num(i.balance), 0);
    const revenueReduction = totalScholarships + totalDiscounts;
    const reductionPct = grossBilled > 0
      ? ((revenueReduction / grossBilled) * 100).toFixed(1) : "0.0";

    host.innerHTML = "";
    host.appendChild(el("div", { class: "grid grid-4" }, [
      statCard("📋", naira(grossBilled), "Gross Billed"),
      statCard("📋", naira(netBilled), "Total Expected Income"),
      statCard("🎓", naira(totalScholarships), "Scholarships Granted"),
      statCard("🏷️", naira(totalDiscounts), "Discounts Granted"),
      statCard("📉", naira(revenueReduction), `Revenue Reduction (${reductionPct}%)`),
      statCard("💰", naira(totalRevenue), "Revenue Collected"),
      statCard("⚠️", naira(outstanding), "Outstanding"),
    ]));

    const schTypes = {};
    db.list("studentScholarships").filter((a) => a.status === "Active").forEach((a) => {
      if (!schTypes[a.scholarshipType])
        schTypes[a.scholarshipType] = { type: a.scholarshipType, count: 0 };
      schTypes[a.scholarshipType].count++;
    });
    const schTypeRows = Object.values(schTypes);
    if (schTypeRows.length) {
      host.appendChild(card("Scholarship Distribution by Type", [
        table([
          { label: "Type", key: "type" },
          { label: "Students", align: "right", key: "count" }
        ], schTypeRows)
      ]));
    }
  }

  // ── Duplicate Remover (Admin only) ─────────────────────────────────────────
  function familyRevenue() {
    const rows = families().map((f) => {
      const t = familyTotals(f);
      return {
        familyId: f.familyId,
        parent: f.parentName || "",
        phone: f.phone || "",
        children: t.children,
        gross: t.gross,
        scholarship: t.scholarship,
        discount: t.discount,
        net: t.totalCharges,
        paid: t.payments,
        outstanding: t.outstanding
      };
    });
    host.innerHTML = "";
    host.appendChild(el("div", { class: "grid grid-4" }, [
      statCard("F", String(rows.length), "Families"),
      statCard("G", naira(sumBy(rows, r => r.gross)), "Gross Family Fees"),
      statCard("N", naira(sumBy(rows, r => r.net)), "Net Family Fees"),
      statCard("P", naira(sumBy(rows, r => r.paid)), "Family Payments")
    ]));
    host.appendChild(card("Family Revenue Report", [table([
      { label: "Family ID", key: "familyId" },
      { label: "Parent", key: "parent" },
      { label: "Phone", key: "phone" },
      { label: "Children", align: "center", key: "children" },
      { label: "Gross", align: "right", render: r => naira(r.gross) },
      { label: "Scholarship", align: "right", render: r => naira(r.scholarship) },
      { label: "Discount", align: "right", render: r => naira(r.discount) },
      { label: "Net", align: "right", render: r => naira(r.net) },
      { label: "Paid", align: "right", render: r => naira(r.paid) },
      { label: "Outstanding", align: "right", render: r => naira(r.outstanding) }
    ], rows, { empty: "No family revenue records." })]));
  }

  function familyOutstanding() {
    const rows = families().map((f) => {
      const t = familyTotals(f);
      return { familyId: f.familyId, parent: f.parentName || "", phone: f.phone || "", children: familyStudents(f).map(s => s.fullName).join(", "), outstanding: t.outstanding };
    }).filter(r => r.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding);
    host.innerHTML = "";
    host.appendChild(el("div", { class: "grid grid-3" }, [
      statCard("F", String(rows.length), "Outstanding Families"),
      statCard("O", naira(sumBy(rows, r => r.outstanding)), "Total Family Outstanding"),
      statCard("A", naira(rows.length ? sumBy(rows, r => r.outstanding) / rows.length : 0), "Average Outstanding")
    ]));
    host.appendChild(card("Family Outstanding Report", [table([
      { label: "Family ID", key: "familyId" },
      { label: "Parent", key: "parent" },
      { label: "Phone", key: "phone" },
      { label: "Children", key: "children" },
      { label: "Outstanding", align: "right", render: r => naira(r.outstanding) }
    ], rows, { empty: "No outstanding family balances." })]));
  }

  function netRevenue() {
    const invoices = db.list("invoices");
    const grossExpected = invoices.reduce((a, i) => a + (num(i.grossAmount) || (i.services || []).reduce((b, s) => b + num(s.amount), 0)), 0);
    const scholarshipValue = invoices.reduce((a, i) => a + num(i.scholarship), 0);
    const discountValue = invoices.reduce((a, i) => a + num(i.discount), 0);
    const netExpected = invoices.reduce((a, i) => a + num(i.totalAmount), 0);
    const collected = invoices.reduce((a, i) => a + num(i.amountPaid), 0);
    const outstanding = invoices.reduce((a, i) => a + num(i.balance), 0);
    host.innerHTML = "";
    host.appendChild(el("div", { class: "grid grid-4" }, [
      statCard("G", naira(grossExpected), "Gross Expected Revenue"),
      statCard("S", naira(scholarshipValue), "Scholarship Value"),
      statCard("D", naira(discountValue), "Discount Value"),
      statCard("N", naira(netExpected), "Net Expected Revenue"),
      statCard("P", naira(collected), "Collected"),
      statCard("O", naira(outstanding), "Outstanding")
    ]));
    host.appendChild(card("Net Revenue Report", [table([
      { label: "Metric", key: "metric" },
      { label: "Amount", align: "right", render: r => naira(r.amount) }
    ], [
      { metric: "Gross Expected Revenue", amount: grossExpected },
      { metric: "Scholarships", amount: scholarshipValue },
      { metric: "Discounts", amount: discountValue },
      { metric: "Net Expected Revenue", amount: netExpected },
      { metric: "Collected", amount: collected },
      { metric: "Outstanding", amount: outstanding }
    ])]));
  }

  function duplicates() {
    host.innerHTML = "";
    host.appendChild(pageHead("Remove Duplicates", "Find and remove duplicate records. A duplicate shares the same key field as another record. The OLDEST record is kept; newer copies are removed.", []));

    // ── Duplicate Students (same admissionNo) ─────────────────────────────
    const students = db.list("students");
    const dupStudents = findDuplicates(students, (s) => (s.admissionNo || "").trim().toLowerCase());
    const studentRows = dupStudents.map((group) => ({
      key: group[0].admissionNo,
      count: group.length,
      names: group.map((s) => s.fullName).join(" / "),
      keepId: group[0].id, // oldest by createdAt (already sorted)
      ids: group.map((s) => s.id)
    }));

    const sCard = card("Duplicate Students (same Admission No)");
    if (!studentRows.length) {
      sCard.appendChild(el("p", { class: "muted", text: "✅ No duplicate students found." }));
    } else {
      sCard.appendChild(el("p", {
        style: "color:var(--danger);font-weight:700;margin-bottom:8px",
        text: `${studentRows.length} duplicate group(s) found — ${dupStudents.reduce((a, g) => a + g.length - 1, 0)} extra record(s) to remove.`
      }));
      sCard.appendChild(table([
        { label: "Adm No", key: "key" },
        { label: "Duplicates", align: "right", key: "count" },
        { label: "Names", key: "names" },
        {
          label: "", render: (r) => el("div", { class: "row" }, [
            btn("Remove Extras", {
              sm: true, variant: "danger", onclick: async () => {
                if (!await confirmDialog(
                  `Remove ${r.count - 1} duplicate(s) for Adm No ${r.key}? The first record will be kept.`,
                  { danger: true, okText: "Remove" })) return;
                const toDelete = r.ids.filter((id) => id !== r.keepId);
                toDelete.forEach((id) => db.delete("students", id));
                toast(`Removed ${toDelete.length} duplicate student(s)`, "success");
                switchTab("duplicates");
              }
            }),
          ])
        }
      ], studentRows, { empty: "No duplicates." }));
      sCard.appendChild(btn("Remove ALL Duplicate Students", {
        variant: "danger", style: "margin-top:10px", onclick: async () => {
          const total = dupStudents.reduce((a, g) => a + g.length - 1, 0);
          if (!await confirmDialog(`Remove all ${total} duplicate student record(s)? One record per Admission No will be kept.`, { danger: true, okText: "Remove All" })) return;
          let removed = 0;
          dupStudents.forEach((group) => {
            const keep = group[0].id;
            group.slice(1).forEach((s) => { db.delete("students", s.id); removed++; });
          });
          toast(`Removed ${removed} duplicate student record(s)`, "success");
          switchTab("duplicates");
        }
      }));
    }
    host.appendChild(sCard);

    const semanticDupInvoices = invoiceDuplicateGroups(db.list("invoices"));
    const semanticRows = semanticDupInvoices.map((group) => ({
      key: `${group[0].studentName || group[0].studentId} / ${group[0].session} / ${group[0].term} / ${group[0].type}`,
      count: group.length,
      keepId: group[0].id,
      ids: group.map((i) => i.id),
      group
    }));
    const semanticCard = card("Duplicate Invoices (Student + Session + Term + Type)");
    if (!semanticRows.length) {
      semanticCard.appendChild(el("p", { class: "muted", text: "No duplicate invoice groups found." }));
    } else {
      semanticCard.appendChild(table([
        { label: "Duplicate Key", key: "key" },
        { label: "Count", align: "right", key: "count" },
        { label: "Invoices", render: (r) => r.group.map((i) => i.invoiceNo).join(", ") },
        {
          label: "", render: (r) => el("div", { class: "row", style: "gap:4px" }, [
            btn("Merge", {
              sm: true, onclick: async () => {
                if (!await confirmDialog(`Merge ${r.count} duplicate invoices? The oldest invoice will remain.`, { okText: "Merge" })) return;
                mergeDuplicateInvoices(r.group);
                toast("Duplicate invoice group merged", "success");
                switchTab("duplicates");
              }
            }),
            btn("Delete Extras", {
              sm: true, variant: "danger", onclick: async () => {
                if (!await confirmDialog(`Delete ${r.count - 1} duplicate invoice(s)?`, { danger: true, okText: "Delete Extras" })) return;
                r.ids.filter((id) => id !== r.keepId).forEach((id) => db.delete("invoices", id));
                db.save("auditLogs", { id: "audit-" + Date.now() + "-" + r.keepId, type: "duplicate_invoice_delete", at: Date.now(), message: `Deleted duplicate invoices for ${r.key}`, invoiceIds: r.ids });
                toast("Duplicate invoice extras deleted", "success");
                switchTab("duplicates");
              }
            })
          ])
        }
      ], semanticRows));
    }
    host.appendChild(semanticCard);

    // ── Duplicate Invoices (same invoiceNo) ───────────────────────────────
    const invoices = db.list("invoices");
    const dupInvoices = findDuplicates(invoices, (i) => (i.invoiceNo || "").trim().toLowerCase());
    const invRows = dupInvoices.map((group) => ({
      key: group[0].invoiceNo,
      count: group.length,
      student: group[0].studentName || "—",
      keepId: group[0].id,
      ids: group.map((i) => i.id)
    }));

    const iCard = card("Duplicate Invoices (same Invoice No)");
    if (!invRows.length) {
      iCard.appendChild(el("p", { class: "muted", text: "✅ No duplicate invoices found." }));
    } else {
      iCard.appendChild(el("p", {
        style: "color:var(--danger);font-weight:700;margin-bottom:8px",
        text: `${invRows.length} duplicate group(s) found — ${dupInvoices.reduce((a, g) => a + g.length - 1, 0)} extra record(s) to remove.`
      }));
      iCard.appendChild(table([
        { label: "Invoice No", key: "key" },
        { label: "Duplicates", align: "right", key: "count" },
        { label: "Student", key: "student" },
        {
          label: "", render: (r) => btn("Remove Extras", {
            sm: true, variant: "danger", onclick: async () => {
              if (!await confirmDialog(`Remove ${r.count - 1} duplicate invoice(s) for ${r.key}?`, { danger: true, okText: "Remove" })) return;
              r.ids.filter((id) => id !== r.keepId).forEach((id) => db.delete("invoices", id));
              toast("Duplicate invoices removed", "success");
              switchTab("duplicates");
            }
          })
        }
      ], invRows, { empty: "No duplicates." }));
      iCard.appendChild(btn("Remove ALL Duplicate Invoices", {
        variant: "danger", style: "margin-top:10px", onclick: async () => {
          const total = dupInvoices.reduce((a, g) => a + g.length - 1, 0);
          if (!await confirmDialog(`Remove all ${total} duplicate invoice(s)?`, { danger: true, okText: "Remove All" })) return;
          let removed = 0;
          dupInvoices.forEach((group) => { group.slice(1).forEach((i) => { db.delete("invoices", i.id); removed++; }); });
          toast(`Removed ${removed} duplicate invoice(s)`, "success");
          switchTab("duplicates");
        }
      }));
    }
    host.appendChild(iCard);

    // ── Duplicate Receipts (same receiptNo) ───────────────────────────────
    const receipts = db.list("receipts");
    const dupReceipts = findDuplicates(receipts, (r) => (r.receiptNo || "").trim().toLowerCase());
    const recRows = dupReceipts.map((group) => ({
      key: group[0].receiptNo,
      count: group.length,
      student: group[0].studentName || "—",
      amount: group[0].amount,
      keepId: group[0].id,
      ids: group.map((r) => r.id)
    }));

    const rCard = card("Duplicate Receipts (same Receipt No)");
    if (!recRows.length) {
      rCard.appendChild(el("p", { class: "muted", text: "✅ No duplicate receipts found." }));
    } else {
      rCard.appendChild(el("p", {
        style: "color:var(--danger);font-weight:700;margin-bottom:8px",
        text: `${recRows.length} duplicate group(s) found — ${dupReceipts.reduce((a, g) => a + g.length - 1, 0)} extra record(s) to remove.`
      }));
      rCard.appendChild(table([
        { label: "Receipt No", key: "key" },
        { label: "Duplicates", align: "right", key: "count" },
        { label: "Student", key: "student" },
        { label: "Amount", align: "right", render: (r) => naira(r.amount) },
        {
          label: "", render: (r) => btn("Remove Extras", {
            sm: true, variant: "danger", onclick: async () => {
              if (!await confirmDialog(`Remove ${r.count - 1} duplicate receipt(s) for ${r.key}?`, { danger: true, okText: "Remove" })) return;
              r.ids.filter((id) => id !== r.keepId).forEach((id) => db.delete("receipts", id));
              toast("Duplicate receipts removed", "success");
              switchTab("duplicates");
            }
          })
        }
      ], recRows, { empty: "No duplicates." }));
      rCard.appendChild(btn("Remove ALL Duplicate Receipts", {
        variant: "danger", style: "margin-top:10px", onclick: async () => {
          const total = dupReceipts.reduce((a, g) => a + g.length - 1, 0);
          if (!await confirmDialog(`Remove all ${total} duplicate receipt(s)?`, { danger: true, okText: "Remove All" })) return;
          let removed = 0;
          dupReceipts.forEach((group) => { group.slice(1).forEach((r) => { db.delete("receipts", r.id); removed++; }); });
          toast(`Removed ${removed} duplicate receipt(s)`, "success");
          switchTab("duplicates");
        }
      }));
    }
    host.appendChild(rCard);

    // ── Duplicate Payments (same receiptNo) ───────────────────────────────
    const payments = db.list("payments");
    const dupPayments = findDuplicates(payments, (p) => (p.receiptNo || "").trim().toLowerCase());
    const payRows = dupPayments.map((group) => ({
      key: group[0].receiptNo,
      count: group.length,
      student: group[0].studentName || "—",
      amount: group[0].amount,
      keepId: group[0].id,
      ids: group.map((p) => p.id)
    }));

    const pCard = card("Duplicate Payments (same Receipt No)");
    if (!payRows.length) {
      pCard.appendChild(el("p", { class: "muted", text: "✅ No duplicate payments found." }));
    } else {
      pCard.appendChild(el("p", {
        style: "color:var(--danger);font-weight:700;margin-bottom:8px",
        text: `${payRows.length} duplicate group(s) found.`
      }));
      pCard.appendChild(table([
        { label: "Receipt No", key: "key" },
        { label: "Duplicates", align: "right", key: "count" },
        { label: "Student", key: "student" },
        { label: "Amount", align: "right", render: (r) => naira(r.amount) },
        {
          label: "", render: (r) => btn("Remove Extras", {
            sm: true, variant: "danger", onclick: async () => {
              if (!await confirmDialog(`Remove ${r.count - 1} duplicate payment(s) for ${r.key}?`, { danger: true, okText: "Remove" })) return;
              r.ids.filter((id) => id !== r.keepId).forEach((id) => db.delete("payments", id));
              toast("Duplicate payments removed", "success");
              switchTab("duplicates");
            }
          })
        }
      ], payRows, { empty: "No duplicates." }));
    }
    host.appendChild(pCard);
  }

  // ── Print helpers ──────────────────────────────────────────────────────────
  function printFinancial(rev, exp, out, expected) {
    const body = `<section class="financial-report-doc">${headerHtml()}
      <div class="doc-title">Financial Summary</div>
      <table class="doc-table">
        <tr><td>Total Expected Income</td><td class="right">${naira(expected)}</td></tr>
        <tr><td>Total Revenue Collected</td><td class="right">${naira(rev)}</td></tr>
        <tr><td>Outstanding Fees</td><td class="right">${naira(out)}</td></tr>
        <tr><td>Total Expenses</td><td class="right">${naira(exp)}</td></tr>
        <tr class="totals"><td>Net Balance</td><td class="right">${naira(rev - exp)}</td></tr>
      </table>
      <p class="muted">Generated ${new Date().toLocaleString()}</p></section>`;
    printHtml(body, { title: "Financial Summary" });
  }

  function printStudentInvoiceReport(rows, terms) {
    const termCols = terms.slice(0, 3);
    const printableRows = rows.length >= 6
      ? rows
      : rows.concat(Array.from({ length: 6 - rows.length }, () => ({ service: "" })));
    const bodyRows = printableRows.map((r, i) => `
      <tr>
        <td class="center">${i + 1}.</td>
        <td>${escapeHtml(r.service || "")}</td>
        ${termCols.map((term) => `<td class="right">${r.service ? naira(r[term]) : ""}</td>`).join("")}
      </tr>`).join("");
    const totals = termCols.map((term) => sumBy(rows, (r) => r[term]));
    const body = `<section class="student-invoice-report-doc">${headerHtml()}
      <div class="doc-title">Students Invoice Reports</div>
      <table class="doc-table">
        <tr>
          <th style="width:50px">S/N</th>
          <th>SERVICES</th>
          ${termCols.map((term) => `<th class="right">${escapeHtml(term.toUpperCase())}</th>`).join("")}
        </tr>
        ${bodyRows}
        <tr class="totals">
          <td></td>
          <td>TOTAL</td>
          ${totals.map((total) => `<td class="right">${naira(total)}</td>`).join("")}
        </tr>
      </table>
      <div style="margin-top:28px;font-weight:700">Schools Account details...</div>
      <div style="height:48px;border-bottom:1px solid #999;margin-top:8px"></div>
      <p class="muted">Generated ${new Date().toLocaleString()}</p></section>`;
    printHtml(body, { title: "Students Invoice Reports", orientation: "landscape" });
  }
}

// ── Utility: find groups of records that share the same key value ────────────
// Groups are sorted oldest-first (by createdAt). The first item in each group
// is the one to KEEP; the rest are extras to delete.
function findDuplicates(records, keyFn) {
  const groups = {};
  records.forEach((rec) => {
    const k = keyFn(rec);
    if (!k) return; // skip records with no key value
    if (!groups[k]) groups[k] = [];
    groups[k].push(rec);
  });
  return Object.values(groups)
    .filter((g) => g.length > 1)
    .map((g) => g.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
}

function invoiceDuplicateGroups(invoices) {
  const groups = {};
  invoices.forEach((inv) => {
    const key = [inv.studentId, inv.session, inv.term, inv.type].map((v) => String(v || "").trim().toLowerCase()).join("|");
    if (!key.replace(/\|/g, "")) return;
    (groups[key] ||= []).push(inv);
  });
  return Object.values(groups)
    .filter((group) => group.length > 1)
    .map((group) => group.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
}

function mergeDuplicateInvoices(group) {
  const [keep, ...extras] = group.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const payments = [...(keep.payments || [])];
  extras.forEach((inv) => (inv.payments || []).forEach((p) => payments.push(p)));
  const mergedPaid = payments.reduce((a, p) => a + num(p.amount), 0) || Math.max(...group.map((i) => num(i.amountPaid)));
  const merged = {
    ...keep,
    services: keep.services || [],
    payments,
    amountPaid: mergedPaid,
    balance: Math.max(0, num(keep.totalAmount) - mergedPaid),
    status: mergedPaid <= 0 ? "UNPAID" : mergedPaid >= num(keep.totalAmount) ? "PAID" : "PARTIALLY PAID",
    duplicateHistory: [
      ...(keep.duplicateHistory || []),
      ...extras.map((inv) => ({ invoiceId: inv.id, invoiceNo: inv.invoiceNo, mergedAt: Date.now(), amountPaid: inv.amountPaid, balance: inv.balance }))
    ]
  };
  db.save("invoices", merged);
  extras.forEach((inv) => db.delete("invoices", inv.id));
  db.save("auditLogs", {
    id: "audit-" + Date.now() + "-" + keep.id,
    type: "duplicate_invoice_merge",
    at: Date.now(),
    message: `Merged duplicate invoices into ${keep.invoiceNo}`,
    invoiceIds: group.map((i) => i.id)
  });
}

function studentInvoiceRows(invoices, terms) {
  const byService = {};
  (invoices || []).forEach((inv) => {
    const term = terms.includes(inv.term) ? inv.term : inv.term || terms[0];
    (inv.services || []).forEach((svc) => {
      const name = (svc.name || "Other Service").trim();
      const key = name.toLowerCase();
      if (!byService[key]) byService[key] = { service: name };
      byService[key][term] = num(byService[key][term]) + num(svc.amount);
    });
  });
  return Object.values(byService)
    .map((r) => {
      terms.forEach((term) => { r[term] = num(r[term]); });
      return r;
    })
    .sort((a, b) => a.service.localeCompare(b.service))
    .map((r, i) => ({ sn: i + 1, ...r }));
}

function uniqueList(values) {
  return [...new Set((values || []).filter((v) => v != null && String(v).trim()).map((v) => String(v).trim()))];
}

function schoolFeesBreakdownData(filters = {}) {
  const terms = ["First Term", "Second Term", "Third Term"];
  const categories = ["Tuition", "Registration", "Books", "Uniform", "Sports Wear", "Services", "Other Charges"];
  const rowsByItem = Object.fromEntries(categories.map((name) => [name, { item: name, total: 0, "First Term": 0, "Second Term": 0, "Third Term": 0 }]));
  const invoices = db.list("invoices").filter((inv) =>
    (!filters.session || inv.session === filters.session) &&
    (!filters.sectionId || inv.sectionId === filters.sectionId) &&
    (!filters.studentId || inv.studentId === filters.studentId));
  invoices.forEach((inv) => {
    const term = terms.includes(inv.term) ? inv.term : "First Term";
    (inv.services || []).forEach((svc) => {
      const item = feeBreakdownCategory(svc);
      const amount = num(svc.amount);
      rowsByItem[item][term] += amount;
      rowsByItem[item].total += amount;
    });
  });
  const rows = Object.values(rowsByItem).map((r, i) => ({ sn: i + 1, ...r }));
  const student = filters.studentId ? db.get("students", filters.studentId) : null;
  return {
    rows,
    filters,
    session: filters.session || cfg.currentSession(),
    sectionName: filters.sectionId ? cfg.sectionName(filters.sectionId) : "All Sections",
    studentName: student?.fullName || "All Students",
    totals: {
      "First Term": sumBy(rows, (r) => r["First Term"]),
      "Second Term": sumBy(rows, (r) => r["Second Term"]),
      "Third Term": sumBy(rows, (r) => r["Third Term"]),
      total: sumBy(rows, (r) => r.total)
    }
  };
}

function feeBreakdownCategory(svc) {
  const name = String(svc?.name || "").toLowerCase();
  if (name.includes("tuition")) return "Tuition";
  if (name.includes("registration")) return "Registration";
  if (name.includes("book")) return "Books";
  if (name.includes("sport")) return "Sports Wear";
  if (name.includes("uniform")) return "Uniform";
  if (name.includes("service")) return "Services";
  return "Other Charges";
}

function schoolFeesBreakdownHtml(data) {
  const sig = cfg.schoolSignatures();
  const b = getBranding();
  const directorName = sig.directorName || b.directorName || b.proprietorName || "School Director";
  const directorSig = sig.directorSignature ? `<img src="${sig.directorSignature}" style="max-height:40px;max-width:170px;object-fit:contain">` : "";
  const rows = data.rows.map((r) => `<tr>
    <td class="center">${r.sn}</td><td>${escapeHtml(r.item)}</td>
    <td class="right">${naira(r["First Term"])}</td><td class="right">${naira(r["Second Term"])}</td><td class="right">${naira(r["Third Term"])}</td><td class="right">${naira(r.total)}</td>
  </tr>`).join("");
  return `<section class="fee-breakdown-doc">${headerHtml()}
    <div class="center" style="font-weight:700;margin-top:8px">SCHOOL FEES BREAKDOWN</div>
    <div class="doc-title">${escapeHtml(data.session)} ACADEMIC SESSION REPORT</div>
    <table class="doc-table compact">
      <tr><td><b>SECTION</b></td><td>${escapeHtml(data.sectionName)}</td></tr>
      <tr><td><b>STUDENT NAME</b></td><td>${escapeHtml(data.studentName)}</td></tr>
    </table>
    <table class="doc-table compact">
      <tr><th>S/N</th><th>ITEMS</th><th class="right">1ST TERM</th><th class="right">2ND TERM</th><th class="right">3RD TERM</th><th class="right">TOTAL</th></tr>
      ${rows}
      <tr class="totals"><td></td><td>TOTAL</td><td class="right">${naira(data.totals["First Term"])}</td><td class="right">${naira(data.totals["Second Term"])}</td><td class="right">${naira(data.totals["Third Term"])}</td><td class="right">${naira(data.totals.total)}</td></tr>
    </table>
      <div class="sig-row">
        <div class="sig-box"><div style="height:42px;text-align:center">${directorSig}</div><div class="sig-line">SCHOOL DIRECTOR: ${escapeHtml(directorName)}</div></div>
        <div class="sig-box"><div class="sig-line">CONTACT: ${escapeHtml(sig.contactPhone || b.phone || "08034760436")}</div></div>
      </div>
    <table class="doc-table">
      <tr><td><b>ACCOUNT NAME</b></td><td>Halqatu Zaid bin Sabit Kano</td></tr>
      <tr><td><b>ACCOUNT NUMBER</b></td><td>0814837554</td></tr>
      <tr><td><b>BANK NAME</b></td><td>GTBANK</td></tr>
    </table></section>`;
}

function exportSchoolFeesBreakdownExcel(data) {
  const rows = [
    ["School Fees Breakdown"],
    ["Session", data.session, "Section", data.sectionName, "Student", data.studentName],
    [],
    ["S/N", "Items", "1st Term", "2nd Term", "3rd Term", "Total"],
    ...data.rows.map((r) => [r.sn, r.item, r["First Term"], r["Second Term"], r["Third Term"], r.total]),
    ["", "TOTAL", data.totals["First Term"], data.totals["Second Term"], data.totals["Third Term"], data.totals.total]
  ];
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><table border="1">
    ${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}
  </table></body></html>`;
  download("School_Fees_Breakdown.xls", html, "application/vnd.ms-excel;charset=utf-8");
}

function feeEligibilityColumns() {
  return [
    { label: "S/N", align: "center", key: "sn" },
    { label: "Student Name", key: "studentName" },
    { label: "Admission No", key: "admissionNo" },
    { label: "Active", align: "center", render: (r) => r.active ? statusPill("ACTIVE", "green") : "" },
    { label: "Inactive", align: "center", render: (r) => !r.active ? statusPill("INACTIVE", "red") : "" },
    { label: "Outstanding Balance", align: "right", render: (r) => naira(r.outstanding) },
    { label: "Take Action", align: "center", render: (r) => statusPill(r.actionStatus, r.actionClass) },
    { label: "Exam Eligible", align: "center", render: (r) => statusPill(r.examStatus, r.examClass) }
  ];
}

function statusPill(text, cls) {
  return text ? el("span", { class: "badge " + cls, text }) : "";
}

function feeEligibilityData(filters = {}) {
  const students = db.list("students")
    .filter((s) => !["graduated", "withdrawn"].includes(String(s.status || "").toLowerCase()))
    .filter((s) => !filters.sectionId || cfg.studentInSection(s, filters.sectionId))
    .filter((s) => !filters.classId || cfg.studentInClass(s, filters.classId))
    .sort((a, b) =>
      (cfg.sectionName(a.sectionId) || "").localeCompare(cfg.sectionName(b.sectionId) || "") ||
      (cfg.className(a.classId) || "").localeCompare(cfg.className(b.classId) || "") ||
      (a.fullName || "").localeCompare(b.fullName || ""));

  // DO NOT filter invoices by session/term for outstanding balance calculation!
  // Eligibility is based on the student's entire ledger history.
  const invoices = db.list("invoices");
  const invoiceIds = new Set(invoices.map((i) => i.id).filter(Boolean));
  const paymentsByInvoice = {};
  db.list("payments").forEach((p) => {
    if (!p.invoiceId || !invoiceIds.has(p.invoiceId)) return;
    paymentsByInvoice[p.invoiceId] = num(paymentsByInvoice[p.invoiceId]) + num(p.amount);
  });
  const invoicesByStudent = {};
  invoices.forEach((inv) => {
    if (!inv.studentId) return;
    (invoicesByStudent[inv.studentId] ||= []).push(inv);
  });

  const rows = students.map((student) => {
    const invs = invoicesByStudent[student.id] || [];
    const expected = invs.reduce((a, inv) => a + invoiceGross(inv), 0);
    const payments = invs.reduce((a, inv) => a + invoicePaid(inv, paymentsByInvoice), 0);
    const scholarships = invs.reduce((a, inv) => a + num(inv.scholarship), 0);
    const discounts = invs.reduce((a, inv) => a + num(inv.discount), 0);

    // Strict numeric calculation using standard formulas
    const totalDeductions = num(scholarships) + num(discounts);
    const outstanding = Math.max(0, num(Number(expected).toFixed(2)) - num(Number(payments).toFixed(2)) - num(Number(totalDeductions).toFixed(2)));

    const active = payments > 0;

    let examStatus = "OTHER";
    let examClass = "gray";
    if (outstanding <= 0) {
      examStatus = "ELIGIBLE";
      examClass = "green";
    } else if (payments > 0) {
      examStatus = "MANAGEABLE";
      examClass = "orange";
    } else {
      examStatus = "INACTIVE";
      examClass = "red";
    }

    return {
      studentId: student.id,
      studentName: student.fullName || "",
      admissionNo: student.admissionNo || "",
      sectionId: student.sectionId || "",
      classId: student.classId || "",
      sectionName: cfg.sectionName(student.sectionId) || "Unassigned Section",
      className: cfg.className(student.classId) || "Unassigned Class",
      expected,
      payments,
      scholarships,
      discounts,
      outstanding,
      active,
      actionStatus: outstanding > 0 ? "TAKE ACTION" : "CLEARED",
      actionClass: outstanding > 0 ? "red" : "green",
      examStatus,
      examClass
    };
  }).filter(row => {
    if (!filters.examStatus) return true;
    if (filters.examStatus === "OTHER") {
      return !["ELIGIBLE", "MANAGEABLE", "INACTIVE"].includes(row.examStatus);
    }
    return row.examStatus === filters.examStatus;
  });

  const groupsByKey = {};
  rows.forEach(row => {
    const key = `${row.sectionName}|${row.className}|${row.sectionId}|${row.classId}`;
    if (!groupsByKey[key]) groupsByKey[key] = { sectionName: row.sectionName, className: row.className, rows: [] };
    groupsByKey[key].rows.push(row);
  });

  const groups = Object.values(groupsByKey).map((group) => {
    group.rows = group.rows.map((r, i) => ({ ...r, sn: i + 1 }));
    return group;
  });
  return {
    rows,
    groups,
    totals: {
      expected: sumBy(rows, (r) => r.expected),
      payments: sumBy(rows, (r) => r.payments),
      scholarships: sumBy(rows, (r) => r.scholarships),
      discounts: sumBy(rows, (r) => r.discounts),
      outstanding: sumBy(rows, (r) => r.outstanding)
    }
  };
}

function invoiceGross(inv) {
  const serviceGross = (inv.services || []).reduce((a, s) => a + num(s.amount), 0);
  return num(inv.grossAmount) || serviceGross || (num(inv.totalAmount) + num(inv.discount) + num(inv.scholarship));
}

function invoicePaid(inv, paymentsByInvoice = {}) {
  const paid = num(inv.amountPaid);
  if (paid > 0) return paid;
  const embeddedPayments = (inv.payments || []).reduce((a, p) => a + num(p.amount), 0);
  return Math.max(embeddedPayments, num(paymentsByInvoice[inv.id]));
}

function feeEligibilityReportHtml(data, filters = {}) {
  const meta = [
    ["Date Generated", fmtDateTime(Date.now())],
    ["Session", filters.session || "All Sessions"],
    ["Term", filters.term || "All Terms"],
    ["Section", filters.sectionId ? cfg.sectionName(filters.sectionId) : "All Sections"],
    ["Class", filters.classId ? cfg.className(filters.classId) : "All Classes"]
  ];
  const groupHtml = data.groups.map((group) => `
    <div style="page-break-inside:avoid;margin-top:14px">
      <h3 style="margin:8px 0;color:#0b3d91">${escapeHtml(group.className)} / ${escapeHtml(group.sectionName)}</h3>
      <table class="doc-table compact wide-table">
        <tr>
          <th class="center">S/N</th><th>Student Name</th><th>Admission No</th>
          <th class="center">Active</th><th class="center">Inactive</th>
          <th class="right">Outstanding Balance</th><th class="center">Take Action</th><th class="center">Exam Eligible</th>
        </tr>
        ${group.rows.map((r) => `
          <tr>
            <td class="center">${r.sn}</td>
            <td>${escapeHtml(r.studentName)}</td>
            <td>${escapeHtml(r.admissionNo)}</td>
            <td class="center">${r.active ? badgeHtml("ACTIVE", "green") : ""}</td>
            <td class="center">${!r.active ? badgeHtml("INACTIVE", "red") : ""}</td>
            <td class="right">${naira(r.outstanding)}</td>
            <td class="center">${badgeHtml(r.actionStatus, r.actionClass)}</td>
            <td class="center">${badgeHtml(r.examStatus, r.examClass)}</td>
          </tr>`).join("")}
      </table>
    </div>`).join("");

  return `<section class="fee-eligibility-doc">${headerHtml()}
    <div class="doc-title">Class Fee Monitoring &amp; Examination Eligibility Report</div>
    <table class="doc-table">
      ${meta.map(([k, v]) => `<tr><td><b>${escapeHtml(k)}</b></td><td>${escapeHtml(v)}</td></tr>`).join("")}
    </table>
    <table class="doc-table">
      <tr><th>Expected Fees</th><th>Payments Made</th><th>Scholarships</th><th>Discounts</th><th>Outstanding Balance</th></tr>
      <tr class="totals">
        <td>${naira(data.totals.expected)}</td>
        <td>${naira(data.totals.payments)}</td>
        <td>${naira(data.totals.scholarships)}</td>
        <td>${naira(data.totals.discounts)}</td>
        <td>${naira(data.totals.outstanding)}</td>
      </tr>
    </table>
    ${groupHtml || `<p class="muted center">No records found for the selected filters.</p>`}</section>`;
}

function badgeHtml(text, cls) {
  return `<span class="badge ${escapeHtml(cls)}">${escapeHtml(text)}</span>`;
}

function exportFeeEligibilityExcel(data, filters = {}) {
  const rows = [
    ["Class Fee Monitoring & Examination Eligibility Report"],
    ["Session", filters.session || "All Sessions", "Term", filters.term || "All Terms"],
    ["Section", filters.sectionId ? cfg.sectionName(filters.sectionId) : "All Sections", "Class", filters.classId ? cfg.className(filters.classId) : "All Classes"],
    [],
    ["S/N", "Student Name", "Admission No", "Section", "Class", "Active", "Inactive", "Expected Fees", "Payments Made", "Scholarships", "Discounts", "Outstanding Balance", "Take Action", "Exam Eligible"]
  ];
  data.groups.forEach((group) => {
    group.rows.forEach((r) => rows.push([
      r.sn,
      r.studentName,
      r.admissionNo,
      r.sectionName,
      r.className,
      r.active ? "ACTIVE" : "",
      !r.active ? "INACTIVE" : "",
      r.expected,
      r.payments,
      r.scholarships,
      r.discounts,
      r.outstanding,
      r.actionStatus,
      r.examStatus
    ]));
  });
  rows.push([]);
  rows.push(["Totals", "", "", "", "", "", "", data.totals.expected, data.totals.payments, data.totals.scholarships, data.totals.discounts, data.totals.outstanding]);
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><table border="1">
    ${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}
  </table></body></html>`;
  download("Class_Fee_Monitoring_Eligibility.xls", html, "application/vnd.ms-excel;charset=utf-8");
}
