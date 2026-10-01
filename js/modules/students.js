import { db } from "../core/db.js";
import { el, toast, naira, fmtDate, modal, debounce, confirmDialog, num, uuid } from "../core/utils.js";
import { card, pageHead, table, btn, input, select, field, textarea, readFileAsDataURL, resizeImageAsDataURL, BulkSelection, bulkActionBar } from "../core/ui.js";
import * as cfg from "../core/config.js";
import { idCardDoc } from "../core/documents.js";
import { printHtml, downloadPdf } from "../core/print.js";
import { invoiceForStudent, createInvoice, recalcInvoice, syncStudentProgramInvoice, applyPayment } from "../core/billing.js";
import { can } from "../core/rbac.js";
import { showInvoice } from "./invoices.js";
import { logActivity } from "../core/activity.js";
import { familyByPhone, familyStudents } from "../core/family.js";
import { nextInvoiceNo } from "../core/idgen.js";
import { lazyListen } from "../core/adapter.js";
import { enrollFingerprint, fingerprintServiceAvailable } from "../core/fingerprint.js";

let renderCount = 0;
let lastRenderMs = 0;

window.cicStudentsAudit = () => {
  const list = db.list("students");
  const unique = new Set(list.map(s => s.id));
  return {
    totalStudents: list.length,
    activeListeners: typeof window.cicListenerAudit === 'function' ? window.cicListenerAudit().fsListeners : 1,
    renderCount,
    lastRenderMs,
    lastSyncMs: Date.now(),
    duplicatedRecords: list.length - unique.size,
    duplicatedListeners: 0,
    memoryEstimate: (list.length * 2.5) + " KB"
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// FEE MANAGEMENT PERMISSIONS
// ─────────────────────────────────────────────────────────────────────────────
function canManageFees(role) {
  return ["Super Admin", "Admin", "Accountant"].includes(role);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN RENDER — Student List with Hierarchical Filters
// ─────────────────────────────────────────────────────────────────────────────
export function render(root, ctx) {
  lazyListen("students"); // Activate live listener now that the Students module is open
  root.appendChild(pageHead("Students", "Filter by Section → Class, then search. Manage student records and fees."));

  // ── Filter Row ──────────────────────────────────────────────────────────────
  const secFilter = select(() => [
    { value: "", label: "All Sections" },
    ...cfg.sections().map((s) => ({ value: s.id, label: s.name }))
  ]);

  const clsFilter = select(() => [{ value: "", label: "All Classes" }]);

  const statusFilter = select(() => [
    { value: "", label: "All Status" },
    { value: "active", label: "Active" },
    { value: "suspended", label: "Suspended" },
    { value: "graduated", label: "Graduated" }
  ]);

  const search = input({
    placeholder: "Search name / admission no / student ID / parent name / phone…",
    style: "min-width:260px;flex:1"
  });

  const dupBtn = btn("Find Duplicates", { variant: "ghost", icon: "🔍", onclick: () => showDuplicates(ctx) });
  const islTahBtn = btn("Islamiyya / Tahfiz Placements", { variant: "ghost", icon: "🕌", onclick: () => manageIslamiyyaTahfizPlacements(ctx) });

  // Populate class dropdown based on selected section
  function refreshClasses() {
    const secId = secFilter.value;
    clsFilter.innerHTML = "";
    clsFilter.appendChild(el("option", { value: "", text: secId ? "All Classes" : "Select Section First" }));
    if (secId) {
      cfg.classes(secId).forEach((c) => {
        clsFilter.appendChild(el("option", { value: c.id, text: c.name }));
      });
    }
  }

  root.appendChild(el("div", {
    class: "row",
    style: "margin-bottom:14px;flex-wrap:wrap;gap:8px;align-items:center"
  }, [
    el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" }, [
      el("label", { style: "font-size:12px;font-weight:600;color:var(--muted)" , text: "Section:" }),
      secFilter,
      el("label", { style: "font-size:12px;font-weight:600;color:var(--muted)", text: "Class:" }),
      clsFilter,
      el("label", { style: "font-size:12px;font-weight:600;color:var(--muted)", text: "Status:" }),
      statusFilter
    ]),
    search,
    dupBtn,
    islTahBtn
  ]));

  const selection = new BulkSelection();
  selection.subscribe(() => {
    // If we wanted to re-render the table on every selection change to highlight rows,
    // we could call draw() here, but that might reset the view scroll or inputs.
    // Since table() internally binds checkboxes, we only need to redraw if necessary.
  });

  const bulkBar = bulkActionBar(selection, [
    { label: "🖨️ Print Selected", action: (ids) => bulkPrint(ids.map(id => db.get("students", id))) },
    { label: "📄 Generate Invoices", action: (ids) => bulkGenerateInvoices(ids.map(id => db.get("students", id)), ctx) },
    { label: "🪪 ID Cards", action: (ids) => bulkIDCards(ids.map(id => db.get("students", id))) },
    { label: "⬆️ Promote Selected", action: (ids) => bulkPromote(ids.map(id => db.get("students", id)), ctx) },
    { label: "📊 Export Excel", action: (ids) => bulkExportExcel(ids.map(id => db.get("students", id))) },
    { label: "📥 Export PDF", action: (ids) => bulkExportPDF(ids.map(id => db.get("students", id))) },
    { label: "🏷️ Assign Programs", action: (ids) => {
        const pList = cfg.programs(); cfg.sections().forEach(s => { if (!pList.find(p => p.id === s.id)) pList.push({ id: s.id, name: s.name, sectionId: s.id }); });
        if (!pList.length) return toast("No programs defined in Settings.");
        const pSel = select(() => [{value: "", label: "-- Select Program --"}, ...pList.map(p => ({value: p.id, label: p.name}))]);
        const cSelContainer = el("div", { style: "margin-top:10px;" });
        let currentSectionId = "";
        
        pSel.onchange = () => {
          cSelContainer.innerHTML = "";
          const pid = pSel.value;
          if (!pid) return;
          const p = cfg.program(pid);
          if (p && p.sectionId) {
            currentSectionId = p.sectionId;
            const clsList = cfg.classes(p.sectionId);
            if (clsList.length) {
              cSelContainer.appendChild(el("label", { text: "Assign to Class (Optional):", style: "font-size:13px;font-weight:bold;display:block;margin-bottom:4px;color:var(--text)" }));
              const cSel = select(() => [{value: "", label: "Auto-assign by name (Default)"}, ...clsList.map(c => ({value: c.id, label: c.name}))]);
              cSel.id = "bulkAssignClassSel";
              cSelContainer.appendChild(cSel);
            }
          }
        };

        const m = modal({
          title: "Assign Program",
          body: el("div", {}, [
            el("p", {text: `Select a program to assign to ${ids.length} selected students:`, style: "margin-bottom:8px;"}),
            pSel,
            cSelContainer
          ]),
          footer: [
            btn("Assign", { variant: "primary", onclick: () => {
              const pid = pSel.value;
              if (!pid) return toast("Please select a program.");
              
              const cSel = cSelContainer.querySelector("#bulkAssignClassSel");
              const cid = cSel ? cSel.value : "";

              ids.forEach(id => {
                const s = db.get("students", id);
                if (s) {
                  const sPids = new Set(s.programIds || []);
                  sPids.add(pid);
                  s.programIds = [...sPids];
                  s.programs = s.programIds;
                  s.programNames = s.programIds.map(i => cfg.programName(i));
                  
                  if (cid && currentSectionId) {
                    s.secondaryClasses = s.secondaryClasses || {};
                    s.secondaryClasses[currentSectionId] = cid;
                  }
                  
                  db.save("students", s);
                }
              });
              toast(`Program assigned to ${ids.length} students successfully.`, "success");
              m.close();
              draw();
            }})
          ]
        });
    }}
  ]);
  root.appendChild(bulkBar);

  const host = el("div");
  root.appendChild(host);

  let currentPage = 1;
  let pageSize = 50;
  let rendering = false;

  const draw = async () => {
    if (rendering) return;
    rendering = true;
    const startTime = window.performance.now();

    let renderedCount = 0;
    try {
      selection.clear();

      const q = (search.value || "").toLowerCase();
      let rows = db.list("students");

      if (secFilter.value) rows = rows.filter((s) => cfg.studentInSection(s, secFilter.value));
      if (clsFilter.value) rows = rows.filter((s) => cfg.studentInClass(s, clsFilter.value));
      if (statusFilter.value) rows = rows.filter((s) => (s.status || "active") === statusFilter.value);
      if (q) rows = rows.filter((s) =>
        `${s.fullName} ${s.admissionNo} ${s.studentId || ""} ${s.parentName || ""} ${s.parentPhone || ""}`.toLowerCase().includes(q)
      );

      rows.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));

      const totalRows = rows.length;
      const totalPages = Math.ceil(totalRows / pageSize) || 1;
      if (currentPage > totalPages) currentPage = totalPages;

      const paginatedRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
      renderedCount = paginatedRows.length;

      host.innerHTML = "";

      // Summary bar with page size selector
      const secLabel = secFilter.value ? cfg.sectionName(secFilter.value) : "All Sections";
      const clsLabel = clsFilter.value ? cfg.className(clsFilter.value) : "All Classes";
      
      const sizeSel = select(() => [
        { value: "50", label: "50 per page" },
        { value: "100", label: "100 per page" },
        { value: "200", label: "200 per page" }
      ], { style: "padding:2px 6px; height:24px; font-size:12px; display:inline-block; width:auto; margin-left:12px;" });
      sizeSel.value = String(pageSize);
      sizeSel.onchange = () => { pageSize = Number(sizeSel.value); currentPage = 1; debouncedDraw(); };

      host.appendChild(el("div", {
        style: "margin-bottom:10px;font-size:13px;color:var(--muted);display:flex;align-items:center;"
      }, [
        el("span", { text: `Showing ${paginatedRows.length} of ${totalRows} student(s) · ${secLabel} › ${clsLabel}` }),
        sizeSel
      ]));

      if (!paginatedRows.length) {
        host.appendChild(card("", [el("div", { class: "empty", style: "padding:32px", text: "No students match the selected filters." })]));
        return;
      }

      host.appendChild(card("", [table([
        { label: "Adm No", key: "admissionNo" },
        { label: "Name", key: "fullName" },
        { label: "Section", render: (s) => cfg.sectionName(s.sectionId) },
        { label: "Class", render: (s) => cfg.className(s.classId) },
        { label: "Parent Phone", key: "parentPhone" },
        {
          label: "Status",
          html: true,
          render: (s) => `<span class="tag ${s.status === "graduated" ? "blue" : s.status === "suspended" ? "red" : "green"}">${s.status || "active"}</span>`
        },
        {
          label: "",
          render: (s) => el("div", { class: "row" }, [
            btn("Profile", { sm: true, onclick: () => profile(s.id, ctx) }),
            btn("⋮", { sm: true, onclick: (e) => menu(e, s, ctx) })
          ])
        }
      ], paginatedRows, { empty: "No students match.", selection })]));

      // Pagination Controls
      if (totalPages > 1) {
        const paginator = el("div", { class: "row", style: "margin-top:12px; justify-content:center; align-items:center; gap:16px" });
        
        paginator.appendChild(btn("Prev", { sm: true, variant: "ghost", disabled: currentPage === 1 ? "disabled" : undefined, onclick: () => { if (currentPage > 1) { currentPage--; debouncedDraw(); } } }));
        paginator.appendChild(el("span", { style: "font-size:13px; font-weight:500" }, [el("span", { text: `Page ${currentPage} of ${totalPages}` })]));
        paginator.appendChild(btn("Next", { sm: true, variant: "ghost", disabled: currentPage === totalPages ? "disabled" : undefined, onclick: () => { if (currentPage < totalPages) { currentPage++; debouncedDraw(); } } }));
        
        host.appendChild(paginator);
      }
    } finally {
      console.debug(`Rendered ${renderedCount} students in ${(window.performance.now() - startTime).toFixed(1)}ms`);
      renderCount++;
      lastRenderMs = window.performance.now() - startTime;
      rendering = false;
    }
  };

  const debouncedDraw = debounce(draw, 300);
  const queueStudentsRefresh = () => debouncedDraw();

  search.oninput = () => { currentPage = 1; queueStudentsRefresh(); };
  secFilter.onchange = () => { refreshClasses(); currentPage = 1; queueStudentsRefresh(); };
  clsFilter.onchange = () => { currentPage = 1; queueStudentsRefresh(); };
  statusFilter.onchange = () => { currentPage = 1; queueStudentsRefresh(); };

  draw(); // initial sync render
  search.oninput = () => { currentPage = 1; queueStudentsRefresh(); };
  
  const off = db.on("students", queueStudentsRefresh);
  return () => off();
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT MENU
// ─────────────────────────────────────────────────────────────────────────────
function menu(e, s, ctx) {
  const items = [
    ["Edit", () => editStudent(s.id, ctx)],
    ["View Health Info", () => showHealthModal(s.id)],
    ["Print ID Card", () => printHtml(idCardDoc(db.get("students", s.id)), { title: "ID " + s.admissionNo })]
  ];

  if (s.status === "graduated") {
    items.push(["Re-admit Student", () => readmit(s.id, ctx)]);
  } else {
    items.push(["Transfer Class", () => transfer(s.id, ctx)]);
    items.push([s.status === "suspended" ? "Reinstate" : "Suspend", () => toggleSuspend(s.id, ctx)]);
    items.push(["Graduate", () => graduate(s.id, ctx)]);
  }
  
  items.push(["Delete Student", () => deleteStudent(s.id, ctx)]);
  const body = el("div", {}, items.map(([label, fn]) => {
    const isDanger = label === "Delete Student";
    return btn(label, {
      variant: isDanger ? "danger" : "ghost",
      onclick: () => { m.close(); fn(); },
      attrs: { style: `width:100%;justify-content:flex-start;margin-bottom:6px${isDanger ? ";color:#c0392b" : ""}` }
    });
  }));
  const m = modal({ title: s.fullName, size: "sm", body });
}

