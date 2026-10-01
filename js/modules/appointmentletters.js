import { db } from "../core/db.js";
import { lazyListen } from "../core/adapter.js";
import { el, toast, todayISO, uuid, naira } from "../core/utils.js";
import { card, pageHead, table, btn, select, input, field } from "../core/ui.js";
import { getBranding } from "../core/branding.js";
import { exportDocumentToPDF } from "../core/print.js";

const DEFAULT_TEMPLATE = `Dear {{staffName}},

We are pleased to offer you employment with {{schoolName}} as {{designation}}.
Your appointment shall take effect from {{appointmentDate}}.
Your monthly salary shall be {{salary}}.

You are expected to carry out all assigned responsibilities professionally and uphold the values and policies of the institution.

Terms and Conditions:
1. Probation Period: You will be subject to a 3-month probation period.
2. Working Hours: As specified in the school handbook.
3. Leave Entitlement: You are entitled to standard statutory leave as approved by management.
4. Termination: Either party may terminate this agreement with 1-month written notice.

Congratulations on your appointment.`;

export function render(root, ctx) {
    lazyListen("staff");
    lazyListen("appointmentLetters");

    root.innerHTML = "";
    root.appendChild(pageHead("Appointment Letters", "Generate, print, and export professional staff appointment letters."));

    const tabsRow = el("div", { class: "row", style: "gap: 10px; margin-bottom: 20px;" });
    const btnList = btn("Letters List", { variant: "primary", onclick: () => showTab('list') });
    const btnGen = btn("Bulk Generator", { variant: "outline", onclick: () => showTab('gen') });
    const btnTpl = btn("Template Editor", { variant: "outline", onclick: () => showTab('tpl') });
    tabsRow.appendChild(btnList);
    tabsRow.appendChild(btnGen);
    tabsRow.appendChild(btnTpl);
    root.appendChild(tabsRow);

    const tabList = el("div");
    const tabGen = el("div", { style: "display: none;" });
    const tabTpl = el("div", { style: "display: none;" });
    root.appendChild(tabList);
    root.appendChild(tabGen);
    root.appendChild(tabTpl);

    function showTab(t) {
        btnList.className = t === 'list' ? "btn primary" : "btn outline";
        btnGen.className = t === 'gen' ? "btn primary" : "btn outline";
        btnTpl.className = t === 'tpl' ? "btn primary" : "btn outline";
        tabList.style.display = t === 'list' ? "block" : "none";
        tabGen.style.display = t === 'gen' ? "block" : "none";
        tabTpl.style.display = t === 'tpl' ? "block" : "none";
        if (t === 'list') drawList();
        if (t === 'tpl') drawTemplate();
        if (t === 'gen') drawGenerator();
    }

    // --- TEMPLATE EDITOR TAB ---
    function drawTemplate() {
        tabTpl.innerHTML = "";
        const tplCard = card();
        tabTpl.appendChild(tplCard);

        tplCard.appendChild(el("h3", { text: "Edit Appointment Template", style: "margin-top:0;" }));
        tplCard.appendChild(el("p", { class: "muted", text: "Available placeholders: {{staffName}}, {{staffId}}, {{designation}}, {{department}}, {{employmentType}}, {{salary}}, {{appointmentDate}}, {{schoolName}}, {{schoolAddress}}, {{principalName}}" }));

        const currentTpl = db.setting("appointmentTemplate") || DEFAULT_TEMPLATE;
        const txtArea = el("textarea", { class: "inp", style: "height: 300px; width: 100%; margin-bottom: 15px; font-family: monospace;" });
        txtArea.value = currentTpl;
        tplCard.appendChild(txtArea);

        tplCard.appendChild(btn("Save Template", {
            variant: "primary", onclick: () => {
                db.saveSetting("appointmentTemplate", txtArea.value);
                toast("Template saved successfully!", "success");
            }
        }));
    }

    // --- BULK GENERATOR TAB ---
    function drawGenerator() {
        tabGen.innerHTML = "";
        const genCard = card();
        tabGen.appendChild(genCard);

        genCard.appendChild(el("h3", { text: "Generate Letters", style: "margin-top:0;" }));

        const allStaff = db.list("staff");
        const depts = [...new Set(allStaff.map(s => s.department).filter(Boolean))];
        const posts = [...new Set(allStaff.map(s => s.post).filter(Boolean))];
        const empTypes = [...new Set(allStaff.map(s => s.employmentStatus).filter(Boolean))];

        const fDept = select(() => [{ value: "", label: "All Departments" }, ...depts.map(d => ({ value: d, label: d }))]);
        const fPost = select(() => [{ value: "", label: "All Designations" }, ...posts.map(p => ({ value: p, label: p }))]);
        const fEmp = select(() => [{ value: "", label: "All Employment Types" }, ...empTypes.map(e => ({ value: e, label: e }))]);

        const row1 = el("div", { class: "row", style: "gap: 15px; margin-bottom: 15px;" });
        row1.appendChild(field("Department", fDept));
        row1.appendChild(field("Designation", fPost));
        row1.appendChild(field("Employment Type", fEmp));
        genCard.appendChild(row1);

        const progressDiv = el("div", { style: "margin-bottom: 15px; font-weight: bold; color: var(--primary);" });
        genCard.appendChild(progressDiv);

        genCard.appendChild(btn("Generate Letters", {
            variant: "primary", onclick: async (e) => {
                let targets = allStaff;
                if (fDept.value) targets = targets.filter(s => s.department === fDept.value);
                if (fPost.value) targets = targets.filter(s => s.post === fPost.value);
                if (fEmp.value) targets = targets.filter(s => s.employmentStatus === fEmp.value);

                if (!targets.length) return toast("No staff match these filters.", "error");
                if (!confirm(`Generate letters for ${targets.length} staff members?`)) return;

                e.currentTarget.disabled = true;
                const brand = getBranding();
                const template = db.setting("appointmentTemplate") || DEFAULT_TEMPLATE;
                const todayStr = new Date().toLocaleDateString("en-GB", { day: 'numeric', month: 'long', year: 'numeric' });

                for (let i = 0; i < targets.length; i++) {
                    const s = targets[i];
                    progressDiv.textContent = `Generating... ${i + 1} / ${targets.length}`;

                    const safeSalary = s.basic ? naira(s.basic) : "Not Specified";
                    const safeApptDate = s.createdAt ? new Date(s.createdAt).toLocaleDateString("en-GB", { day: 'numeric', month: 'long', year: 'numeric' }) : "Not Specified";
                    const safeDept = s.department || "Not Specified";
                    const safePost = s.post || "Not Specified";
                    const safeEmp = s.employmentStatus || "Not Specified";

                    let content = template;
                    content = content.replace(/\{\{staffName\}\}/g, s.name || "Not Specified");
                    content = content.replace(/\{\{staffId\}\}/g, s.staffNo || "Not Specified");
                    content = content.replace(/\{\{designation\}\}/g, safePost);
                    content = content.replace(/\{\{department\}\}/g, safeDept);
                    content = content.replace(/\{\{employmentType\}\}/g, safeEmp);
                    content = content.replace(/\{\{salary\}\}/g, safeSalary);
                    content = content.replace(/\{\{appointmentDate\}\}/g, safeApptDate);
                    content = content.replace(/\{\{schoolName\}\}/g, brand.schoolName || "HALQA");
                    content = content.replace(/\{\{schoolAddress\}\}/g, brand.address || "");
                    const b = getBranding();
                    const sig = cfg.schoolSignatures();
                    const directorName = sig.directorName || b.directorName || b.proprietorName || "School Director";
                    content = content.replace(/\{\{principalName\}\}/g, directorName);

                    // Check if existing
                    let existing = db.query("appointmentLetters", x => x.staffId === s.id)[0];
                    const letterId = existing ? existing.id : uuid();

                    db.save("appointmentLetters", {
                        id: letterId,
                        staffId: s.id,
                        staffName: s.name,
                        department: safeDept,
                        designation: safePost,
                        salary: safeSalary,
                        status: existing ? existing.status : "Generated",
                        createdAt: existing ? existing.createdAt : Date.now(),
                        generatedAt: Date.now(),
                        content: content,
                        referenceNo: `CICK/HR/${new Date().getFullYear()}/${(i + 1).toString().padStart(3, '0')}`
                    });

                    db.save("auditLogs", { id: uuid(), type: "hr", uid: ctx.user.uid, at: Date.now(), message: `Generated appointment letter for ${s.name}` });

                    // Chunking to prevent freeze
                    if (i % 20 === 0) await new Promise(r => setTimeout(r, 10));
                }

                progressDiv.textContent = `Done! ${targets.length} letters generated.`;
                toast("Bulk generation complete", "success");
                e.currentTarget.disabled = false;
            }
        }));
    }

    // --- LETTERS LIST TAB ---
    let currentList = [];
    const fSearch = input({ placeholder: "Search Name, Ref..." });
    const fStatus = select(() => [{ value: "", label: "All Statuses" }, "Draft", "Generated", "Issued", "Printed", "Accepted", "Rejected"].map(s => typeof s === 'string' ? { value: s, label: s } : s));

    function drawList() {
        tabList.innerHTML = "";
        const listCard = card();
        tabList.appendChild(listCard);

        const filterRow = el("div", { class: "row", style: "gap:10px; margin-bottom: 15px;" });
        filterRow.appendChild(fSearch);
        filterRow.appendChild(fStatus);

        filterRow.appendChild(btn("Print All (A4)", { variant: "primary", onclick: printAll }));
        filterRow.appendChild(btn("Export All to PDF", { variant: "primary", onclick: exportAllPdf }));
        listCard.appendChild(filterRow);

        const tableCont = el("div");
        listCard.appendChild(tableCont);

        fSearch.oninput = () => renderTable(tableCont);
        fStatus.onchange = () => renderTable(tableCont);

        renderTable(tableCont);
    }

    function renderTable(container) {
        container.innerHTML = "";
        let letters = db.list("appointmentLetters");
        if (fStatus.value) letters = letters.filter(l => l.status === fStatus.value);
        if (fSearch.value) {
            const q = fSearch.value.toLowerCase();
            letters = letters.filter(l => (l.staffName || "").toLowerCase().includes(q) || (l.referenceNo || "").toLowerCase().includes(q));
        }

        currentList = letters.sort((a, b) => b.generatedAt - a.generatedAt);

        const header = ["Ref No", "Staff Name", "Department", "Designation", "Status", "Action"];
        const rows = currentList.map(l => [
            l.referenceNo || "-",
            l.staffName,
            l.department,
            l.designation,
            el("span", { class: `badge ${l.status === 'Accepted' ? 'success' : (l.status === 'Generated' ? 'primary' : 'outline')}`, text: l.status }),
            el("div", { class: "row", style: "gap:5px" }, [
                btn("Preview", { sm: true, onclick: () => previewLetter(l) })
            ])
        ]);

        container.appendChild(table(header, rows, { empty: "No appointment letters generated yet." }));
    }

    // --- HTML BUILDER ---
    function buildLetterHtml(l) {
        const brand = getBranding();
        const logoSrc = brand.logoBase64 || "";
        const htmlContent = (l.content || "").replace(/\n/g, "<br>");
        const todayStr = new Date(l.generatedAt || Date.now()).toLocaleDateString("en-GB", { day: 'numeric', month: 'long', year: 'numeric' });

        return `
        <div class="letter-page" style="width: 210mm; height: 297mm; padding: 25mm 20mm; box-sizing: border-box; background: #fff; font-family: 'Times New Roman', Times, serif; color: #000; position: relative; margin: 0 auto; page-break-after: always; display:flex; flex-direction:column;">
            
            <!-- HEADER -->
            <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 20px; border-bottom: 2px solid #1e3a8a; padding-bottom: 10px;">
                <div style="width: 100px;">
                    ${logoSrc ? `<img src="${logoSrc}" style="width:80px; height:80px; object-fit:contain;" />` : ''}
                </div>
                <div style="flex: 1; text-align: center;">
                    <h1 style="margin: 0; font-size: 24px; color: #1e3a8a; font-weight: bold; text-transform: uppercase;">${brand.schoolName}</h1>
                    ${brand.arabicName ? `<p style="margin: 5px 0; font-size: 14px; font-weight: bold;" dir="rtl" lang="ar">${brand.arabicName}</p>` : ''}
                    <p style="margin: 5px 0; font-size: 14px; font-style: italic;">${brand.motto || ""}</p>
                    <p style="margin: 0; font-size: 12px;">${brand.address || ""}</p>
                    <p style="margin: 0; font-size: 12px;">${brand.phone || ""} | ${brand.email || ""}</p>
                </div>
                <div style="width: 100px;"></div>
            </div>

            <!-- META -->
            <div style="display: flex; justify-content: space-between; margin-bottom: 30px; font-size: 14px;">
                <div><strong>Ref:</strong> ${l.referenceNo || "-"}</div>
                <div><strong>Date:</strong> ${todayStr}</div>
            </div>

            <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="margin: 0; font-size: 20px; text-decoration: underline; text-transform: uppercase;">APPOINTMENT LETTER</h2>
            </div>

            <!-- CONTENT -->
            <div style="font-size: 14px; line-height: 1.6; flex: 1; text-align: justify;">
                ${htmlContent}
            </div>

            <!-- SIGNATURES -->
            <div style="margin-top: 40px; display: flex; justify-content: space-between; align-items: flex-end;">
                <div style="text-align: center; width: 200px;">
                    <div style="border-bottom: 1px solid #000; height: 40px; margin-bottom: 5px;"></div>
                    <p style="margin:0; font-weight:bold;">${brand.directorName || brand.proprietorName || "School Director"}</p>
                </div>
                
                <div style="text-align: center;">
                    <div style="width: 100px; height: 100px; border: 2px dashed #ccc; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 10px auto; color: #ccc; font-size: 12px;">
                        STAMP
                    </div>
                </div>

                <div style="text-align: center; width: 200px;">
                    <div style="border-bottom: 1px solid #000; height: 40px; margin-bottom: 5px;"></div>
                    <p style="margin:0; font-weight:bold;">Employee Signature & Date</p>
                </div>
            </div>

        </div>
        `;
    }

    function previewLetter(l) {
        const html = buildLetterHtml(l);
        const overlay = el("div", { style: "position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.8); z-index:9999; display:flex; flex-direction:column; align-items:center; overflow-y:auto; padding:20px;" });

        const controls = el("div", { style: "background:#fff; padding:10px; border-radius:8px; margin-bottom:20px; display:flex; gap:10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);" });

        controls.appendChild(btn("Issue Letter", {
            variant: "success", onclick: () => {
                l.status = "Issued";
                l.issuedAt = Date.now();
                db.save("appointmentLetters", l);
                toast("Letter marked as Issued", "success");
                drawList();
            }
        }));

        controls.appendChild(btn("Print", {
            variant: "primary", onclick: () => {
                if (l.status !== "Issued" && l.status !== "Accepted") {
                    l.status = "Printed";
                    db.save("appointmentLetters", l);
                }
                db.save("auditLogs", { id: uuid(), type: "hr", uid: ctx.user.uid, at: Date.now(), message: `Printed appointment letter for ${l.staffName}` });

                const printWindow = window.open('', '_blank');
                printWindow.document.write(`<html><head><title>Print ${l.staffName}</title><style>@media print { @page { size: A4 portrait; margin: 0; } body { margin: 0; } }</style></head><body style="margin:0; padding:0; background:#fff;">${html}</body></html>`);
                printWindow.document.close();
                setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
            }
        }));

        controls.appendChild(btn("Close", { onclick: () => document.body.removeChild(overlay) }));

        overlay.appendChild(controls);

        const previewWrap = el("div", { style: "background:#fff; box-shadow: 0 4px 10px rgba(0,0,0,0.3); transform: scale(0.9); transform-origin: top center;" });
        previewWrap.innerHTML = html;
        overlay.appendChild(previewWrap);
        document.body.appendChild(overlay);
    }

    async function printAll() {
        if (!currentList.length) return toast("No letters to print.", "error");
        toast("Preparing print... This may take a moment.", "info");

        let fullHtml = `<html><head><title>Bulk Appointment Letters</title><style>
            @media print {
                @page { size: A4 portrait; margin: 0; }
                body { margin: 0; }
                .letter-page { page-break-after: always; margin: 0 !important; }
            }
        </style></head><body style="margin:0; background:#ccc; padding:20px;">`;

        for (let i = 0; i < currentList.length; i++) {
            fullHtml += buildLetterHtml(currentList[i]);
            if (i % 10 === 0) await new Promise(r => setTimeout(r, 10));
        }
        fullHtml += `</body></html>`;

        const printWindow = window.open('', '_blank');
        printWindow.document.write(fullHtml);
        printWindow.document.close();
        setTimeout(() => { printWindow.print(); }, 1500);
    }

    async function exportAllPdf() {
        if (!currentList.length) return toast("No letters to export.", "error");

        toast("Generating PDF... Please wait, processing bulk batch.", "info");

        const container = document.createElement("div");
        for (let i = 0; i < currentList.length; i++) {
            const certHtml = buildLetterHtml(currentList[i]);
            const wrapper = document.createElement("div");
            wrapper.innerHTML = certHtml;
            container.appendChild(wrapper.firstElementChild);

            // Chunk processing: yield every 20 documents
            if ((i + 1) % 20 === 0) {
                await new Promise(r => setTimeout(r, 100));
                console.log(`[PDF EXPORT] Processed chunk ${i + 1} of ${currentList.length}`);
            }
        }

        const success = await exportDocumentToPDF(container, {
            filename: `AppointmentLetters.pdf`,
            title: "Appointment Letters Bulk Export"
        });

        if (success) {
            toast("PDF exported successfully!", "success");
        }
    }

    showTab('list');
}
