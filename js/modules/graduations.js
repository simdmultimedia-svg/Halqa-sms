import { db } from "../core/db.js";
import { lazyListen } from "../core/adapter.js";
import { el, toast, todayISO } from "../core/utils.js";
import { card, pageHead, table, btn, select, field } from "../core/ui.js";
import * as cfg from "../core/config.js";
import { printHtml } from "../core/print.js";

export function render(root, ctx) {
  lazyListen("students");
  root.appendChild(pageHead("Graduated Students (Alumni)", "Manage graduated students, print lists, and re-admit them."));

  const content = el("div");
  root.appendChild(content);

  const filterRow = el("div", { class: "row card", style: "gap: 10px; margin-bottom: 20px; align-items:flex-end;" });
  const secFilter = select(() => [{ value: "", label: "All Sections" }, ...cfg.sections().map((s) => ({ value: s.id, label: s.name }))]);
  const clsFilter = select(() => [{ value: "", label: "All Classes" }]);
  const searchInp = el("input", { class: "inp", placeholder: "Search Name or ID...", oninput: draw });

  function refreshClasses() {
    clsFilter.innerHTML = '<option value="">All Classes</option>';
    if (secFilter.value) {
      cfg.classes(secFilter.value).forEach((k) => clsFilter.appendChild(el("option", { value: k.id, text: k.name })));
    }
  }

  secFilter.onchange = () => { refreshClasses(); draw(); };
  clsFilter.onchange = draw;

  filterRow.appendChild(field("Section (Last Attended)", secFilter));
  filterRow.appendChild(field("Class (Last Attended)", clsFilter));
  filterRow.appendChild(field("Search", searchInp));

  const printBtn = btn("Print Alumni List", { variant: "primary", onclick: printList });
  filterRow.appendChild(printBtn);

  content.appendChild(filterRow);

  const tableContainer = el("div");
  content.appendChild(tableContainer);

  function draw() {
    tableContainer.innerHTML = "";
    
    let students = db.query("students", s => s.status === "graduated" || s.status === "Graduated");
    
    if (secFilter.value) students = students.filter(s => cfg.studentInSection(s, secFilter.value));
    if (clsFilter.value) students = students.filter(s => cfg.studentInClass(s, clsFilter.value));
    if (searchInp.value) {
      const q = searchInp.value.toLowerCase();
      students = students.filter(s => (s.fullName || "").toLowerCase().includes(q) || (s.admissionNo || "").toLowerCase().includes(q));
    }

    if (!students.length) {
      tableContainer.appendChild(el("p", { class: "muted", text: "No graduated students found matching your filters." }));
      return;
    }

    const header = ["Admission No.", "Full Name", "Gender", "Last Class", "Contact", "Action"];
    const rows = students.map(s => [
      s.admissionNo,
      s.fullName,
      s.gender,
      cfg.className(s.classId) || "-",
      s.parentPhone || s.phone || "-",
      btn("Re-admit", { sm: true, onclick: () => readmit(s.id) })
    ]);

    tableContainer.appendChild(table(header, rows));
  }

  function printList() {
    let html = `<h2>Graduated Students (Alumni)</h2>
    <table border="1" style="width:100%; border-collapse: collapse;">
      <thead>
        <tr style="background:#f5f5f5;"><th>S/N</th><th>Adm. No.</th><th>Full Name</th><th>Gender</th><th>Last Class</th><th>Phone</th></tr>
      </thead>
      <tbody>`;
    
    let students = db.query("students", s => s.status === "graduated" || s.status === "Graduated");
    if (secFilter.value) students = students.filter(s => cfg.studentInSection(s, secFilter.value));
    if (clsFilter.value) students = students.filter(s => cfg.studentInClass(s, clsFilter.value));

    students.forEach((s, i) => {
      html += `<tr><td>${i+1}</td><td>${s.admissionNo||""}</td><td>${s.fullName||""}</td><td>${s.gender||""}</td><td>${cfg.className(s.classId)||""}</td><td>${s.parentPhone||s.phone||""}</td></tr>`;
    });
    
    html += `</tbody></table>`;
    printHtml(html);
  }

  function readmit(id) {
    const s = db.get("students", id);
    const secSel = select(() => cfg.sections().map((x) => ({ value: x.id, label: x.name, selected: x.id === s.sectionId })));
    const clsSel = select(() => cfg.classes(s.sectionId).map((k) => ({ value: k.id, label: k.name, selected: k.id === s.classId })));
    
    secSel.onchange = () => {
      clsSel.innerHTML = "";
      cfg.classes(secSel.value).forEach((k) => clsSel.appendChild(el("option", { value: k.id, text: k.name })));
    };
    
    const body = el("div", { class: "form-grid" }, [field("New Section", secSel), field("New Class", clsSel)]);
    
    // Inline modal implementation
    const overlay = el("div", { 
        style: "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:9999; display:flex; justify-content:center; align-items:center;" 
    });

    const box = el("div", { class: "card", style: "width: 400px; padding: 20px; display:flex; flex-direction:column; gap:20px; background:#fff;" });
    
    const header = el("h3", { text: "Re-admit Graduated Student: " + s.fullName, style: "margin:0;" });
    box.appendChild(header);
    box.appendChild(body);

    const footer = el("div", { style: "display:flex; justify-content:flex-end; gap:10px;" });
    const cancelBtn = btn("Cancel", { variant: "outline", onclick: () => document.body.removeChild(overlay) });
    const confirmBtn = btn("Re-admit", {
      variant: "primary",
      onclick: () => {
        s.history = s.history || [];
        s.history.push({ type: "readmitted", at: Date.now(), by: ctx.user.email, note: `Re-admitted to ${cfg.sectionName(secSel.value)} / ${cfg.className(clsSel.value)}` });
        s.sectionId = secSel.value;
        s.classId = clsSel.value;
        s.status = "active";
        db.save("students", s);
        toast("Student Re-admitted successfully", "success");
        document.body.removeChild(overlay);
        draw();
      }
    });

    footer.appendChild(confirmBtn);
    footer.appendChild(cancelBtn);
    box.appendChild(footer);
    
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  const off = db.on("students", draw);
  draw();
  return () => off();
}
