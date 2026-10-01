import { db } from "../core/db.js";
import { el, naira, toast, modal, fmtDate } from "../core/utils.js";
import { card, pageHead, table, btn, input, select, field, multiSelectBar } from "../core/ui.js";
import * as cfg from "../core/config.js";
import { createInvoice, buildServiceLines } from "../core/billing.js";
import { deductBookStock } from "./bookshop.js";
import { getBranding, headerHtml } from "../core/branding.js";
import { printHtml } from "../core/print.js";

export function render(root, ctx) {
  root.appendChild(pageHead("Bulk Invoice Generator", "Filter students, batch-select, and generate invoices in bulk automatically applying family discounts and scholarships."));

  // Filters
  const curSession = cfg.currentSession();
  const sessionSel = select(() => [curSession].filter(Boolean).map(s => ({ value: s, label: s, selected: true }))
  );
  const termSel = select(() => (cfg.sessions().terms || ["First Term", "Second Term", "Third Term"]).map(t => ({ value: t, label: t, selected: t === cfg.currentTerm() })));
  const secSel = select(() => [{ value: "", label: "All Sections" }, ...cfg.sections().map(s => ({ value: s.id, label: s.name }))]);
  const clsSel = select(() => [{ value: "", label: "All Classes" }]);
  const typeSel = select(() => [
    { value: "", label: "All Admission Types" },
    { value: "New Student", label: "New Student" },
    { value: "Returning Student", label: "Returning Student" },
    { value: "Migration Student", label: "Migration Student" }
  ]);
  const statusSel = select(() => [
    { value: "", label: "All Statuses" },
    { value: "active", label: "Active", selected: true },
    { value: "inactive", label: "Inactive" },
    { value: "graduated", label: "Graduated" },
    { value: "withdrawn", label: "Withdrawn" }
  ]);

  const quickMigBtn = btn("Show Migration Students Only", { variant: "primary", sm: true, onclick: () => {
    typeSel.value = "Migration Student";
    statusSel.value = "active";
    draw();
  }});

  secSel.onchange = () => {
    clsSel.innerHTML = ""; clsSel.appendChild(el("option", { value: "", text: "All Classes" }));
    if (secSel.value) cfg.classes(secSel.value).forEach(c => clsSel.appendChild(el("option", { value: c.id, text: c.name })));
    draw();
  };

  [sessionSel, termSel, clsSel, typeSel, statusSel].forEach(s => s.onchange = draw);

  const filterRow = el("div", { class: "form-grid", style: "margin-bottom:12px" }, [
    field("Session", sessionSel), field("Term", termSel),
    field("Section", secSel), field("Class", clsSel),
    field("Admission Type", typeSel), field("Status", statusSel)
  ]);

  root.appendChild(filterRow);
  root.appendChild(el("div", { class: "row", style: "margin-bottom:20px" }, [quickMigBtn]));

  const host = el("div");
  root.appendChild(host);

  let selectedStudentIds = new Set();
  let currentStudents = [];

  function draw() {
    let rows = db.list("students");
    
    if (sessionSel.value) rows = rows.filter(s => s.session === sessionSel.value);
    if (secSel.value) rows = rows.filter(s => s.sectionId === secSel.value);
    if (clsSel.value) rows = rows.filter(s => s.classId === clsSel.value);
    if (typeSel.value) rows = rows.filter(s => s.admissionType === typeSel.value);
    if (statusSel.value) rows = rows.filter(s => s.status === statusSel.value);

    rows.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
    currentStudents = rows;

    host.innerHTML = "";

    const curTerm = cfg.currentTerm();
    const generateTargetTerm = select(() => (cfg.sessions().terms || ["First Term", "Second Term", "Third Term"]).map(t => ({ value: t, label: t, selected: t === curTerm })));
    const generateType = select(() => [
      { value: "Full Fee Invoice", label: "Full Fee Invoice" },
      { value: "Tuition Invoice", label: "Tuition Invoice" },
      { value: "Service Invoice", label: "Service Invoice" },
      { value: "Migration Outstanding Invoice", label: "Migration Outstanding Invoice" }
    ]);

    const genBtn = btn("Generate Selected Invoices", { variant: "success", onclick: () => doGenerate(generateTargetTerm.value, generateType.value) });
    const printBtn = btn("Print Selected", { onclick: printSelected });

    const actionBar = el("div", { class: "row", style: "gap:10px; margin-bottom:12px; align-items:flex-end;" }, [
      field("Target Term", generateTargetTerm),
      field("Invoice Type", generateType),
      genBtn, printBtn
    ]);

    const multiBar = multiSelectBar(selectedStudentIds, currentStudents, () => drawTableOnly());

    const tableHost = el("div");
    host.appendChild(card("Bulk Invoice List", [actionBar, multiBar, tableHost]));

    function drawTableOnly() {
      tableHost.innerHTML = "";
      const t = table([
        { 
          label: "Select", 
          render: s => {
            const cb = input({ type: "checkbox" });
            cb.checked = selectedStudentIds.has(s.id);
            cb.onchange = () => {
              if (cb.checked) selectedStudentIds.add(s.id); else selectedStudentIds.delete(s.id);
            };
            return cb;
          }
        },
        { label: "Admission No", key: "admissionNo" },
        { label: "Name", key: "fullName" },
        { label: "Class", render: s => cfg.className(s.classId) },
        { label: "Type", key: "admissionType" },
        { label: "WhatsApp", render: s => {
            if (!s.parentPhone) return "â€”";
            return btn("WA", { sm: true, onclick: () => {
              const text = `Dear Parent, an invoice has been generated for ${s.fullName}. Please log into the Parent Portal for details. Kano Central International School appreciates your dedication and commitment to excellence.`;
              const url = `https://wa.me/${s.parentPhone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
              window.open(url, '_blank');
            }});
        }}
      ], currentStudents, { empty: "No students match the criteria." });
      tableHost.appendChild(t);
    }
    drawTableOnly();
  }

  // Use setTimeout to chunk processing so UI doesn't freeze
  function chunkArray(arr, size) {
    const res = [];
    for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
    return res;
  }

  async function doGenerate(targetTerm, invType) {
    const ids = Array.from(selectedStudentIds);
    if (!ids.length) return toast("Select at least one student", "error");

    const session = cfg.currentSession();
    const students = ids.map(id => db.get("students", id)).filter(Boolean);
    const duplicates = students.map((student) => ({
      student,
      invoice: findDuplicateInvoice(student.id, session, targetTerm, invType)
    })).filter((r) => r.invoice);
    let replaceDuplicateIds = new Set();
    if (duplicates.length) {
      const choice = await duplicateInvoiceDecision(duplicates, ctx);
      if (choice === "cancel") return;
      if (choice === "replace") replaceDuplicateIds = new Set(duplicates.map((d) => d.invoice.id));
    }
    
    const m = modal({ title: "Generating Invoices...", body: el("div", { id: "bulk-progress", text: "Starting..." }), footer: [] });
    const progressEl = m.body;

    let successCount = 0;
    let skipCount = 0;

    const chunks = chunkArray(students, 20); // Process 20 at a time

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      progressEl.textContent = `Processing chunk ${i+1} of ${chunks.length} (${successCount + skipCount} / ${students.length})...`;

      for (const student of chunk) {
        // 1. Duplicate Protection
        const existing = findDuplicateInvoice(student.id, session, targetTerm, invType);

        if (existing && !replaceDuplicateIds.has(existing.id)) {
          skipCount++;
          continue;
        }
        if (existing && replaceDuplicateIds.has(existing.id)) {
          db.save("auditLogs", {
            id: "audit-" + Date.now() + "-" + existing.id,
            type: "invoice_duplicate_replace",
            uid: ctx.user.uid,
            email: ctx.user.email,
            at: Date.now(),
            message: `Replaced duplicate invoice ${existing.invoiceNo} for ${student.fullName}`,
            invoiceId: existing.id,
            studentId: student.id
          });
          db.delete("invoices", existing.id);
        }

        // 2. Build Services based on Type
        let services = [];
        const secServices = cfg.servicesForSection(student.sectionId).map(s => s.id);
        
        if (invType === "Migration Outstanding Invoice") {
          services = buildServiceLines(student.sectionId, { includeBooks: true, serviceIds: secServices });
        } else if (invType === "Tuition Invoice") {
          const allLines = buildServiceLines(student.sectionId, { includeBooks: false, serviceIds: secServices });
          services = allLines.filter(s => s.name.toLowerCase().includes("tuition"));
        } else if (invType === "Service Invoice") {
          const allLines = buildServiceLines(student.sectionId, { includeBooks: true, serviceIds: secServices });
          services = allLines.filter(s => !s.name.toLowerCase().includes("tuition"));
        } else {
          // Full Fee
          services = buildServiceLines(student.sectionId, { includeBooks: true, serviceIds: secServices });
        }

        if (services.length === 0) services.push({ id: "bulk-base", name: "Standard Fee", amount: 0, type: "fee", optional: false });

        // 3. createInvoice handles Family Waivers & Scholarships automatically
        await createInvoice({
          student,
          services,
          type: invType,
          term: targetTerm
        });
        // 4. Deduct book stock for any book lines
        const bookLines = services.filter(s => s.type === "book");
        if (bookLines.length) deductBookStock(bookLines);
        successCount++;
      }

      // Yield back to main thread
      await new Promise(r => setTimeout(r, 50));
    }

    m.close();
    toast(`Generated ${successCount} invoices. Skipped ${skipCount} duplicates.`, "success");
    
    // Deselect all on success
    selectedStudentIds.clear();
    draw();
  }

  function findDuplicateInvoice(studentId, session, term, type) {
    return db.query("invoices", inv =>
      inv.studentId === studentId &&
      inv.session === session &&
      inv.term === term &&
      inv.type === type
    ).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
  }

  function duplicateInvoiceDecision(duplicates, ctx) {
    return new Promise((resolve) => {
      const body = el("div", {}, [
        el("p", { style: "color:var(--danger);font-weight:700", text: "Duplicate Invoice Detected" }),
        table([
          { label: "Student", render: (r) => r.student.fullName },
          { label: "Invoice", render: (r) => r.invoice.invoiceNo },
          { label: "Term", render: (r) => r.invoice.term },
          { label: "Type", render: (r) => r.invoice.type },
          { label: "", render: (r) => btn("View", { sm: true, onclick: async () => {
            const { showInvoice } = await import("./invoices.js");
            showInvoice(r.invoice.id);
          } }) }
        ], duplicates)
      ]);
      const canReplace = ["Super Admin", "Admin", "admin", "super_admin"].includes(ctx?.user?.role || "");
      const footer = [
        btn("Cancel", { onclick: () => { m.close(); resolve("cancel"); } }),
        btn("Skip Duplicates", { variant: "primary", onclick: () => { m.close(); resolve("skip"); } })
      ];
      if (canReplace) footer.push(btn("Replace Existing Invoice", { variant: "danger", onclick: () => { m.close(); resolve("replace"); } }));
      const m = modal({ title: "Duplicate Invoice Detected", size: "lg", body, footer });
    });
  }

  function printSelected() {
    const ids = Array.from(selectedStudentIds);
    if (!ids.length) return toast("Select students to print.", "error");
    const session = cfg.currentSession();
    
    // Get the most recent invoice for each selected student
    const invoices = ids.map(id => {
       const invs = db.query("invoices", i => i.studentId === id && i.session === session);
       invs.sort((a,b) => b.createdAt - a.createdAt);
       return invs[0];
    }).filter(Boolean);

    if (!invoices.length) return toast("No recent invoices found for selected students.", "error");

    const b = getBranding();
    const rows = invoices.map(i => `<tr>
      <td>${i.admissionNo}</td>
      <td>${i.studentName}</td>
      <td>${cfg.className(i.classId)}</td>
      <td>${i.term}</td>
      <td>${i.type}</td>
      <td>${naira(i.totalAmount)}</td>
      <td>${i.status}</td>
    </tr>`).join("");

    const html = `<section class="bulk-invoice-report-doc">
      ${headerHtml()}
      <h2>Bulk Invoice Generation Report</h2>
      <p>Session: ${session} | Printed: ${fmtDate(Date.now())}</p>
      <table class="doc-table compact"><thead><tr><th>Admission No</th><th>Name</th><th>Class</th><th>Term</th><th>Type</th><th>Total</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div class="print-footer center" style="font-style:italic;font-weight:600;margin-top:20px">${b.schoolName}</div>
      </section>`;
    printHtml(html, { title: "Bulk Invoice Report", orientation: "landscape" });
  }

  draw();
  const off = db.on("students", draw);
  return () => off();
}


