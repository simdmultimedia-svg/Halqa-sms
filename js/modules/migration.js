import { db } from "../core/db.js";
import { el, toast, naira, num, todayISO, download, uuid, modal } from "../core/utils.js";
import { card, pageHead, field, input, select, btn, textarea, table } from "../core/ui.js";
import * as cfg from "../core/config.js";
import { nextAdmissionId, nextStudentId, nextInvoiceNo } from "../core/idgen.js";

export function render(root, ctx) {
  root.appendChild(pageHead("Migration", "Import existing students. Migration transfers records and automatically creates brought-forward invoices for pending balances."));

  const tabs = el("div", { class: "row", style: "margin-bottom:14px" }, [
    btn("Single Import", { variant: "primary", onclick: () => single() }),
    btn("Quick Paste", { onclick: () => quickPaste() }),
    btn("Bulk Import (CSV)", { onclick: () => bulk() }),
    btn("Review Center", { variant: "warning", onclick: () => reviewCenter() })
  ]);
  root.appendChild(tabs);

  const host = el("div");
  root.appendChild(host);
  single();

  function sectionSel(onchange) {
    const s = select(() => [{ value: "", label: "Select Section" }, ...cfg.sections().map((x) => ({ value: x.id, label: x.name }))]);
    s.onchange = onchange; return s;
  }

  function single() {
    host.innerHTML = "";
    const c = card("Migrate Existing Student");
    const fullName = input({ placeholder: "Full Name" });
    const sec = sectionSel(() => { clsSel.innerHTML = ""; cfg.classes(sec.value).forEach((k) => clsSel.appendChild(el("option", { value: k.id, text: k.name }))); });
    const clsSel = select(() => []);
    const gender = select(() => ["", "Male", "Female"].map((g) => ({ value: g, label: g || "Gender" })));
    const parentName = input({ placeholder: "Parent Name" });
    const parentPhone = input({ placeholder: "Parent Phone" });
    const payStatus = select(() => [{ value: "Fully Paid", label: "Fully Paid" }, { value: "Pending Balance", label: "Pending Balance" }]);
    const balance = input({ type: "number", value: "0", placeholder: "Pending balance" });
    const grid = el("div", { class: "form-grid" }, [
      field("Full Name", fullName), field("Gender", gender),
      field("Section", sec), field("Class", clsSel),
      field("Parent Name", parentName), field("Parent Phone", parentPhone),
      field("Payment Status", payStatus), field("Pending Balance (₦)", balance)
    ]);
    c.appendChild(grid);
    const save = btn("Migrate Student", {
      variant: "success", onclick: async () => {
        if (!fullName.value.trim() || !sec.value || !clsSel.value) return toast("Name, section and class are required", "error");
        await migrate({
          fullName: fullName.value.trim(), gender: gender.value, sectionId: sec.value, classId: clsSel.value,
          parentName: parentName.value, parentPhone: parentPhone.value,
          payStatus: payStatus.value, balance: num(balance.value)
        }, ctx);
        toast("Student migrated", "success");
        single();
      }
    });
    c.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [save]));
    host.appendChild(c);

    // recent migrations
    const recent = db.query("students", (s) => s.admissionType === "Migrated").sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
    if (recent.length) host.appendChild(card("Recently Migrated", [el("div", {}, recent.map((s) =>
      el("div", { class: "svc-row" }, [el("span", { class: "nm", text: `${s.fullName} — ${s.admissionNo}` }),
      el("span", { class: "muted", text: cfg.className(s.classId) })])))]));
  }

  function quickPaste() {
    host.innerHTML = "";
    const c = card("Quick List Import");

    const sec = sectionSel(() => {
      clsSel.innerHTML = "";
      clsSel.appendChild(el("option", { value: "", text: "Select Class" }));
      cfg.classes(sec.value).forEach((k) => clsSel.appendChild(el("option", { value: k.id, text: k.name })));
    });
    const clsSel = select(() => [{ value: "", label: "Select Class" }]);

    const ta = textarea({ rows: 10, placeholder: "Paste student names here (one name per line)\nExample:\nAudu Musa\nAisha Ibrahim\nJohn Doe" });

    c.appendChild(el("p", { class: "muted", text: "Select a Section and Class, then paste a list of student names below. The system will automatically generate admission numbers and assign them to the selected class. Since gender and parent info will be missing, they will automatically be routed to the Review Center for completion." }));

    const grid = el("div", { class: "form-grid", style: "margin-bottom: 15px;" }, [
      field("Section", sec), field("Class", clsSel)
    ]);
    c.appendChild(grid);
    c.appendChild(field("Student List (One name per line)", ta, { full: true }));

    const run = btn("Import List", {
      variant: "success", onclick: async () => {
        if (!sec.value || !clsSel.value) return toast("Please select a Section and Class first.", "error");

        const lines = ta.value.split("\n").map(l => l.trim()).filter(Boolean);
        if (!lines.length) return toast("No names provided to import.", "warning");

        const progCard = card("Importing...");
        host.insertBefore(progCard, host.firstChild);
        let ok = 0;

        for (const name of lines) {
          await migrate({
            fullName: name,
            sectionId: sec.value,
            classId: clsSel.value,
            migrationStatus: "needs_review",
            migrationWarnings: ["Missing Gender", "Missing Parent Phone"],
            payStatus: "Fully Paid",
            balance: 0
          }, ctx);
          ok++;
        }

        toast(`Imported ${ok} students. Redirecting to Review Center.`, "success");
        reviewCenter();
      }
    });

    c.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [run]));
    host.appendChild(c);
  }

  function bulk() {
    host.innerHTML = "";

    // Smart vs Strict Toggle
    const modeSelect = select(() => [
      { value: "smart", label: "Smart Import (Import first, fix later)" },
      { value: "strict", label: "Strict Import (Block on any error)" }
    ]);
    modeSelect.style.marginBottom = "15px";

    const c = card("Bulk CSV Import");
    c.appendChild(field("Import Mode", modeSelect));
    c.appendChild(el("p", { class: "muted", text: "Use the template columns: Admission Number, Surname, First Name, Other Name, Gender, Class, Section, Parent Name, Phone, Address." }));
    const ta = textarea({ rows: 8, placeholder: "Admission Number,Surname,First Name,Other Name,Gender,Class,Section,Parent Name,Phone,Address\nCICK/2026/010,Audu,Musa,,Male,JSS 1,Secondary,Garba Audu,08030000000,Kano" });

    const fileInput = el("input", { type: "file", accept: ".csv", style: "display:none" });
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        ta.value = ev.target.result;
        toast("CSV loaded. Please review and click Import All.", "success");
      };
      reader.readAsText(file);
      fileInput.value = ""; // Reset
    };

    c.appendChild(el("div", { class: "row", style: "margin-bottom:10px" }, [
      btn("Upload CSV File", { variant: "primary", onclick: () => fileInput.click() }),
      fileInput,
      btn("Download CSV Template", { onclick: downloadMigrationCsvTemplate }),
      btn("Download Excel Template", { onclick: downloadMigrationExcelTemplate })
    ]));
    c.appendChild(field("CSV Rows", ta, { full: true }));

    const run = btn("Import All", {
      variant: "success", onclick: async () => {
        const lines = ta.value.split("\n").map((l) => l.trim()).filter(Boolean);
        if (!lines.length) return toast("No data to import", "warning");

        const rows = parseMigrationCsv(lines);
        const isStrict = modeSelect.value === "strict";
        const validation = await validateMigrationRows(rows, isStrict);

        if (validation.fatalErrors.length) {
          toast(`Import blocked: ${validation.fatalErrors.length} fatal error(s).`, "error", 8000);
          host.appendChild(card("Fatal Bulk Import Errors", [
            el("div", {}, validation.fatalErrors.map((e) => el("div", { class: "note", style: "margin-bottom:6px;color:var(--danger)", text: e })))
          ]));
          return;
        }

        const proceedImport = async () => {
          const progCard = card("Importing...");
          host.insertBefore(progCard, host.firstChild);
          let ok = 0, needsReview = 0;

          for (const row of validation.rows) {
            await migrate({
              admissionNo: row.admissionNo,
              fullName: [row.surname, row.firstName, row.otherName].filter(Boolean).join(" "),
              gender: row.gender,
              sectionId: row.sectionId,
              classId: row.classId,
              parentName: row.parentName,
              parentPhone: row.phone,
              address: row.address,
              payStatus: "Fully Paid",
              balance: 0,
              migrationStatus: row.warnings.length ? "needs_review" : "valid",
              migrationWarnings: row.warnings
            }, ctx);
            if (row.warnings.length) needsReview++; else ok++;
          }

          progCard.innerHTML = "";
          progCard.appendChild(el("h3", { text: "Import Complete" }));
          progCard.appendChild(el("p", { text: `Imported Successfully: ${ok}` }));
          progCard.appendChild(el("p", { text: `Needs Review: ${needsReview}`, style: "color: var(--warning); font-weight: bold;" }));
          progCard.appendChild(el("p", { text: `Failed: 0` }));
          progCard.appendChild(btn("Go to Review Center", { variant: "warning", onclick: () => reviewCenter() }));
        };

        if (validation.totalWarnings > 0) {
          const warnCard = card("Validation Issues Found", [
            el("p", { text: `${validation.totalWarnings} warning(s) found across ${validation.rows.filter(r => r.warnings.length).length} records.` }),
            el("p", { text: "Records can still be imported and corrected later in the Review Center.", style: "font-weight: bold;" }),
            el("div", { style: "max-height: 200px; overflow-y: auto; background: #fff8e1; padding: 10px; border-radius: 4px; margin-bottom: 10px;" }, validation.rows.flatMap(r => r.warnings.map(w => el("div", { text: `Row ${r.rowNo}: ${w}` })))),
            el("div", { class: "row", style: "gap: 10px;" }, [
              btn("Import Anyway", { variant: "warning", onclick: () => { warnCard.remove(); proceedImport(); } }),
              btn("Cancel", { onclick: () => warnCard.remove() })
            ])
          ]);
          host.insertBefore(warnCard, host.firstChild);
        } else {
          proceedImport();
        }

      }
    });
    c.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [run]));
    host.appendChild(c);
  }

  function reviewCenter() {
    host.innerHTML = "";
    host.appendChild(el("h2", { text: "Migration Review Center", style: "margin-bottom: 10px;" }));
    host.appendChild(el("p", { class: "muted", text: "Fix students with missing or invalid data. Updating their class will automatically route their current invoices properly." }));

    const needsReview = db.list("students").filter(s => s.migrationStatus === "needs_review");

    if (needsReview.length === 0) {
      host.appendChild(card("", [el("p", { text: "All students are valid! No records require review.", style: "color: var(--success); font-weight: bold;" })]));
      return;
    }

    host.appendChild(card(`Records Needing Review (${needsReview.length})`, [
      table([
        { label: "Adm No", key: "admissionNo" },
        { label: "Student", key: "fullName" },
        { label: "Warnings", render: (s) => (s.migrationWarnings || []).join(", ") },
        { label: "", align: "right", render: (s) => btn("Fix Record", { sm: true, variant: "warning", onclick: () => fixModal(s) }) }
      ], needsReview)
    ]));
  }

  function fixModal(student) {
    const sec = sectionSel(() => {
      clsSel.innerHTML = "";
      clsSel.appendChild(el("option", { value: "", text: "Select Class" }));
      cfg.classes(sec.value).forEach((k) => clsSel.appendChild(el("option", { value: k.id, text: k.name })));
    });
    sec.value = student.sectionId !== "pending-section" ? student.sectionId : "";

    const clsSel = select(() => [{ value: "", label: "Select Class" }, ...cfg.classes(sec.value).map((k) => ({ value: k.id, label: k.name }))]);
    clsSel.value = student.classId !== "pending-class" ? student.classId : "";

    const parentPhone = input({ value: student.parentPhone || "", placeholder: "Parent Phone" });
    const gender = select(() => [{ value: "", label: "Gender" }, { value: "Male", label: "Male" }, { value: "Female", label: "Female" }]);
    gender.value = student.gender || "";

    const b = el("div", { class: "form-grid" }, [
      field("Section", sec), field("Class", clsSel),
      field("Parent Phone", parentPhone), field("Gender", gender)
    ]);

    b.appendChild(el("div", { class: "note", style: "margin-top: 10px;", text: `Current Warnings: ${(student.migrationWarnings || []).join(", ")}` }));

    const m = modal({
      title: `Review: ${student.fullName}`,
      body: b,
      footer: [
        btn("Save & Validate", {
          variant: "success", onclick: () => {
            if (!clsSel.value || !sec.value) return toast("Class and Section are required to clear warnings.", "error");

            student.classId = clsSel.value;
            student.sectionId = sec.value;
            student.parentPhone = parentPhone.value;
            student.gender = gender.value;
            student.migrationStatus = "valid";
            student.migrationWarnings = [];
            db.save("students", student);

            // Re-route invoices
            const invs = db.list("invoices").filter(i => i.studentId === student.id);
            invs.forEach(i => {
              i.classId = student.classId;
              i.sectionId = student.sectionId;
              db.save("invoices", i);
            });

            m.close();
            toast("Record validated and invoices routed.", "success");
            reviewCenter(); // Refresh list
          }
        }),
        btn("Cancel", { onclick: () => m.close() })
      ]
    });
  }
}