// ─────────────────────────────────────────────────────────────────────────────
// STUDENT PROFILE — enhanced with Financial Management tab
// ─────────────────────────────────────────────────────────────────────────────
function profile(id, ctx) {
  const s = db.get("students", id);
  const invoices = invoiceForStudent(id);
  const receipts = db.query("receipts", (r) => r.studentId === id).sort((a, b) => b.date - a.date);
  const results = db.query("results", (r) => r.studentId === id);

  const totalBilled = invoices.reduce((a, i) => a + num(i.totalAmount), 0);
  const totalPaid = invoices.reduce((a, i) => a + num(i.amountPaid), 0);
  const totalOutstanding = invoices.reduce((a, i) => a + num(i.balance), 0);
  const totalScholarship = invoices.reduce((a, i) => a + num(i.scholarship), 0);
  const totalDiscount = invoices.reduce((a, i) => a + num(i.discount), 0);

  const body = el("div");
  body.innerHTML = `
    <div style="display:flex;gap:16px;align-items:flex-start">
      <div style="width:96px;height:112px;border:1px solid var(--border);border-radius:8px;overflow:hidden">${s.passport ? `<img src="${s.passport}" style="width:100%;height:100%;object-fit:cover">` : '<div class="empty" style="padding:24px 4px">No photo</div>'}</div>
      <div style="flex:1">
        <h3 style="margin:0">${s.fullName}</h3>
        <div class="muted">${s.admissionNo} · ${cfg.sectionName(s.sectionId)} / ${cfg.className(s.classId)}</div>
        <div class="muted">Programs: ${cfg.studentProgramIds(s).map((id) => cfg.programName(id)).join(", ") || cfg.sectionName(s.sectionId)}</div>
        <div class="muted">${s.admissionType || ""} · ${s.gender || ""} · DOB: ${fmtDate(s.dob) || "-"}</div>
        <div class="muted">Parent: ${s.parentName || "-"} (${s.parentPhone || "-"})</div>
        <div class="muted">Address: ${s.address || "-"}</div>
      </div>
    </div>`;

  const tabs = el("div", { class: "row", style: "margin:14px 0;border-bottom:1px solid var(--border);padding-bottom:8px;flex-wrap:wrap;gap:4px" });
  const pane = el("div");

  const TAB = {
    "Programs": () => renderProgramsPane(pane, id, ctx),
    "Fees": () => renderFeesPane(pane, s, invoices, totalBilled, totalPaid),
    "Financial Management": () => renderFinancialManagement(pane, id, ctx),
    "Fee History": () => renderFeeHistory(pane, id),
    "Results": () => {
      pane.innerHTML = "";
      pane.appendChild(table([
        { label: "Session", key: "session" },
        { label: "Term", key: "term" },
        { label: "Average", render: (r) => num(r.average).toFixed(2) },
        { label: "Position", render: (r) => r.position || "-" }
      ], results, { empty: "No results recorded" }));
    },
    "Health": () => renderHealthPane(pane, s),
    "Promotion History": () => {
      pane.innerHTML = "";
      pane.appendChild(table([
        { label: "Event", key: "type" },
        { label: "Note", key: "note" },
        { label: "Date", render: (h) => fmtDate(h.at) }
      ], (s.history || []), { empty: "No history" }));
    },
    "Receipts": () => {
      pane.innerHTML = "";
      pane.appendChild(table([
        { label: "Receipt", key: "receiptNo" },
        { label: "Amount", align: "right", render: (r) => naira(r.amount) },
        { label: "Date", render: (r) => fmtDate(r.date) }
      ], receipts, { empty: "No receipts" }));
    },
    "Financial Benefits": () => {
      pane.innerHTML = "";
      const scholarships = db.query("studentScholarships", (a) => a.studentId === id);
      const discounts = db.query("studentDiscounts", (a) => a.studentId === id);
      pane.appendChild(el("div", { style: "font-weight:700;margin-bottom:8px", text: "Scholarships" }));
      pane.appendChild(table([
        { label: "Scholarship", key: "scholarshipName" },
        { label: "Type", key: "scholarshipType" },
        { label: "Value", render: (a) => a.valueType === "percent" ? `${a.value}%` : naira(a.value) },
        { label: "Session", key: "effectiveSession" },
        { label: "Term", key: "effectiveTerm" },
        { label: "Status", render: (a) => el("span", { class: `tag ${a.status === "Active" ? "green" : "red"}`, text: a.status }) },
        { label: "Approved By", key: "approvedBy" },
        { label: "Date", render: (a) => fmtDate(a.approvalDate) }
      ], scholarships, { empty: "No scholarships assigned." }));
      pane.appendChild(el("div", { style: "font-weight:700;margin:12px 0 8px", text: "Discounts" }));
      pane.appendChild(table([
        { label: "Discount", key: "discountName" },
        { label: "Type", key: "discountType" },
        { label: "Value", render: (a) => a.valueType === "percent" ? `${a.value}%` : naira(a.value) },
        { label: "Session", key: "effectiveSession" },
        { label: "Term", key: "effectiveTerm" },
        { label: "Status", render: (a) => el("span", { class: `tag ${a.status === "Active" ? "green" : "red"}`, text: a.status }) }
      ], discounts, { empty: "No discounts assigned." }));
    }
  };

  Object.keys(TAB).forEach((k, i) => {
    const isFinMgmt = k === "Financial Management";
    const tabBtn = btn(k, {
      sm: true,
      variant: i === 0 ? "primary" : "ghost",
      onclick: (e) => {
        tabs.querySelectorAll("button").forEach((b) => b.className = "btn btn-sm btn-ghost");
        e.target.className = "btn btn-sm btn-primary";
        TAB[k]();
      }
    });
    if (isFinMgmt) {
      tabBtn.style.background = "#7c3aed";
      tabBtn.style.color = "#fff";
      tabBtn.style.borderColor = "#7c3aed";
    }
    tabs.appendChild(tabBtn);
  });

  body.appendChild(tabs);
  body.appendChild(pane);
  TAB["Fees"]();

  modal({
    title: "Student Profile",
    size: "lg",
    body,
    footer: [
      btn("Print ID Card", { onclick: () => printHtml(idCardDoc(s), { title: "ID " + s.admissionNo }) }),
      btn("Edit", { variant: "primary", onclick: () => editStudent(id, ctx) }),
      btn("Delete", { variant: "ghost", attrs: { style: "color:#c0392b" }, onclick: () => deleteStudent(id, ctx) })
    ]
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FEES PANE (read-only summary in Fees tab)
// ─────────────────────────────────────────────────────────────────────────────
function renderProgramsPane(pane, studentId, ctx) {
  pane.innerHTML = "";
  const s = db.get("students", studentId);
  const selected = new Set(cfg.studentProgramIds(s));
  const rows = cfg.programs({ activeOnly: false, session: "", term: "" }).filter((p) => selected.has(p.id)).map((p) => ({
    name: p.name,
    fee: p.fee,
    session: p.session || "All Sessions",
    term: p.term || "All Terms",
    status: p.status || "Active"
  }));
  pane.appendChild(card("Programs Enrolled", [
    table([
      { label: "Program", key: "name" },
      { label: "Fee", align: "right", render: (r) => naira(r.fee) },
      { label: "Session", key: "session" },
      { label: "Term", key: "term" },
      { label: "Status", key: "status" }
    ], rows, { empty: "No programs assigned." })
  ], canManageFees(ctx?.user?.role || "") ? btn("Edit Programs", { sm: true, variant: "primary", onclick: () => editProgramsModal(studentId, ctx, () => renderProgramsPane(pane, studentId, ctx)) }) : null));
}

function editProgramsModal(studentId, ctx, refresh) {
  const s = db.get("students", studentId);
  const primary = cfg.programForSection(s.sectionId);
  const selected = new Set(cfg.studentProgramIds(s));
  const checks = [];
  const body = el("div");
  body.appendChild(el("p", { class: "muted", text: "Add or remove programs. Saving updates the current term program-fee invoice automatically." }));
  cfg.programs({ activeOnly: false, session: "", term: "" }).forEach((p) => {
    const cb = input({ type: "checkbox" });
    cb.checked = selected.has(p.id);
    cb.disabled = primary && p.id === primary.id;
    checks.push({ p, cb });
    body.appendChild(el("label", { class: "svc-row", style: "cursor:pointer" }, [
      cb,
      el("span", { class: "nm", text: `${p.name}${primary && p.id === primary.id ? " (Primary)" : ""}` }),
      el("span", { class: "amt", text: naira(p.fee) })
    ]));
  });
  const m = modal({
    title: `Programs Enrolled - ${s.fullName}`,
    size: "md",
    body,
    footer: [btn("Save Programs", {
      variant: "primary",
      onclick: async () => {
        const ids = checks.filter(({ cb }) => cb.checked).map(({ p }) => p.id);
        if (primary && !ids.includes(primary.id)) ids.unshift(primary.id);
        s.programIds = [...new Set(ids)];
        s.programs = s.programIds;
        s.programNames = s.programIds.map((id) => cfg.programName(id));
        s.history = s.history || [];
        s.history.push({ type: "programs", at: Date.now(), by: ctx.user.email, note: `Programs updated: ${s.programNames.join(", ")}` });
        db.save("students", s);
        const inv = await syncStudentProgramInvoice(s, { term: cfg.currentTerm(), session: cfg.currentSession() });
        if (inv) syncFeeUpdate(studentId, inv.id, ctx, "Program assignment updated");
        toast("Program assignment updated", "success");
        m.close();
        refresh();
      }
    })]
  });
}

function renderFeesPane(pane, s, invoices, totalBilled, totalPaid) {
  pane.innerHTML = "";
  const totalOutstanding = totalBilled - totalPaid;
  const totalScholarship = invoices.reduce((a, i) => a + num(i.scholarship), 0);
  const totalDiscount = invoices.reduce((a, i) => a + num(i.discount), 0);

  // Account summary stats
  const stats = [
    ["🧾 Total Billed", naira(totalBilled), ""],
    ["💵 Total Paid", naira(totalPaid), "green"],
    ["⚠️ Outstanding", naira(totalOutstanding), totalOutstanding > 0 ? "red" : "green"],
    ["🎓 Scholarship", naira(totalScholarship), "blue"],
    ["🏷️ Discount", naira(totalDiscount), "blue"]
  ];

  const grid = el("div", { class: "grid grid-4", style: "margin-bottom:12px" });
  stats.forEach(([label, value, color]) => {
    grid.appendChild(el("div", { class: "card stat" }, [
      el("div", { class: "v", style: color ? `color:var(--${color === "red" ? "danger" : color === "green" ? "success" : "primary"},#333)` : "", text: value }),
      el("div", { class: "l", text: label })
    ]));
  });
  pane.appendChild(grid);

  pane.appendChild(table([
    { label: "Invoice", key: "invoiceNo" },
    { label: "Type", key: "type" },
    { label: "Session", key: "session" },
    { label: "Term", key: "term" },
    { label: "Total", align: "right", render: (i) => naira(i.totalAmount) },
    { label: "Paid", align: "right", render: (i) => naira(i.amountPaid) },
    { label: "Balance", align: "right", render: (i) => naira(i.balance) },
    {
      label: "Status", html: true,
      render: (i) => `<span class="tag ${i.status === "PAID" ? "green" : i.status === "PARTIALLY PAID" ? "blue" : "red"}">${i.status}</span>`
    },
    { label: "", render: (i) => btn("View", { sm: true, onclick: () => showInvoice(i.id) }) }
  ], invoices, { empty: "No invoices" }));
}

// ─────────────────────────────────────────────────────────────────────────────
// FINANCIAL MANAGEMENT TAB — full admin fee control
// ─────────────────────────────────────────────────────────────────────────────
function renderFinancialManagement(pane, studentId, ctx) {
  pane.innerHTML = "";
  const role = ctx?.user?.role || "";

  if (!canManageFees(role)) {
    pane.appendChild(el("div", {
      class: "empty",
      style: "padding:32px;text-align:center",
      text: "🔒 Only Super Admin, Admin, and Accountant can manage student fees."
    }));
    return;
  }

  const s = db.get("students", studentId);
  const invoices = invoiceForStudent(studentId);

  // ── Student Info Summary ──
  pane.appendChild(el("div", {
    style: "padding:12px 14px;background:var(--surface,#f8fafc);border-radius:8px;margin-bottom:14px;display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;font-size:13px"
  }, [
    el("div", {}, [el("b", { text: "Name: " }), el("span", { text: s.fullName })]),
    el("div", {}, [el("b", { text: "Admission No: " }), el("span", { text: s.admissionNo })]),
    el("div", {}, [el("b", { text: "Class: " }), el("span", { text: `${cfg.sectionName(s.sectionId)} / ${cfg.className(s.classId)}` })]),
    el("div", {}, [el("b", { text: "Parent: " }), el("span", { text: `${s.parentName || "-"} (${s.parentPhone || "-"})` })])
  ]));

  // ── Account Summary Stats ──
  const totalBilled = invoices.reduce((a, i) => a + num(i.totalAmount), 0);
  const totalPaid = invoices.reduce((a, i) => a + num(i.amountPaid), 0);
  const totalOutstanding = invoices.reduce((a, i) => a + num(i.balance), 0);
  const totalScholarship = invoices.reduce((a, i) => a + num(i.scholarship), 0);
  const totalDiscount = invoices.reduce((a, i) => a + num(i.discount), 0);
  const totalGross = invoices.reduce((a, i) => a + num(i.grossAmount || i.totalAmount), 0);

  const summaryGrid = el("div", { class: "grid grid-4", style: "margin-bottom:14px" });
  [
    ["🧾 Total Fees", naira(totalGross), ""],
    ["💵 Total Paid", naira(totalPaid), "green"],
    ["⚠️ Outstanding", naira(totalOutstanding), totalOutstanding > 0 ? "red" : "green"],
    ["🎓 Scholarship", naira(totalScholarship), "blue"],
    ["🏷️ Discount", naira(totalDiscount), "blue"],
    ["📊 Net Due", naira(totalBilled), ""]
  ].forEach(([label, value, color]) => {
    summaryGrid.appendChild(el("div", { class: "card stat" }, [
      el("div", { class: "v", style: color ? `color:var(--${color === "red" ? "danger,#c0392b" : color === "green" ? "success,#2a7d4f" : "primary,#4f46e5"})` : "", text: value }),
      el("div", { class: "l", text: label })
    ]));
  });
  pane.appendChild(summaryGrid);

  // ── Action Buttons ──
  const actionsRow = el("div", {
    class: "row",
    style: "flex-wrap:wrap;gap:8px;margin-bottom:14px;padding:12px;background:var(--surface,#f8fafc);border-radius:8px"
  });
  actionsRow.appendChild(el("div", { style: "width:100%;font-weight:700;font-size:13px;margin-bottom:6px", text: "Admin Fee Actions:" }));

  [
    ["➕ Add Fee", () => feeActionModal_AddFee(studentId, ctx, () => renderFinancialManagement(pane, studentId, ctx))],
    ["✏️ Edit Fee", () => feeActionModal_EditFee(studentId, ctx, () => renderFinancialManagement(pane, studentId, ctx))],
    ["🗑️ Remove Fee", () => feeActionModal_RemoveFee(studentId, ctx, () => renderFinancialManagement(pane, studentId, ctx))],
    ["💰 Adjust Amount", () => feeActionModal_AdjustAmount(studentId, ctx, () => renderFinancialManagement(pane, studentId, ctx))],
    ["📋 Custom Charge", () => feeActionModal_CustomCharge(studentId, ctx, () => renderFinancialManagement(pane, studentId, ctx))],
    ["⚠️ Add Outstanding", () => feeActionModal_AddOutstanding(studentId, ctx, () => renderFinancialManagement(pane, studentId, ctx))],
    ["📅 Add Arrears", () => feeActionModal_AddArrears(studentId, ctx, () => renderFinancialManagement(pane, studentId, ctx))],
    ["🎓 Apply Scholarship", () => feeActionModal_ApplyScholarship(studentId, ctx, () => renderFinancialManagement(pane, studentId, ctx))],
    ["🏷️ Apply Discount", () => feeActionModal_ApplyDiscount(studentId, ctx, () => renderFinancialManagement(pane, studentId, ctx))],
    ["✅ Waive Fee", () => feeActionModal_WaiveFee(studentId, ctx, () => renderFinancialManagement(pane, studentId, ctx))]
  ].forEach(([label, fn]) => {
    actionsRow.appendChild(btn(label, { sm: true, onclick: fn }));
  });
  pane.appendChild(actionsRow);

  // ── Fee Structure Table ──
  pane.appendChild(el("div", { style: "font-weight:700;margin-bottom:8px", text: "Fee Structure (All Invoices)" }));

  if (!invoices.length) {
    pane.appendChild(el("div", { class: "empty", style: "padding:20px", text: "No fee records. Use actions above to add fees or outstanding balances." }));
    return;
  }

  invoices.forEach((inv) => {
    const invHeader = el("div", {
      style: "display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--primary-light,#eef2ff);border-radius:6px 6px 0 0;margin-top:10px"
    }, [
      el("span", { style: "font-weight:600;font-size:13px", text: `${inv.invoiceNo} · ${inv.type} · ${inv.session} ${inv.term}` }),
      el("div", { class: "row", style: "gap:6px" }, [
        el("span", { class: `tag ${inv.status === "PAID" ? "green" : inv.status === "PARTIALLY PAID" ? "blue" : "red"}`, text: inv.status }),
        btn("View", { sm: true, onclick: () => showInvoice(inv.id) }),
        btn("✏️ Edit Invoice", { sm: true, variant: "ghost", onclick: () => editInvoiceFees(inv.id, ctx, () => renderFinancialManagement(pane, studentId, ctx)) })
      ])
    ]);

    const svcTable = table([
      { label: "Description", key: "name" },
      { label: "Type", key: "type" },
      { label: "Amount", align: "right", render: (s) => naira(s.amount) }
    ], inv.services || [], { empty: "No line items" });

    const invFooter = el("div", {
      style: "padding:8px 10px;border:1px solid var(--border);border-top:none;border-radius:0 0 6px 6px;font-size:13px"
    });
    invFooter.innerHTML = `
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px">
        <span>Gross: <b>${naira(inv.grossAmount || inv.totalAmount)}</b></span>
        ${num(inv.scholarship) > 0 ? `<span style="color:var(--success,#2a7d4f)">Scholarship: <b>−${naira(inv.scholarship)}</b></span>` : ""}
        ${num(inv.discount) > 0 ? `<span style="color:#b56b00">Discount: <b>−${naira(inv.discount)}</b></span>` : ""}
        <span>Net Due: <b>${naira(inv.totalAmount)}</b></span>
        <span style="color:var(--success,#2a7d4f)">Paid: <b>${naira(inv.amountPaid)}</b></span>
        <span style="color:${num(inv.balance) > 0 ? "var(--danger,#c0392b)" : "var(--success,#2a7d4f)"}">Balance: <b>${naira(inv.balance)}</b></span>
      </div>`;

    pane.appendChild(invHeader);
    pane.appendChild(svcTable);
    pane.appendChild(invFooter);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FEE HISTORY TAB
// ─────────────────────────────────────────────────────────────────────────────
function renderFeeHistory(pane, studentId) {
  pane.innerHTML = "";
  const invoices = invoiceForStudent(studentId);
  const receipts = db.query("receipts", (r) => r.studentId === studentId).sort((a, b) => b.date - a.date);

  // Build unified history entries
  const history = [];
  invoices.forEach((inv) => {
    history.push({
      date: inv.createdAt,
      invoiceNo: inv.invoiceNo,
      description: `Invoice created: ${inv.type}`,
      amount: inv.totalAmount,
      paid: 0,
      balance: inv.balance,
      status: inv.status,
      type: "invoice"
    });
    (inv.payments || []).forEach((p) => {
      history.push({
        date: p.date,
        invoiceNo: inv.invoiceNo,
        description: "Payment received",
        amount: 0,
        paid: p.amount,
        balance: inv.balance,
        status: "PAYMENT",
        type: "payment"
      });
    });
    if (num(inv.scholarship) > 0) {
      history.push({
        date: inv.createdAt,
        invoiceNo: inv.invoiceNo,
        description: "Scholarship applied",
        amount: 0,
        paid: inv.scholarship,
        balance: inv.balance,
        status: "SCHOLARSHIP",
        type: "scholarship"
      });
    }
    if (num(inv.discount) > 0) {
      history.push({
        date: inv.createdAt,
        invoiceNo: inv.invoiceNo,
        description: "Discount applied",
        amount: 0,
        paid: inv.discount,
        balance: inv.balance,
        status: "DISCOUNT",
        type: "discount"
      });
    }
  });

  history.sort((a, b) => b.date - a.date);

  pane.appendChild(table([
    { label: "Date", render: (h) => fmtDate(h.date) },
    { label: "Invoice No", key: "invoiceNo" },
    { label: "Description", key: "description" },
    {
      label: "Amount", align: "right",
      render: (h) => h.amount > 0 ? el("span", { style: "color:var(--danger,#c0392b)", text: naira(h.amount) }) : el("span", { text: "—" })
    },
    {
      label: "Paid / Applied", align: "right",
      render: (h) => h.paid > 0 ? el("span", { style: "color:var(--success,#2a7d4f)", text: naira(h.paid) }) : el("span", { text: "—" })
    },
    { label: "Balance", align: "right", render: (h) => naira(h.balance) },
    {
      label: "Status", html: true,
      render: (h) => {
        const colors = { PAID: "green", "PARTIALLY PAID": "blue", UNPAID: "red", PAYMENT: "green", SCHOLARSHIP: "blue", DISCOUNT: "blue", invoice: "" };
        return `<span class="tag ${colors[h.status] || ""}">${h.status}</span>`;
      }
    }
  ], history, { empty: "No fee history available." }));
}

// ─────────────────────────────────────────────────────────────────────────────
// FEE ACTION MODALS
// ─────────────────────────────────────────────────────────────────────────────

// Helper: sync all affected collections after any fee change
function syncFeeUpdate(studentId, invoiceId, ctx, note = "Fee updated") {
  const inv = db.get("invoices", invoiceId);
  if (inv) {
    // Recalculate and save invoice
    recalcInvoice(inv);
    // Update family ledger by triggering a family record save
    const s = db.get("students", studentId);
    if (s && s.parentPhone) {
      const fam = familyByPhone(s.parentPhone);
      if (fam) db.save("families", { ...fam, updatedAt: Date.now() });
    }
    // Log activity
    logActivity({
      module: "students",
      action: "fee_update",
      description: `${note} — Student: ${s?.fullName || studentId} | Invoice: ${inv.invoiceNo}`,
      studentId,
      by: ctx?.user?.email || "admin"
    });
    // Update audit log
    db.save("auditLogs", {
      id: `fee-${studentId}-${Date.now()}`,
      type: "fee_modification",
      uid: ctx?.user?.uid || "",
      at: Date.now(),
      message: `${note} — ${s?.fullName || studentId} (${s?.admissionNo || ""}) Invoice: ${inv.invoiceNo}`
    });
  }
}

// ADD FEE — adds a new service line to latest unpaid invoice (or creates one)
async function feeActionModal_AddFee(studentId, ctx, refresh) {
  const s = db.get("students", studentId);
  const invoices = invoiceForStudent(studentId);
  const unpaid = invoices.find((i) => i.balance > 0) || invoices[0];

  const services = cfg.services();
  const feeType = select(() => [
    { value: "", label: "Select fee type…" },
    ...services.map((sv) => ({ value: sv.id, label: sv.name })),
    { value: "__custom__", label: "Custom / Other" }
  ]);
  const feeName = input({ placeholder: "Fee description", value: "" });
  const feeAmount = input({ type: "number", placeholder: "Amount (₦)", value: "" });
  const termSel = select(() => (cfg.sessions().terms || ["First Term", "Second Term", "Third Term"]).map((t) => ({ value: t, label: t, selected: t === cfg.currentTerm() })));
  const sessionSel = input({ value: cfg.currentSession(), placeholder: "Session e.g. 2024/2025" });

  feeType.onchange = () => {
    if (feeType.value && feeType.value !== "__custom__") {
      const sv = services.find((x) => x.id === feeType.value);
      if (sv) {
        feeName.value = sv.name;
        const price = cfg.servicePrice(sv.id, s.sectionId);
        if (price > 0) feeAmount.value = price;
      }
    }
  };

  const body = el("div", { class: "form-grid" }, [
    field("Fee Type", feeType, { full: true }),
    field("Description", feeName, { full: true }),
    field("Amount (₦)", feeAmount),
    field("Term", termSel),
    field("Session", sessionSel)
  ]);

  const m = modal({
    title: `Add Fee — ${s.fullName}`,
    size: "md",
    body,
    footer: [btn("Add Fee", {
      variant: "primary",
      onclick: async () => {
        const name = feeName.value.trim();
        const amount = num(feeAmount.value);
        if (!name) return toast("Enter fee description", "error");
        if (amount <= 0) return toast("Enter valid amount", "error");

        let targetInv = invoices.find((i) =>
          i.term === termSel.value && i.session === sessionSel.value && i.balance > 0
        );

        if (!targetInv) {
          // Create new invoice for this term/session
          targetInv = await createInvoice({
            student: s,
            services: [],
            type: "Fee Addition",
            term: termSel.value
          });
          targetInv.session = sessionSel.value;
        }

        targetInv.services = targetInv.services || [];
        targetInv.services.push({ id: uuid(), name, amount, type: "fee", optional: false });
        recalcInvoice(targetInv);
        syncFeeUpdate(studentId, targetInv.id, ctx, `Added fee: ${name} ${naira(amount)}`);
        toast(`Fee "${name}" added successfully`, "success");
        m.close();
        refresh();
      }
    })]
  });
}

// EDIT FEE — edit a service line on an existing invoice
function feeActionModal_EditFee(studentId, ctx, refresh) {
  const s = db.get("students", studentId);
  const invoices = invoiceForStudent(studentId);
  if (!invoices.length) return toast("No invoices to edit", "error");

  // Build flat list of all service lines across all invoices
  const allLines = [];
  invoices.forEach((inv) => {
    (inv.services || []).forEach((line) => {
      allLines.push({ ...line, _invId: inv.id, _invNo: inv.invoiceNo });
    });
  });

  if (!allLines.length) return toast("No fee lines to edit", "error");

  const lineSel = select(() => allLines.map((l, i) => ({ value: i, label: `${l._invNo} · ${l.name} · ${naira(l.amount)}` })));
  const nameInp = input({ value: allLines[0]?.name || "" });
  const amtInp = input({ type: "number", value: allLines[0]?.amount || 0 });

  lineSel.onchange = () => {
    const line = allLines[parseInt(lineSel.value)];
    if (line) { nameInp.value = line.name; amtInp.value = line.amount; }
  };

  const body = el("div", { class: "form-grid" }, [
    field("Select Fee Line", lineSel, { full: true }),
    field("Description", nameInp, { full: true }),
    field("Amount (₦)", amtInp)
  ]);

  const m = modal({
    title: `Edit Fee — ${s.fullName}`,
    size: "md",
    body,
    footer: [btn("Save Changes", {
      variant: "primary",
      onclick: () => {
        const idx = parseInt(lineSel.value);
        const selectedLine = allLines[idx];
        if (!selectedLine) return;
        const inv = db.get("invoices", selectedLine._invId);
        if (!inv) return;
        const lineIdx = inv.services.findIndex((l) => l.id === selectedLine.id);
        if (lineIdx === -1) return;
        const newName = nameInp.value.trim();
        const newAmt = num(amtInp.value);
        if (!newName || newAmt <= 0) return toast("Enter valid values", "error");
        inv.services[lineIdx].name = newName;
        inv.services[lineIdx].amount = newAmt;
        recalcInvoice(inv);
        syncFeeUpdate(studentId, inv.id, ctx, `Edited fee: ${newName} → ${naira(newAmt)}`);
        toast("Fee updated", "success");
        m.close();
        refresh();
      }
    })]
  });
}

// REMOVE FEE — remove a service line from an invoice
function feeActionModal_RemoveFee(studentId, ctx, refresh) {
  const s = db.get("students", studentId);
  const invoices = invoiceForStudent(studentId);
  const editable = invoices.filter((i) => i.amountPaid === 0);
  if (!editable.length) return toast("Only unpaid invoices can have fees removed", "error");

  const allLines = [];
  editable.forEach((inv) => {
    (inv.services || []).forEach((line) => {
      allLines.push({ ...line, _invId: inv.id, _invNo: inv.invoiceNo });
    });
  });
  if (!allLines.length) return toast("No fee lines to remove", "error");

  const lineSel = select(() => allLines.map((l, i) => ({ value: i, label: `${l._invNo} · ${l.name} · ${naira(l.amount)}` })));
  const body = el("div", { class: "form-grid" }, [
    field("Select Fee to Remove", lineSel, { full: true }),
    el("div", { style: "color:var(--danger,#c0392b);font-size:13px;padding:8px 0", text: "⚠️ Only fees on unpaid invoices can be removed." })
  ]);

  const m = modal({
    title: `Remove Fee — ${s.fullName}`,
    size: "sm",
    body,
    footer: [btn("Remove Fee", {
      variant: "danger",
      onclick: async () => {
        const ok = await confirmDialog("Remove this fee line? This cannot be undone.", { okText: "Remove", danger: true });
        if (!ok) return;
        const idx = parseInt(lineSel.value);
        const selectedLine = allLines[idx];
        const inv = db.get("invoices", selectedLine._invId);
        if (!inv) return;
        inv.services = inv.services.filter((l) => l.id !== selectedLine.id);
        recalcInvoice(inv);
        syncFeeUpdate(studentId, inv.id, ctx, `Removed fee: ${selectedLine.name}`);
        toast("Fee removed", "success");
        m.close();
        refresh();
      }
    })]
  });
}

// ADJUST AMOUNT — directly set a fee line amount
function feeActionModal_AdjustAmount(studentId, ctx, refresh) {
  const s = db.get("students", studentId);
  const invoices = invoiceForStudent(studentId);
  const allLines = [];
  invoices.forEach((inv) => {
    (inv.services || []).forEach((line) => allLines.push({ ...line, _invId: inv.id, _invNo: inv.invoiceNo }));
  });
  if (!allLines.length) return toast("No fee lines to adjust", "error");

  const lineSel = select(() => allLines.map((l, i) => ({ value: i, label: `${l._invNo} · ${l.name} · ${naira(l.amount)}` })));
  const newAmt = input({ type: "number", placeholder: "New amount (₦)" });
  const reason = input({ placeholder: "Reason for adjustment" });

  lineSel.onchange = () => { newAmt.value = allLines[parseInt(lineSel.value)]?.amount || ""; };
  newAmt.value = allLines[0]?.amount || "";

  const body = el("div", { class: "form-grid" }, [
    field("Select Fee", lineSel, { full: true }),
    field("New Amount (₦)", newAmt),
    field("Reason", reason, { full: true })
  ]);

  const m = modal({
    title: `Adjust Fee Amount — ${s.fullName}`,
    size: "md",
    body,
    footer: [btn("Adjust", {
      variant: "primary",
      onclick: () => {
        const idx = parseInt(lineSel.value);
        const line = allLines[idx];
        const inv = db.get("invoices", line._invId);
        const amount = num(newAmt.value);
        if (amount <= 0) return toast("Enter valid amount", "error");
        const li = inv.services.find((l) => l.id === line.id);
        if (li) li.amount = amount;
        recalcInvoice(inv);
        syncFeeUpdate(studentId, inv.id, ctx, `Adjusted ${line.name}: ${naira(line.amount)} → ${naira(amount)} (${reason.value})`);
        toast("Amount adjusted", "success");
        m.close();
        refresh();
      }
    })]
  });
}

// CUSTOM CHARGE — add a completely custom charge
async function feeActionModal_CustomCharge(studentId, ctx, refresh) {
  const s = db.get("students", studentId);
  const chargeNameInp = input({ placeholder: "e.g. Lab breakage fee, Excursion fee…" });
  const chargeAmt = input({ type: "number", placeholder: "Amount (₦)" });
  const termSel = select(() => (cfg.sessions().terms || ["First Term", "Second Term", "Third Term"]).map((t) => ({ value: t, label: t, selected: t === cfg.currentTerm() })));
  const noteInp = input({ placeholder: "Internal note (optional)" });

  const body = el("div", { class: "form-grid" }, [
    field("Charge Description", chargeNameInp, { full: true }),
    field("Amount (₦)", chargeAmt),
    field("Term", termSel),
    field("Note", noteInp, { full: true })
  ]);

  const m = modal({
    title: `Add Custom Charge — ${s.fullName}`,
    size: "md",
    body,
    footer: [btn("Add Charge", {
      variant: "primary",
      onclick: async () => {
        const name = chargeNameInp.value.trim();
        const amount = num(chargeAmt.value);
        if (!name) return toast("Enter charge description", "error");
        if (amount <= 0) return toast("Enter valid amount", "error");

        const invoices = invoiceForStudent(studentId);
        let targetInv = invoices.find((i) => i.term === termSel.value && i.balance > 0);
        if (!targetInv) {
          targetInv = await createInvoice({ student: s, services: [], type: "Custom Charge", term: termSel.value });
        }
        targetInv.services = targetInv.services || [];
        targetInv.services.push({ id: uuid(), name, amount, type: "custom", optional: false, note: noteInp.value });
        recalcInvoice(targetInv);
        syncFeeUpdate(studentId, targetInv.id, ctx, `Custom charge: ${name} ${naira(amount)}`);
        toast(`Custom charge "${name}" added`, "success");
        m.close();
        refresh();
      }
    })]
  });
}

// ADD OUTSTANDING BALANCE — for migrated students or manual entries
async function feeActionModal_AddOutstanding(studentId, ctx, refresh) {
  const s = db.get("students", studentId);
  const descInp = input({ value: "Outstanding balance from previous session", placeholder: "Description" });
  const amtInp = input({ type: "number", placeholder: "Amount (₦)" });
  const sessionInp = input({ value: cfg.currentSession(), placeholder: "Session e.g. 2023/2024" });
  const termSel = select(() => (cfg.sessions().terms || ["First Term", "Second Term", "Third Term"]).map((t) => ({ value: t, label: t, selected: t === cfg.currentTerm() })));
  const noteInp = textarea({ placeholder: "Additional notes…", rows: 2, style: "width:100%;resize:vertical" });

  const body = el("div", { class: "form-grid" }, [
    field("Description", descInp, { full: true }),
    field("Outstanding Amount (₦)", amtInp),
    field("Session", sessionInp),
    field("Term", termSel),
    field("Notes", noteInp, { full: true }),
    el("div", { style: "font-size:12px;color:var(--muted);padding:8px 0", text: "An invoice will be auto-generated for this outstanding balance." })
  ]);

  const m = modal({
    title: `Add Outstanding Balance — ${s.fullName}`,
    size: "md",
    body,
    footer: [btn("Add Outstanding", {
      variant: "primary",
      onclick: async () => {
        const amount = num(amtInp.value);
        const desc = descInp.value.trim() || "Outstanding Balance";
        if (amount <= 0) return toast("Enter valid amount", "error");

        const inv = await createInvoice({
          student: s,
          services: [{ id: uuid(), name: desc, amount, type: "outstanding", optional: false }],
          type: "Outstanding Balance",
          term: termSel.value
        });
        inv.session = sessionInp.value;
        inv.notes = noteInp.value;
        db.save("invoices", inv);
        syncFeeUpdate(studentId, inv.id, ctx, `Added outstanding: ${desc} ${naira(amount)}`);
        toast(`Outstanding balance of ${naira(amount)} added and invoice generated`, "success");
        m.close();
        refresh();
      }
    })]
  });
}

// ADD ARREARS — previous term unpaid amounts
async function feeActionModal_AddArrears(studentId, ctx, refresh) {
  const s = db.get("students", studentId);
  const prevTermSel = select(() => [
    { value: "First Term", label: "First Term Arrears" },
    { value: "Second Term", label: "Second Term Arrears" },
    { value: "Third Term", label: "Third Term Arrears" }
  ]);
  const prevSessionInp = input({ placeholder: "e.g. 2023/2024" });
  const amtInp = input({ type: "number", placeholder: "Arrears amount (₦)" });
  const noteInp = input({ placeholder: "Note (optional)" });

  const body = el("div", { class: "form-grid" }, [
    field("Previous Term", prevTermSel),
    field("Previous Session", prevSessionInp),
    field("Arrears Amount (₦)", amtInp),
    field("Note", noteInp, { full: true })
  ]);

  const m = modal({
    title: `Add Arrears — ${s.fullName}`,
    size: "md",
    body,
    footer: [btn("Add Arrears", {
      variant: "primary",
      onclick: async () => {
        const amount = num(amtInp.value);
        if (amount <= 0) return toast("Enter valid arrears amount", "error");
        if (!prevSessionInp.value.trim()) return toast("Enter previous session", "error");
        const desc = `Arrears — ${prevTermSel.value} ${prevSessionInp.value}`;
        const inv = await createInvoice({
          student: s,
          services: [{ id: uuid(), name: desc, amount, type: "arrears", optional: false }],
          type: "Arrears",
          term: cfg.currentTerm()
        });
        inv.arrearsSession = prevSessionInp.value;
        inv.arrearsTerm = prevTermSel.value;
        inv.notes = noteInp.value;
        db.save("invoices", inv);
        syncFeeUpdate(studentId, inv.id, ctx, `Added arrears: ${desc} ${naira(amount)}`);
        toast(`Arrears of ${naira(amount)} added`, "success");
        m.close();
        refresh();
      }
    })]
  });
}

// APPLY SCHOLARSHIP — directly apply to an invoice
function feeActionModal_ApplyScholarship(studentId, ctx, refresh) {
  const s = db.get("students", studentId);
  const invoices = invoiceForStudent(studentId).filter((i) => i.status !== "PAID");
  if (!invoices.length) return toast("No unpaid invoices to apply scholarship to", "error");

  const invSel = select(() => invoices.map((i) => ({ value: i.id, label: `${i.invoiceNo} · ${i.term} · Balance: ${naira(i.balance)}` })));
  const scholarshipPlans = db.list("scholarships").filter((s) => s.status === "Active");
  const planSel = select(() => [
    { value: "", label: "Select scholarship plan…" },
    ...scholarshipPlans.map((p) => ({ value: p.id, label: `${p.name} (${p.valueType === "percent" ? p.value + "%" : naira(p.value)})` })),
    { value: "__manual__", label: "Manual amount" }
  ]);
  const manualAmt = input({ type: "number", placeholder: "Manual scholarship amount (₦)", style: "display:none" });
  const reasonInp = input({ placeholder: "Reason / approval note" });

  planSel.onchange = () => { manualAmt.style.display = planSel.value === "__manual__" ? "" : "none"; };

  const body = el("div", { class: "form-grid" }, [
    field("Invoice", invSel, { full: true }),
    field("Scholarship Plan", planSel, { full: true }),
    field("Manual Amount (₦)", manualAmt),
    field("Reason", reasonInp, { full: true })
  ]);

  const m = modal({
    title: `Apply Scholarship — ${s.fullName}`,
    size: "md",
    body,
    footer: [btn("Apply Scholarship", {
      variant: "primary",
      onclick: () => {
        const inv = db.get("invoices", invSel.value);
        if (!inv) return;
        let amount = 0;
        let name = "Scholarship";
        if (planSel.value === "__manual__") {
          amount = num(manualAmt.value);
        } else if (planSel.value) {
          const plan = db.get("scholarships", planSel.value);
          if (plan) {
            name = plan.name;
            amount = plan.valueType === "percent"
              ? Math.round(num(inv.grossAmount || inv.totalAmount) * plan.value / 100)
              : num(plan.value);
          }
        }
        if (amount <= 0) return toast("Enter valid scholarship amount", "error");
        inv.scholarship = num(inv.scholarship || 0) + amount;
        inv.scholarshipBreakdown = inv.scholarshipBreakdown || [];
        inv.scholarshipBreakdown.push({ name, amount, appliedBy: ctx?.user?.email, appliedAt: Date.now(), reason: reasonInp.value });
        recalcInvoice(inv);
        syncFeeUpdate(studentId, inv.id, ctx, `Applied scholarship: ${name} ${naira(amount)}`);
        toast(`Scholarship of ${naira(amount)} applied`, "success");
        m.close();
        refresh();
      }
    })]
  });
}

// APPLY DISCOUNT
function feeActionModal_ApplyDiscount(studentId, ctx, refresh) {
  const s = db.get("students", studentId);
  const invoices = invoiceForStudent(studentId).filter((i) => i.status !== "PAID");
  if (!invoices.length) return toast("No unpaid invoices to apply discount to", "error");

  const invSel = select(() => invoices.map((i) => ({ value: i.id, label: `${i.invoiceNo} · ${i.term} · Balance: ${naira(i.balance)}` })));
  const discountPlans = db.list("discounts").filter((d) => d.status === "Active");
  const planSel = select(() => [
    { value: "", label: "Select discount plan…" },
    ...discountPlans.map((p) => ({ value: p.id, label: `${p.name} (${p.valueType === "percent" ? p.value + "%" : naira(p.value)})` })),
    { value: "__manual__", label: "Manual amount" }
  ]);
  const manualAmt = input({ type: "number", placeholder: "Manual discount (₦)", style: "display:none" });
  const reasonInp = input({ placeholder: "Reason for discount" });

  planSel.onchange = () => { manualAmt.style.display = planSel.value === "__manual__" ? "" : "none"; };

  const body = el("div", { class: "form-grid" }, [
    field("Invoice", invSel, { full: true }),
    field("Discount Plan", planSel, { full: true }),
    field("Manual Amount (₦)", manualAmt),
    field("Reason", reasonInp, { full: true })
  ]);

  const m = modal({
    title: `Apply Discount — ${s.fullName}`,
    size: "md",
    body,
    footer: [btn("Apply Discount", {
      variant: "primary",
      onclick: () => {
        const inv = db.get("invoices", invSel.value);
        if (!inv) return;
        let amount = 0;
        let name = "Discount";
        if (planSel.value === "__manual__") {
          amount = num(manualAmt.value);
        } else if (planSel.value) {
          const plan = db.get("discounts", planSel.value);
          if (plan) {
            name = plan.name;
            amount = plan.valueType === "percent"
              ? Math.round(num(inv.grossAmount || inv.totalAmount) * plan.value / 100)
              : num(plan.value);
          }
        }
        if (amount <= 0) return toast("Enter valid discount amount", "error");
        inv.discount = num(inv.discount || 0) + amount;
        inv.discountBreakdown = inv.discountBreakdown || [];
        inv.discountBreakdown.push({ name, amount, appliedBy: ctx?.user?.email, appliedAt: Date.now(), reason: reasonInp.value });
        recalcInvoice(inv);
        syncFeeUpdate(studentId, inv.id, ctx, `Applied discount: ${name} ${naira(amount)}`);
        toast(`Discount of ${naira(amount)} applied`, "success");
        m.close();
        refresh();
      }
    })]
  });
}

// WAIVE FEE — mark entire invoice or selected balance as waived
function feeActionModal_WaiveFee(studentId, ctx, refresh) {
  const s = db.get("students", studentId);
  const invoices = invoiceForStudent(studentId).filter((i) => i.balance > 0);
  if (!invoices.length) return toast("No outstanding invoices to waive", "error");

  const invSel = select(() => invoices.map((i) => ({ value: i.id, label: `${i.invoiceNo} · Balance: ${naira(i.balance)}` })));
  const waiveType = select(() => [
    { value: "full", label: "Waive entire outstanding balance" },
    { value: "partial", label: "Waive partial amount" }
  ]);
  const partialAmt = input({ type: "number", placeholder: "Amount to waive (₦)", style: "display:none" });
  const reasonInp = input({ placeholder: "Reason for waiver (required)" });

  waiveType.onchange = () => { partialAmt.style.display = waiveType.value === "partial" ? "" : "none"; };

  const body = el("div", { class: "form-grid" }, [
    field("Invoice", invSel, { full: true }),
    field("Waiver Type", waiveType, { full: true }),
    field("Partial Amount (₦)", partialAmt),
    field("Reason (Required)", reasonInp, { full: true }),
    el("div", { style: "font-size:12px;color:var(--danger,#c0392b);padding:8px 0", text: "⚠️ Waiving is a permanent adjustment. Ensure proper authorization before proceeding." })
  ]);

  const m = modal({
    title: `Waive Fee — ${s.fullName}`,
    size: "md",
    body,
    footer: [btn("Apply Waiver", {
      variant: "danger",
      onclick: async () => {
        const reason = reasonInp.value.trim();
        if (!reason) return toast("Reason is required for waiver", "error");
        const inv = db.get("invoices", invSel.value);
        if (!inv) return;
        const ok = await confirmDialog(`Apply fee waiver to Invoice ${inv.invoiceNo}? This permanently reduces the balance.`, { okText: "Apply Waiver", danger: true });
        if (!ok) return;
        const waivedAmount = waiveType.value === "full" ? inv.balance : Math.min(num(partialAmt.value), inv.balance);
        if (waivedAmount <= 0) return toast("Enter valid waiver amount", "error");
        inv.discount = num(inv.discount || 0) + waivedAmount;
        inv.discountBreakdown = inv.discountBreakdown || [];
        inv.discountBreakdown.push({ name: `Fee Waiver — ${reason}`, amount: waivedAmount, appliedBy: ctx?.user?.email, appliedAt: Date.now(), reason });
        recalcInvoice(inv);
        syncFeeUpdate(studentId, inv.id, ctx, `Fee waiver applied: ${naira(waivedAmount)} — ${reason}`);
        toast(`Fee waiver of ${naira(waivedAmount)} applied`, "success");
        m.close();
        refresh();
      }
    })]
  });
}

// EDIT INVOICE FEES — inline editing of all invoice service lines
export function editInvoiceFees(invoiceId, ctx, refresh) {
  const inv = db.get("invoices", invoiceId);
  if (!inv) return toast("Invoice not found", "error");

  const services = [...(inv.services || [])];
  let currentScholarship = num(inv.scholarship);
  let currentDiscount = num(inv.discount);

  const qaContainer = el("div", { style: "margin-top:15px; border-top:1px solid var(--border); padding-top:10px" });
  let markPaidOnSave = false;
  
  const renderQA = () => {
    qaContainer.innerHTML = "";
    const liveGross = services.reduce((a, s) => a + num(s.amount), 0);
    const liveTotal = Math.max(0, liveGross - currentScholarship - currentDiscount);
    const liveBalance = Math.max(0, liveTotal - num(inv.amountPaid));

    if (liveBalance > 0) {
      qaContainer.appendChild(el("div", { style: "font-size:12px; font-weight:bold; margin-bottom:6px; color:var(--muted)" }, "Quick Actions"));
      const acts = el("div", { style: "display:flex; gap:8px; align-items:center; flex-wrap:wrap" });
      
      acts.appendChild(btn("Cover Balance with Scholarship", {
        sm: true, variant: "outline",
        onclick: () => { currentScholarship += liveBalance; renderDeductions(); }
      }));

      const paidCb = input({ type: "checkbox", checked: markPaidOnSave });
      paidCb.onchange = () => { markPaidOnSave = paidCb.checked; };
      acts.appendChild(el("label", { style: "display:flex; gap:4px; align-items:center; cursor:pointer; font-size:13px; margin-left:10px;" }, [
        paidCb, el("span", {}, "Mark remaining balance as Paid upon saving")
      ]));

      qaContainer.appendChild(acts);
    } else {
      markPaidOnSave = false;
    }
  };

  const renderLines = (container) => {
    container.innerHTML = "";
    if (!services.length) {
      container.appendChild(el("div", { class: "empty", text: "No fee lines. Add one below." }));
      return;
    }
    services.forEach((line, i) => {
      const nameInp = input({ value: line.name });
      const amtInp = input({ type: "number", value: line.amount, style: "width:120px" });
      const removeBtn = btn("🗑️", {
        sm: true,
        variant: "ghost",
        attrs: { style: "color:#c0392b" },
        onclick: () => { services.splice(i, 1); renderLines(container); }
      });
      nameInp.oninput = () => { services[i].name = nameInp.value; };
      amtInp.oninput = () => { services[i].amount = num(amtInp.value); renderQA(); };
      container.appendChild(el("div", {
        style: "display:flex;gap:8px;align-items:center;margin-bottom:8px"
      }, [nameInp, amtInp, el("span", { style: "font-size:12px;color:var(--muted)", text: "₦" }), removeBtn]));
    });
    renderQA();
  };

  const linesContainer = el("div");
  renderLines(linesContainer);

  const addLineBtn = btn("+ Add Line", {
    sm: true,
    variant: "ghost",
    onclick: () => {
      services.push({ id: uuid(), name: "", amount: 0, type: "fee", optional: false });
      renderLines(linesContainer);
    }
  });

  const deductionsContainer = el("div", { style: "margin-top:15px; border-top:1px solid var(--border); padding-top:10px" });
  const renderDeductions = () => {
    deductionsContainer.innerHTML = "";
    if (currentScholarship > 0 || currentDiscount > 0) {
      deductionsContainer.appendChild(el("div", { style: "font-size:12px; font-weight:bold; margin-bottom:6px; color:var(--muted)" }, "Scholarships & Discounts"));
      if (currentScholarship > 0) {
        deductionsContainer.appendChild(el("div", { style: "display:flex; justify-content:space-between; margin-bottom:4px; align-items:center" }, [
          el("span", {}, `Scholarship Applied: ${naira(currentScholarship)}`),
          btn("Remove", { sm: true, variant: "danger", onclick: () => { currentScholarship = 0; renderDeductions(); } })
        ]));
      }
      if (currentDiscount > 0) {
        deductionsContainer.appendChild(el("div", { style: "display:flex; justify-content:space-between; margin-bottom:4px; align-items:center" }, [
          el("span", {}, `Discount Applied: ${naira(currentDiscount)}`),
          btn("Remove", { sm: true, variant: "danger", onclick: () => { currentDiscount = 0; renderDeductions(); } })
        ]));
      }
    }
    renderQA();
  };
  renderDeductions();

  const student = db.get("students", inv.studentId);
  const primary = student ? cfg.programForSection(student.sectionId || "") : null;
  const selectedPrograms = new Set(student ? cfg.studentProgramIds(student) : []);
  const programChecks = [];
  const progContainer = el("div", { style: "margin-top:15px; border-top:1px solid var(--border); padding-top:10px" });

  if (student) {
    progContainer.appendChild(el("div", { style: "font-size:12px; font-weight:bold; margin-bottom:6px; color:var(--muted)" }, "Programs Enrolled"));
    cfg.programs({ activeOnly: false, session: "", term: "" }).forEach((p) => {
      const cb = input({ type: "checkbox" });
      cb.checked = selectedPrograms.has(p.id);
      cb.disabled = primary && p.id === primary.id;
      
      cb.onchange = () => {
        if (cb.checked) {
           if (!services.find(x => x.name === p.name)) {
               services.push({ id: uuid(), name: p.name, amount: num(p.fee), type: "program", optional: false });
           }
        } else {
           const idx = services.findIndex(x => x.name === p.name);
           if (idx >= 0) services.splice(idx, 1);
        }
        renderLines(linesContainer);
      };
      
      programChecks.push({ p, cb });
      progContainer.appendChild(el("label", { class: "svc-row", style: "cursor:pointer; display:flex; gap:8px; align-items:center; margin-bottom:4px;" }, [
        cb,
        el("span", { class: "nm" }, `${p.name}${primary && p.id === primary.id ? " (Primary)" : ""}`),
        el("span", { class: "amt", style: "margin-left:auto" }, naira(p.fee))
      ]));
    });
  }

  const body = el("div", {}, [
    el("div", { style: "font-size:13px;color:var(--muted);margin-bottom:10px", text: `Editing: ${inv.invoiceNo} · ${inv.type} · ${inv.term}` }),
    linesContainer,
    addLineBtn,
    student ? progContainer : null,
    deductionsContainer,
    qaContainer
  ]);

  const m = modal({
    title: "Edit Invoice Fee Lines",
    size: "md",
    body,
    footer: [btn("Save Changes", {
      variant: "primary",
      onclick: async () => {
        inv.services = services.filter((l) => l.name && l.amount >= 0);
        inv.scholarship = currentScholarship;
        inv.discount = currentDiscount;
        if (currentScholarship === 0) inv.scholarshipBreakdown = [];
        if (currentDiscount === 0) inv.discountBreakdown = [];
        recalcInvoice(inv);
        syncFeeUpdate(inv.studentId, inv.id, ctx, `Invoice ${inv.invoiceNo} fee lines edited`);
        
        if (markPaidOnSave && inv.balance > 0) {
           await applyPayment(inv, { amount: inv.balance, paymentType: "Full Payment", cashier: ctx?.user?.name || "" });
        }
        
        if (student) {
           const ids = programChecks.filter(({ cb }) => cb.checked).map(({ p }) => p.id);
           if (primary && !ids.includes(primary.id)) ids.unshift(primary.id);
           student.programIds = [...new Set(ids)];
           student.programs = student.programIds;
           student.programNames = student.programIds.map((id) => cfg.programName(id));
           db.save("students", student);
        }

        toast("Invoice fees updated", "success");
        m.close();
        refresh();
      }
    })]
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// BULK ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

function bulkPrint(students) {
  if (!students.length) return toast("No students selected", "error");
  const html = students.map((s) => `
    <div style="page-break-inside:avoid;margin-bottom:16px;padding:12px;border:1px solid #ddd;border-radius:6px">
      <b>${s.fullName}</b> — ${s.admissionNo}<br>
      ${cfg.sectionName(s.sectionId)} / ${cfg.className(s.classId)}<br>
      Parent: ${s.parentName || "-"} | Phone: ${s.parentPhone || "-"}
    </div>`).join("");
  printHtml(`<html><body style="font-family:sans-serif;padding:20px"><h2>Student List — ${students.length} Records</h2>${html}</body></html>`, { title: "Student List" });
}

async function bulkGenerateInvoices(students, ctx) {
  if (!students.length) return toast("No students selected", "error");
  const termSel = select(() => (cfg.sessions().terms || ["First Term", "Second Term", "Third Term"]).map((t) => ({ value: t, label: t, selected: t === cfg.currentTerm() })));
  const body = el("div", { class: "form-grid" }, [
    el("p", { style: "color:var(--muted);margin-bottom:8px", text: `Generate invoices for ${students.length} selected student(s).` }),
    field("Term", termSel)
  ]);
  const m = modal({
    title: "Bulk Generate Invoices",
    size: "sm",
    body,
    footer: [btn("Generate", {
      variant: "primary",
      onclick: async () => {
        let count = 0;
        let skipped = 0;
        for (const s of students) {
          const services = cfg.servicesForSection(s.sectionId).map((sv) => ({
            id: sv.id, name: sv.name, amount: cfg.servicePrice(sv.id, s.sectionId), type: "fee", optional: false
          }));
          if (services.length) {
            try {
              await createInvoice({ student: s, services, type: "Term Invoice", term: termSel.value });
              count++;
            } catch (e) {
              if (e.code === "duplicate-invoice") skipped++;
              else throw e;
            }
          }
        }
        toast(`${count} invoice(s) generated. ${skipped} duplicate(s) skipped.`, "success");
        m.close();
      }
    })]
  });
}

function bulkIDCards(students) {
  if (!students.length) return toast("No students selected", "error");
  const html = bulkIdCardsHtml(students);
  const m = modal({
    title: `Bulk ID Cards (${students.length})`,
    size: "lg",
    body: el("div", { class: "doc-preview", html }),
    footer: [
      btn("Print Preview", { onclick: () => printHtml(html, { title: "Bulk Student ID Cards" }) }),
      btn("PDF Download", { onclick: () => downloadPdf(html, { title: "Bulk Student ID Cards", filename: "Bulk_Student_ID_Cards.pdf" }) }),
      btn("Close", { variant: "primary", onclick: () => m.close() })
    ]
  });
}

function bulkIdCardsHtml(students) {
  const pages = [];
  for (let i = 0; i < students.length; i += 8) pages.push(students.slice(i, i + 8));
  return `${pages.map((page) => `<div class="id-card-sheet">
    ${page.map((student) => `<div class="id-card-slot">${idCardDoc(student)}</div>`).join("")}
    ${Array.from({ length: Math.max(0, 8 - page.length) }, () => `<div></div>`).join("")}
  </div>`).join("")}`;
}

async function bulkPromote(students, ctx) {
  if (!students.length) return toast("No students selected", "error");
  
  const promoMap = cfg.promotionPaths() || {};
  const allClasses = cfg.classes(); // Returns all active classes sorted by order

  const body = el("div", { class: "form-grid" }, [
    el("p", { style: "color:var(--muted)" }, [el("span", { text: `You are about to automatically promote ${students.length} student(s) based on your configured Promotion Paths and Class Ladder.` })])
  ]);

  const m = modal({
    title: "Bulk Auto-Promote Students",
    size: "sm",
    body,
    footer: [btn("Run Promotion", {
      variant: "primary",
      onclick: async () => {
        const ok = await confirmDialog(`Auto-promote ${students.length} student(s)?`, { okText: "Promote" });
        if (!ok) return;
        
        let promoted = 0;
        let graduated = 0;

        students.forEach((s) => {
          let nextClassId = promoMap[s.classId];
          
          if (!nextClassId) {
             // Fallback: move to the next class in the ordered ladder
             const idx = allClasses.findIndex(c => c.id === s.classId);
             if (idx >= 0 && idx < allClasses.length - 1) {
                 nextClassId = allClasses[idx + 1].id;
             }
          }

          s.history = s.history || [];
          
          if (nextClassId && nextClassId !== "graduate") {
            const nextClassInfo = cfg.klass(nextClassId);
            const nextClassName = nextClassInfo ? nextClassInfo.name : nextClassId;
            s.history.push({ type: "promoted", at: Date.now(), by: ctx.user.email, note: `Auto-promoted to ${nextClassName}` });
            s.classId = nextClassId;
            if (nextClassInfo) s.sectionId = nextClassInfo.sectionId;
            promoted++;
          } else {
            // No next class found in path or ladder -> Graduate
            s.history.push({ type: "graduated", at: Date.now(), by: ctx.user.email, note: `Graduated from ${cfg.className(s.classId)}` });
            s.status = "Graduated";
            graduated++;
          }
          db.save("students", s);
        });
        
        toast(`Promotion complete. Promoted: ${promoted}, Graduated: ${graduated}`, "success");
        m.close();
      }
    })]
  });
}

function bulkExportExcel(students) {
  if (!students.length) return toast("No students selected", "error");
  const header = ["Admission No", "Name", "Section", "Class", "Gender", "Parent Name", "Parent Phone", "Status"].join(",");
  const rows = students.map((s) => [
    s.admissionNo, `"${s.fullName}"`, cfg.sectionName(s.sectionId), cfg.className(s.classId),
    s.gender || "", `"${s.parentName || ""}"`, s.parentPhone || "", s.status || "active"
  ].join(","));
  const csv = [header, ...rows].join("\n");
  const a = document.createElement("a");
  a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  a.download = `students_${Date.now()}.csv`;
  a.click();
  toast("Excel (CSV) exported", "success");
}

function bulkExportPDF(students) {
  if (!students.length) return toast("No students selected", "error");
  const rows = students.map((s, i) => `
    <tr style="background:${i % 2 === 0 ? "#f9f9f9" : "#fff"}">
      <td>${i + 1}</td>
      <td>${s.admissionNo}</td>
      <td><b>${s.fullName}</b></td>
      <td>${cfg.sectionName(s.sectionId)}</td>
      <td>${cfg.className(s.classId)}</td>
      <td>${s.parentPhone || "-"}</td>
      <td>${s.status || "active"}</td>
    </tr>`).join("");
  printHtml(`<html><head><style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 8px;font-size:12px}th{background:#4f46e5;color:#fff}</style></head><body>
    <h2 style="margin-bottom:4px">Student List</h2>
    <p style="color:#888;margin-bottom:12px">${students.length} student(s) · Exported ${new Date().toLocaleDateString()}</p>
    <table><thead><tr><th>#</th><th>Adm No</th><th>Name</th><th>Section</th><th>Class</th><th>Parent Phone</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody></table></body></html>`, { title: "Students Export" });
}

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH PANE
// ─────────────────────────────────────────────────────────────────────────────
function renderHealthPane(pane, s) {
  pane.innerHTML = "";
  const h = s.healthConditions || {};
  const hasAny = Object.values(h).some(v => v && String(v).trim());
  if (!hasAny) {
    pane.appendChild(el("div", { class: "empty", style: "padding:24px", text: "No health information recorded for this student." }));
    pane.appendChild(el("div", { style: "text-align:center;margin-top:8px" }, [
      btn("Add Health Info", { variant: "primary", onclick: () => editHealthModal(s.id) })
    ]));
    return;
  }
  const rows = [
    ["Blood Group", h.bloodGroup], ["Genotype", h.genotype],
    ["Known Allergies", h.allergies], ["Disabilities / Special Needs", h.disabilities],
    ["Chronic Conditions", h.chronicConditions], ["Current Medications", h.medications],
    ["Emergency Contact", h.emergencyContact], ["Additional Notes", h.additionalNotes],
    ["Recorded By", h.recordedBy], ["Recorded At", h.recordedAt ? fmtDate(h.recordedAt) : ""]
  ].filter(([, v]) => v && String(v).trim());

  const infoDiv = el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:10px 20px;padding:8px 0" });
  rows.forEach(([label, value]) => {
    infoDiv.appendChild(el("div", { style: "font-size:13px" }, [
      el("div", { style: "color:var(--muted,#888);font-size:11px;text-transform:uppercase;letter-spacing:0.5px", text: label }),
      el("div", { style: "font-weight:600;margin-top:2px", text: String(value) })
    ]));
  });
  pane.appendChild(infoDiv);
  pane.appendChild(el("div", { style: "margin-top:12px;text-align:right" }, [
    btn("Edit Health Info", { sm: true, variant: "ghost", onclick: () => editHealthModal(s.id) })
  ]));
}

function showHealthModal(id) {
  const s = db.get("students", id);
  const body = el("div");
  renderHealthPane(body, s);
  modal({ title: `Health Info — ${s.fullName}`, size: "md", body });
}

function editHealthModal(id) {
  const s = db.get("students", id);
  const h = s.healthConditions || {};
  const bloodGroup = select(() => ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(v => ({ value: v, label: v || "Blood Group", selected: h.bloodGroup === v })));
  const genotype = select(() => ["", "AA", "AS", "SS", "AC", "SC"].map(v => ({ value: v, label: v || "Genotype", selected: h.genotype === v })));
  const allergies = input({ value: h.allergies || "", placeholder: "Known allergies" });
  const disabilities = input({ value: h.disabilities || "", placeholder: "Disabilities / Special needs" });
  const chronicConditions = textarea({ rows: 2, placeholder: "Chronic conditions…", style: "width:100%;resize:vertical" });
  if (h.chronicConditions) chronicConditions.value = h.chronicConditions;
  const medications = textarea({ rows: 2, placeholder: "Current medications…", style: "width:100%;resize:vertical" });
  if (h.medications) medications.value = h.medications;
  const emergencyContact = input({ value: h.emergencyContact || "", placeholder: "Emergency contact name & phone" });
  const additionalNotes = textarea({ rows: 2, placeholder: "Additional health notes…", style: "width:100%;resize:vertical" });
  if (h.additionalNotes) additionalNotes.value = h.additionalNotes;
  const body = el("div", { class: "form-grid" }, [
    field("Blood Group", bloodGroup), field("Genotype", genotype),
    field("Known Allergies", allergies), field("Disabilities / Special Needs", disabilities),
    field("Chronic Conditions", chronicConditions, { full: true }),
    field("Current Medications", medications, { full: true }),
    field("Emergency Contact", emergencyContact, { full: true }),
    field("Additional Notes", additionalNotes, { full: true })
  ]);
  const m = modal({
    title: `Edit Health Info — ${s.fullName}`,
    size: "lg",
    body,
    footer: [btn("Save", {
      variant: "primary",
      onclick: () => {
        s.healthConditions = {
          bloodGroup: bloodGroup.value, genotype: genotype.value,
          allergies: allergies.value.trim(), disabilities: disabilities.value.trim(),
          chronicConditions: chronicConditions.value.trim(), medications: medications.value.trim(),
          emergencyContact: emergencyContact.value.trim(), additionalNotes: additionalNotes.value.trim(),
          recordedBy: s.healthConditions?.recordedBy || "",
          updatedBy: (window.__ctx?.user?.email || ""),
          recordedAt: s.healthConditions?.recordedAt || Date.now(),
          updatedAt: Date.now()
        };
        db.save("students", s);
        toast("Health information updated", "success");
        m.close();
      }
    })]
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EDIT / TRANSFER / SUSPEND / GRADUATE / DELETE
// ─────────────────────────────────────────────────────────────────────────────
function editStudent(id, ctx) {
  const s = db.get("students", id);
  const fullName = input({ value: s.fullName || "" });
  const gender = select(() => ["", "Male", "Female"].map((g) => ({ value: g, label: g || "Gender", selected: s.gender === g })));
  const dob = input({ type: "date", value: s.dob || "" });
  const parentName = input({ value: s.parentName || "" });
  const parentPhone = input({ value: s.parentPhone || "" });
  const address = input({ value: s.address || "" });
  const passportPrev = el("div", { class: "passport-drop" });
  passportPrev.innerHTML = s.passport ? `<img src="${s.passport}">` : "Upload Passport";
  const fileInp = input({ type: "file", accept: "image/*", style: "display:none" });
  passportPrev.onclick = () => fileInp.click();
  let newPassport = null;
  fileInp.onchange = async () => {
    if (fileInp.files[0]) { newPassport = await resizeImageAsDataURL(fileInp.files[0]); passportPrev.innerHTML = `<img src="${newPassport}">`; }
  };

  let _pendingFingerprint = null;
  const enrollBtn = btn("Enroll Fingerprint", { variant: "secondary", onclick: async () => {
    if (!confirm(`Are you ready to enroll this student's fingerprint? They will need to scan their finger 4 times.`)) return;
    
    toast("Connecting to DigitalPersona service...", "info");
    const isAvail = await fingerprintServiceAvailable();
    if (!isAvail) return toast("Hardware scanner service not available.", "error");
    
    enrollBtn.disabled = true;
    enrollBtn.textContent = "Scanning...";
    toast("Please place finger on the scanner 4 times...", "warning");
    try {
      const res = await enrollFingerprint();
      if (!res.success) throw new Error(res.error || "Capture failed");
      _pendingFingerprint = res.template;
      enrollBtn.textContent = "Fingerprint Enrolled \u2713";
      enrollBtn.style.backgroundColor = "var(--success)";
      enrollBtn.style.color = "white";
    } catch (err) {
      toast(err.message, "error");
      enrollBtn.textContent = "Enroll Fingerprint";
    }
    enrollBtn.disabled = false;
  }});

  const body = el("div", {}, [el("div", { class: "row", style: "align-items:flex-start;gap:16px" }, [
    el("div", {}, [field("Passport", passportPrev), fileInp, el("div", { style: "margin-top:16px" }, [enrollBtn])]),
    el("div", { class: "form-grid", style: "flex:1" }, [
      field("Full Name", fullName), field("Gender", gender), field("DOB", dob),
      field("Parent Name", parentName), field("Parent Phone", parentPhone), field("Address", address)
    ])
  ])]);
  const m = modal({
    title: "Edit Student",
    size: "lg",
    body,
    footer: [btn("Save", {
      variant: "primary",
      onclick: () => {
        Object.assign(s, { fullName: fullName.value, gender: gender.value, dob: dob.value, parentName: parentName.value, parentPhone: parentPhone.value, address: address.value });
        if (newPassport) s.passport = newPassport;
        db.save("students", s);
        
        if (_pendingFingerprint) {
          db.save("fingerprints", { id: uuid(), ownerId: s.id, role: "student", template: _pendingFingerprint, createdAt: Date.now() });
        }
        
        toast("Student updated", "success");
        m.close();
        if (typeof render === "function") render();
      }
    })]
  });
}

function transfer(id, ctx) {
  const s = db.get("students", id);
  const secSel = select(() => cfg.sections().map((x) => ({ value: x.id, label: x.name, selected: x.id === s.sectionId })));
  const clsSel = select(() => cfg.classes(s.sectionId).map((k) => ({ value: k.id, label: k.name, selected: k.id === s.classId })));
  secSel.onchange = () => {
    clsSel.innerHTML = "";
    cfg.classes(secSel.value).forEach((k) => clsSel.appendChild(el("option", { value: k.id, text: k.name })));
  };
  const body = el("div", { class: "form-grid" }, [field("Section", secSel), field("Class", clsSel)]);
  const m = modal({
    title: "Transfer Student",
    size: "sm",
    body,
    footer: [btn("Transfer", {
      variant: "primary",
      onclick: () => {
        s.history = s.history || [];
        s.history.push({ type: "transfer", at: Date.now(), by: ctx.user.email, note: `Moved to ${cfg.sectionName(secSel.value)} / ${cfg.className(clsSel.value)}` });
        s.sectionId = secSel.value;
        s.classId = clsSel.value;
        db.save("students", s);
        toast("Transferred", "success");
        m.close();
      }
    })]
  });
}

function readmit(id, ctx) {
    const s = db.get("students", id);
    const secSel = select(() => cfg.sections().map((x) => ({ value: x.id, label: x.name, selected: x.id === s.sectionId })));
    const clsSel = select(() => cfg.classes(s.sectionId).map((k) => ({ value: k.id, label: k.name, selected: k.id === s.classId })));
    secSel.onchange = () => {
      clsSel.innerHTML = "";
      cfg.classes(secSel.value).forEach((k) => clsSel.appendChild(el("option", { value: k.id, text: k.name })));
    };
    const body = el("div", { class: "form-grid" }, [field("New Section", secSel), field("New Class", clsSel)]);
    const m = modal({
      title: "Re-admit Graduated Student",
      size: "sm",
      body,
      footer: [btn("Re-admit", {
        variant: "primary",
        onclick: () => {
          s.history = s.history || [];
          s.history.push({ type: "readmitted", at: Date.now(), by: ctx.user.email, note: `Re-admitted to ${cfg.sectionName(secSel.value)} / ${cfg.className(clsSel.value)}` });
          s.sectionId = secSel.value;
          s.classId = clsSel.value;
          s.status = "active";
          db.save("students", s);
          toast("Student Re-admitted successfully", "success");
          m.close();
        }
      })]
    });
}

async function toggleSuspend(id, ctx) {
  const s = db.get("students", id);
  const suspend = s.status !== "suspended";
  if (suspend && !(await confirmDialog(`Suspend ${s.fullName}?`, { danger: true, okText: "Suspend" }))) return;
  s.status = suspend ? "suspended" : "active";
  s.history = s.history || [];
  s.history.push({ type: s.status, at: Date.now(), by: ctx.user.email, note: suspend ? "Suspended" : "Reinstated" });
  db.save("students", s);
  toast(suspend ? "Suspended" : "Reinstated", "success");
}

async function graduate(id, ctx) {
  const s = db.get("students", id);
  if (!(await confirmDialog(`Graduate ${s.fullName}? They will be archived.`, { okText: "Graduate" }))) return;
  s.status = "graduated";
  s.history = s.history || [];
  s.history.push({ type: "graduated", at: Date.now(), by: ctx.user.email, note: "Graduated" });
  db.save("students", s);
  toast("Student graduated", "success");
}

async function deleteStudent(id, ctx) {
  const s = db.get("students", id);
  if (!s) return toast("Student not found", "error");
  const confirmed = await confirmDialog(
    `Permanently delete "${s.fullName}" (${s.admissionNo})?\n\nThis will remove ALL related data: invoices, receipts, results, attendance, scholarships, discounts, activities, and the student record itself. This action CANNOT be undone.`,
    { title: "Delete Student — Permanent Action", okText: "Delete Permanently", danger: true }
  );
  if (!confirmed) return;
  const studentLinkedCollections = [
    "invoices", "receipts", "results", "attendance", "behaviour",
    "assignments", "cbtAttempts", "activities", "paymentVouchers",
    "studentScholarships", "studentDiscounts", "idCards", "promotionLogs"
  ];
  let deletedCount = 0;
  studentLinkedCollections.forEach((col) => {
    db.query(col, (r) => r.studentId === id).forEach((r) => { db.delete(col, r.id); deletedCount++; });
  });
  db.query("familyLedger", (e) => e.studentId === id).forEach((e) => { db.delete("familyLedger", e.id); deletedCount++; });
  db.query("families", (f) => (f.studentIds || []).includes(id)).forEach((fam) => {
    const remaining = (fam.studentIds || []).filter((sid) => sid !== id);
    if (remaining.length === 0) { db.delete("families", fam.id); deletedCount++; }
    else { fam.studentIds = remaining; db.save("families", fam); }
  });
  db.save("auditLogs", {
    id: "del-" + id + "-" + Date.now(),
    type: "student_deleted",
    uid: ctx.user.uid,
    at: Date.now(),
    message: `Deleted student ${s.fullName} (${s.admissionNo}) — ${deletedCount} related records removed`
  });
  db.delete("students", id);
  toast(`Student "${s.fullName}" and all related data deleted.`, "success", 5000);
}

// ─────────────────────────────────────────────────────────────────────────────
// DUPLICATE DETECTION
// ─────────────────────────────────────────────────────────────────────────────
function showDuplicates(ctx) {
  const allStudents = db.list("students");
  const groups = {};
  allStudents.forEach((s) => {
    const key = (s.fullName || "").toLowerCase().trim().replace(/\s+/g, " ");
    if (!key) return;
    if (!groups[key]) groups[key] = [];
    groups[key].push(s);
  });
  const duplicates = Object.values(groups).filter((g) => g.length > 1);
  if (duplicates.length === 0) {
    modal({ title: "No Duplicates Found", size: "sm", body: el("p", { class: "muted", style: "padding:12px 0", text: "✅ All student names are unique. No duplicates detected." }) });
    return;
  }
  const body = el("div");
  body.appendChild(el("p", { class: "muted", style: "margin-bottom:12px", text: `Found ${duplicates.length} group(s) with duplicate names.` }));
  duplicates.forEach((group) => {
    const groupDiv = el("div", { style: "border:1px solid var(--border,#e2e8f0);border-radius:8px;padding:12px;margin-bottom:12px" });
    groupDiv.appendChild(el("div", { style: "font-weight:700;margin-bottom:8px;font-size:14px", text: `"${group[0].fullName}" — ${group.length} records` }));
    group.forEach((s) => {
      const row = el("div", { style: "display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border,#f0f0f0)" });
      row.appendChild(el("div", { style: "font-size:13px" }, [
        el("div", { html: `<b>${s.admissionNo}</b> &nbsp; ${cfg.sectionName(s.sectionId)} / ${cfg.className(s.classId)} &nbsp; <span class="tag ${s.status === "active" ? "green" : "red"}" style="font-size:11px">${s.status || "active"}</span>` }),
        el("div", { style: "color:var(--muted,#888);font-size:11px", text: `Admitted: ${fmtDate(s.admissionDate) || "-"}  |  Parent: ${s.parentPhone || "-"}` })
      ]));
      const delBtn = btn("Delete", { sm: true, variant: "ghost", attrs: { style: "color:#c0392b;flex-shrink:0" }, onclick: async () => {
        const ok = await confirmDialog(`Delete "${s.fullName}" (${s.admissionNo})? All data will be removed.`, { title: "Delete Duplicate", okText: "Delete", danger: true });
        if (!ok) return;
        await deleteStudent(s.id, ctx);
        row.remove();
      }});
      row.setAttribute && row.setAttribute("data-sid", s.id);
      row.appendChild(delBtn);
      groupDiv.appendChild(row);
    });
    body.appendChild(groupDiv);
  });
  modal({ title: `Duplicate Students (${duplicates.length} groups)`, size: "lg", body });
}

function manageIslamiyyaTahfizPlacements(ctx) {
  const islSecs = cfg.sections().filter(s => s.type === "islamiyya");
  const tahSecs = cfg.sections().filter(s => s.type === "tahfiz");

  let islClasses = [];
  islSecs.forEach(s => islClasses.push(...cfg.classes(s.id)));
  
  let tahClasses = [];
  tahSecs.forEach(s => tahClasses.push(...cfg.classes(s.id)));

  let students = [];
  function refreshStudentData() {
    students = db.list("students").filter(s => s.status !== "graduated" && s.status !== "suspended");
    students = students.filter(s => {
      let hasIsl = false;
      let hasTah = false;
      const progs = (s.programIds || []).map(pid => cfg.program(pid) || { id: pid, sectionId: pid }).filter(Boolean);
      progs.forEach(p => {
        const sec = cfg.section(p.sectionId) || cfg.section(p.id);
        if (sec && sec.type === "islamiyya") hasIsl = true;
        if (sec && sec.type === "tahfiz") hasTah = true;
      });
      const mainSec = cfg.section(s.sectionId);
      if (mainSec && mainSec.type === "islamiyya") hasIsl = true;
      if (mainSec && mainSec.type === "tahfiz") hasTah = true;
      
      s._hasIsl = hasIsl;
      s._hasTah = hasTah;
      return hasIsl || hasTah;
    });
  }
  refreshStudentData();

  const localSel = new BulkSelection();
  
  let searchTerm = "";
  const searchInput = el("input", {
    type: "search",
    placeholder: "Search students by name or admission no...",
    style: "width:300px; padding:6px 10px; border-radius:4px; border:1px solid var(--border);",
    oninput: (e) => {
      searchTerm = e.target.value.toLowerCase();
      renderTable();
    }
  });
  
  const m = modal({
    title: "Islamiyya & Tahfiz Placements",
    full: true,
    body: el("div", {}, [
      el("p", { class: "muted", text: "Select students below to assign them to specific Islamiyya or Tahfiz classes without changing their main Western class." }),
      bulkActionBar(localSel, [
        { label: "Set Islamiyya Class", action: (ids) => {
            const cSel = select(() => [{value: "", label: "-- Clear Class --"}, ...islClasses.map(c => ({value: c.id, label: c.name}))]);
            let m2;
            const applyBtn = btn("Apply", { variant: "primary", onclick: () => {
              ids.forEach(id => {
                const st = db.get("students", id);
                if (st) {
                  st.islamiyyaClassId = cSel.value;
                  db.save("students", st);
                }
              });
              toast("Islamiyya class updated for " + ids.length + " students", "success");
              if (m2) m2.close();
              refreshStudentData();
              renderTable();
              localSel.clear();
            }});
            m2 = modal({
              title: "Set Islamiyya Class",
              body: el("div", {}, [el("p", {text: "Select class:"}), cSel]),
              footer: [applyBtn]
            });
        }},
        { label: "Set Tahfiz Class", action: (ids) => {
            const cSel = select(() => [{value: "", label: "-- Clear Class --"}, ...tahClasses.map(c => ({value: c.id, label: c.name}))]);
            let m2;
            const applyBtn = btn("Apply", { variant: "primary", onclick: () => {
              ids.forEach(id => {
                const st = db.get("students", id);
                if (st) {
                  st.tahfizClassId = cSel.value;
                  db.save("students", st);
                }
              });
              toast("Tahfiz class updated for " + ids.length + " students", "success");
              if (m2) m2.close();
              refreshStudentData();
              renderTable();
              localSel.clear();
            }});
            m2 = modal({
              title: "Set Tahfiz Class",
              body: el("div", {}, [el("p", {text: "Select class:"}), cSel]),
              footer: [applyBtn]
            });
        }},
        { label: "❌ Remove Islamiyya", action: (ids) => {
            ids.forEach(id => {
              const st = db.get("students", id);
              if (st) {
                const islProgIds = cfg.programs().filter(p => cfg.section(p.sectionId)?.type === "islamiyya" || p.id === "islamiyya" || p.sectionId === "islamiyya").map(p => p.id);
                islProgIds.push("islamiyya");
                st.programIds = (st.programIds || []).filter(pid => !islProgIds.includes(pid));
                st.programs = (st.programs || []).filter(pid => !islProgIds.includes(pid));
                st.programNames = (st.programNames || []).filter(pn => !pn.toLowerCase().includes("islamiyya"));
                st.islamiyyaClassId = "";
                db.save("students", st);
              }
            });
            toast("Removed " + ids.length + " students from Islamiyya", "success");
            refreshStudentData();
            renderTable();
            localSel.clear();
        }},
        { label: "❌ Remove Tahfiz", action: (ids) => {
            ids.forEach(id => {
              const st = db.get("students", id);
              if (st) {
                const tahProgIds = cfg.programs().filter(p => cfg.section(p.sectionId)?.type === "tahfiz" || p.id === "tahfiz" || p.sectionId === "tahfiz").map(p => p.id);
                tahProgIds.push("tahfiz");
                st.programIds = (st.programIds || []).filter(pid => !tahProgIds.includes(pid));
                st.programs = (st.programs || []).filter(pid => !tahProgIds.includes(pid));
                st.programNames = (st.programNames || []).filter(pn => !pn.toLowerCase().includes("tahfiz"));
                st.tahfizClassId = "";
                db.save("students", st);
              }
            });
            toast("Removed " + ids.length + " students from Tahfiz", "success");
            refreshStudentData();
            renderTable();
            localSel.clear();
        }}
      ]),
      el("div", { style: "display:flex; justify-content:space-between; align-items:center; margin-top:14px; margin-bottom:14px;" }, [
        searchInput
      ]),
      el("div", { id: "islTahTableWrap" })
    ])
  });
  
  function renderTable() {
    const wrap = m.body.querySelector("#islTahTableWrap");
    wrap.innerHTML = "";
    
    let displayStudents = students;
    if (searchTerm) {
      displayStudents = students.filter(s => 
        localSel.has(s.id) || 
        (s.fullName || "").toLowerCase().includes(searchTerm) || 
        (s.admissionNo || "").toLowerCase().includes(searchTerm)
      );
    }
    
    const tbl = table([
      { label: "", type: "checkbox" },
      { label: "Admission No", key: "admissionNo" },
      { label: "Name", key: "fullName" },
      { label: "Main Class", render: s => cfg.className(s.classId) },
      { label: "Islamiyya Class", render: s => s._hasIsl ? (s.islamiyyaClassId ? cfg.className(s.islamiyyaClassId) : el("span", { class: "muted", text: "Not Assigned" })) : "N/A" },
      { label: "Tahfiz Class", render: s => s._hasTah ? (s.tahfizClassId ? cfg.className(s.tahfizClassId) : el("span", { class: "muted", text: "Not Assigned" })) : "N/A" }
    ], displayStudents, { selection: localSel });
    wrap.appendChild(tbl);
  }
  
  renderTable();
}