function downloadMigrationCsvTemplate() {
  const header = "Admission Number,Surname,First Name,Other Name,Gender,Class,Section,Parent Name,Phone,Address\r\n";
  download("KCIS_Migration_Template.csv", header, "text/csv;charset=utf-8");
}

function downloadMigrationExcelTemplate() {
  const cols = ["Admission Number", "Surname", "First Name", "Other Name", "Gender", "Class", "Section", "Parent Name", "Phone", "Address"];
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><table border="1"><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></table></body></html>`;
  download("KCIS_Migration_Template.xls", html, "application/vnd.ms-excel;charset=utf-8");
}

function parseMigrationCsv(lines) {
  // If first line contains "admission number", strip it.
  const body = lines[0]?.toLowerCase().includes("admission number") ? lines.slice(1) : lines;
  return body.map((line, idx) => {
    const cols = line.split(",").map((x) => (x || "").trim());
    return {
      rowNo: idx + 2,
      admissionNo: cols[0],
      surname: cols[1],
      firstName: cols[2],
      otherName: cols[3],
      gender: cols[4],
      className: cols[5],
      sectionName: cols[6],
      parentName: cols[7],
      phone: cols[8],
      address: cols[9]
    };
  });
}

// Fuzzy matches standard names like "JSS 1" -> "JSS1", "Junior Secondary 1" -> "JSS1"
function fuzzyMatch(val, list) {
  if (!val) return null;
  val = val.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Exact sanitized match
  const exact = list.find(x => x.id.toLowerCase().replace(/[^a-z0-9]/g, "") === val || x.name.toLowerCase().replace(/[^a-z0-9]/g, "") === val);
  if (exact) return exact;

  // Try common abbreviations
  const expanded = val.replace("juniorsecondary", "jss").replace("seniorsecondary", "ss").replace("primary", "pri").replace("nursery", "nur");
  return list.find(x => x.id.toLowerCase().replace(/[^a-z0-9]/g, "") === expanded || x.name.toLowerCase().replace(/[^a-z0-9]/g, "") === expanded) || null;
}

async function validateMigrationRows(rows, isStrict) {
  const fatalErrors = [];
  const validRows = [];
  let totalWarnings = 0;

  if (rows.length === 0) {
    fatalErrors.push("File is empty or corrupted.");
    return { fatalErrors, rows: validRows, totalWarnings };
  }

  const existingAdmSet = new Set(db.list("students").map((s) => String(s.admissionNo || "").trim().toLowerCase()).filter(Boolean));
  const seenAdm = new Set();

  const allSections = cfg.sections();
  let allKlasses = [];
  try { allKlasses = db.list("classes") || []; } catch (e) { }

  let missingAdmCounter = 0;

  for (const row of rows) {
    const warnings = [];

    // Auto-generate admission number if missing
    let adm = String(row.admissionNo || "").trim();
    if (!adm) {
      missingAdmCounter++;
      adm = `HALQA/2026/MIG-${String(missingAdmCounter).padStart(3, '0')}`;
      warnings.push(`Auto-generated Admission Number: ${adm}`);
    }

    // Duplicate resolution
    let finalAdm = adm;
    const lowerAdm = adm.toLowerCase();
    if (seenAdm.has(lowerAdm) || existingAdmSet.has(lowerAdm)) {
      finalAdm = `${adm}-DUP-${Math.floor(Math.random() * 1000)}`;
      warnings.push(`Duplicate Admission Number resolved to: ${finalAdm}`);
    }
    seenAdm.add(finalAdm.toLowerCase());

    if (!row.surname && !row.firstName) warnings.push("Missing Student Name");
    if (!row.phone) warnings.push("Missing Parent Phone");
    if (!row.gender) warnings.push("Missing Gender");

    // Intelligent mapping
    let sectionId = "pending-section";
    let classId = "pending-class";

    const matchedSection = fuzzyMatch(row.sectionName, allSections);
    if (matchedSection) {
      sectionId = matchedSection.id;
      const matchedClass = fuzzyMatch(row.className, allKlasses.filter(k => k.sectionId === sectionId));
      if (matchedClass) {
        classId = matchedClass.id;
      } else {
        warnings.push(`Unknown Class "${row.className}" for section "${matchedSection.name}"`);
      }
    } else {
      warnings.push(`Unknown Section "${row.sectionName}"`);
    }

    if (isStrict && warnings.length > 0) {
      fatalErrors.push(`Row ${row.rowNo}: ${warnings.join(", ")}`);
    }

    totalWarnings += warnings.length;
    validRows.push({ ...row, admissionNo: finalAdm, sectionId, classId, warnings });
  }

  return { fatalErrors, rows: validRows, totalWarnings };
}

async function migrate(data, ctx) {
  const admissionNo = data.admissionNo || await nextAdmissionId();
  const studentId = uuid(); // Always safe generate

  const student = db.save("students", {
    fullName: data.fullName || "Unknown Student", gender: data.gender || "", sectionId: data.sectionId, classId: data.classId,
    parentName: data.parentName || "", parentPhone: data.parentPhone || "", address: data.address || "", admissionNo, studentId,
    admissionType: "Migrated", status: "active", admissionDate: todayISO(), session: cfg.currentSession(),
    migrationStatus: data.migrationStatus || "valid", migrationWarnings: data.migrationWarnings || [],
    migration: { payStatus: data.payStatus, balance: num(data.balance) }, createdBy: ctx.user.uid,
    history: [{ type: "migration", at: Date.now(), by: ctx.user.email, note: "Migrated record" }]
  });

  db.save("migrationLogs", { id: "mig-" + student.id, studentId: student.id, admissionNo, at: Date.now(), by: ctx.user.email, payStatus: data.payStatus, balance: num(data.balance) });

  // Only create a brought-forward invoice if there is an outstanding balance.
  if (num(data.balance) > 0) {
    const invoiceNo = await nextInvoiceNo();
    db.save("invoices", {
      id: uuid(), invoiceNo, studentId: student.id, studentName: student.fullName, admissionNo,
      sectionId: student.sectionId, classId: student.classId, session: cfg.currentSession(), term: cfg.currentTerm(),
      type: "Migration B/F", services: [{ id: "bf", name: "Outstanding Balance (Brought Forward)", amount: num(data.balance), type: "fee", optional: false }],
      totalAmount: num(data.balance), discount: 0, scholarship: 0, amountPaid: 0, balance: num(data.balance),
      payments: [], status: "UNPAID",
      createdAt: Date.now(), createdBy: ctx.user.uid,
    });
  }
}

