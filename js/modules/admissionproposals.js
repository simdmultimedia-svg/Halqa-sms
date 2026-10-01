import { db } from "../core/db.js";
import { el, toast, num, naira, fmtDate, todayISO, modal, confirmDialog, uuid } from "../core/utils.js";
import { card, pageHead, btn, input, select, field, statCard, textarea } from "../core/ui.js";
import * as cfg from "../core/config.js";
import { previewHtml, downloadPdf } from "../core/print.js";
import { getBranding } from "../core/branding.js";
import { logActivity } from "../core/activity.js";

// Main Render
export function render(root, ctx) {
    const isProposalsTab = ctx.view === "admissionproposals";
    
    root.appendChild(pageHead(isProposalsTab ? "Admission Proposal" : "Admission Enquiries", 
        "Manage prospective parents, track leads, and generate professional school proposals."));
    
    const tabs = el("div", { class: "row", style: "margin-bottom:16px" }, [
        btn("CRM Dashboard", { variant: !isProposalsTab ? "primary" : "ghost", icon: "📊", onclick: () => ctx.go("enquiries") }),
        btn("Proposals", { variant: isProposalsTab ? "primary" : "ghost", icon: "📄", onclick: () => ctx.go("admissionproposals") })
    ]);
    root.appendChild(tabs);
    
    const host = el("div");
    root.appendChild(host);
    
    if (isProposalsTab) {
        renderProposalsTab(host, ctx);
    } else {
        renderCRMTab(host, ctx);
    }
}

// -------------------------------------------------------------------------------------------------
// CRM DASHBOARD & ENQUIRIES
// -------------------------------------------------------------------------------------------------
function renderCRMTab(host, ctx) {
    host.innerHTML = "";
    const enquiries = db.list("admissionEnquiries").sort((a,b) => (b.date || "").localeCompare(a.date || ""));
    const proposals = db.list("admissionProposals");
    
    // Metrics
    const metricsRow = el("div", { class: "row", style: "margin-bottom: 24px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px" });
    const todayStr = todayISO();
    
    const totalEnquiries = enquiries.length;
    const todayEnquiries = enquiries.filter(e => (e.date || "").startsWith(todayStr)).length;
    const registered = enquiries.filter(e => e.status === "Registered").length;
    const convRate = totalEnquiries > 0 ? Math.round((registered / totalEnquiries) * 100) : 0;
    
    metricsRow.append(
        statCard("Total Enquiries", totalEnquiries, "Users"),
        statCard("Today's Enquiries", todayEnquiries, "📅"),
        statCard("Generated Proposals", proposals.length, "📄"),
        statCard("Conversion Rate", `${convRate}%`, "📈")
    );
    host.appendChild(metricsRow);

    const c = card("Enquiry Management");
    
    // Header actions
    const headerRow = el("div", { class: "row", style: "justify-content: space-between; margin-bottom: 16px" }, [
        btn("New Enquiry", { variant: "success", icon: "➕", onclick: () => enquiryDialog(null, () => renderCRMTab(host, ctx)) }),
        input({ placeholder: "Search enquiries...", oninput: (e) => filterEnquiries(e.target.value) })
    ]);
    c.appendChild(headerRow);
    
    const tbl = el("table", { class: "tbl" }, [
        el("thead", {}, [el("tr", {}, ["Date", "Parent Name", "Phone", "Child Name", "Intended Class", "Status", "Actions"].map(h => el("th", { text: h })))])
    ]);
    const tbody = el("tbody");
    tbl.appendChild(tbody);
    
    const filterEnquiries = (query) => {
        const q = query.toLowerCase();
        tbody.innerHTML = "";
        enquiries.filter(eq => 
            (eq.parentName || "").toLowerCase().includes(q) ||
            (eq.childName || "").toLowerCase().includes(q) ||
            (eq.phone || "").includes(q) ||
            (eq.status || "").toLowerCase().includes(q)
        ).slice(0, 50).forEach(eq => {
            const tr = el("tr", {}, [
                el("td", { text: fmtDate(eq.date) }),
                el("td", { text: eq.parentName }),
                el("td", { text: eq.phone }),
                el("td", { text: eq.childName }),
                el("td", { text: cfg.className(eq.classId) || eq.classId || "-" }),
                el("td", { text: eq.status }),
                el("td", {}, [
                    btn("Edit", { sm: true, onclick: () => enquiryDialog(eq, () => renderCRMTab(host, ctx)) }),
                    btn("Generate Proposal", { sm: true, variant: "primary", onclick: () => openProposalGenerator(eq, ctx) })
                ])
            ]);
            tbody.appendChild(tr);
        });
    };
    
    
    c.appendChild(el("div", { class: "table-wrap" }, [tbl]));
    filterEnquiries("");
    
    host.appendChild(c);
}

function enquiryDialog(existing, after) {
    const f = existing ? { ...existing } : { 
        id: uuid(), date: todayISO(), status: "New", 
        parentName: "", phone: "", childName: "", sectionId: "", classId: "" 
    };
    const body = el("div", { class: "form-grid" });
    
    const inpDate = input({ type: "date", value: (f.date || todayISO()).split('T')[0] });
    const inpParent = input({ value: f.parentName, placeholder: "Parent Name" });
    const inpPhone = input({ value: f.phone, placeholder: "Phone/WhatsApp" });
    const inpChild = input({ value: f.childName, placeholder: "Child Name" });
    
    const _secIds = f.sectionIds || (f.sectionId ? (f.sectionId === "All programs" ? cfg.sections().map(s=>s.id) : [f.sectionId]) : []);
    const selSections = el("div", { class: "checkbox-group", style: "display: flex; flex-direction: column; gap: 8px; max-height: 150px; overflow-y: auto; padding: 8px; border: 1px solid var(--border); border-radius: 4px;" });
    cfg.sections().forEach(s => {
        const cb = input({ type: "checkbox", value: s.id });
        cb.checked = _secIds.includes(s.id);
        selSections.appendChild(el("label", { style: "display:flex; align-items:center; gap:8px; cursor:pointer;" }, [cb, el("span", { text: s.name })]));
    });

    const selClass = select(() => [{ value: "", label: "Select Class..." }]);
    const updateClasses = () => {
        const selected = Array.from(selSections.querySelectorAll("input:checked")).map(i => i.value);
        let classes = [];
        selected.forEach(secId => { classes.push(...cfg.classes(secId)); });
        selClass.innerHTML = `<option value="">Select Class...</option>` + 
            classes.map(c => `<option value="${c.id}" ${c.id === f.classId ? "selected" : ""}>${c.name}</option>`).join("");
    };
    selSections.addEventListener("change", updateClasses);
    updateClasses();

    const selStatus = select(() => ["New", "Interested", "Follow-up", "Registered", "Closed"].map(s => ({ value: s, label: s, selected: s === f.status })));
    const inpFollowup = input({ type: "date", value: f.followupDate || "" });
    const inpNotes = textarea({ value: f.notes || "", placeholder: "Parent Notes..." });

    body.append(
        field("Enquiry Date", inpDate), field("Status", selStatus),
        field("Parent Name", inpParent), field("Phone", inpPhone),
        field("Child Name", inpChild), field("Target Sections", selSections), 
        field("Intended Class", selClass), field("Next Follow-up", inpFollowup), 
        field("Remarks/Notes", inpNotes)
    );

    const m = modal({
        title: existing ? "Edit Enquiry" : "New Enquiry",
        body,
        footer: [
            btn("Save", { variant: "primary", onclick: () => {
                f.date = inpDate.value || todayISO().split('T')[0];
                f.parentName = inpParent.value;
                f.phone = inpPhone.value;
                f.childName = inpChild.value;
                const checked = Array.from(selSections.querySelectorAll("input:checked")).map(i => i.value);
                f.sectionIds = checked;
                f.sectionId = checked.length === 1 ? checked[0] : (checked.length > 1 ? "Multiple" : "");
                f.classId = selClass.value;
                f.status = selStatus.value;
                f.followupDate = inpFollowup.value;
                f.notes = inpNotes.value;
                db.save("admissionEnquiries", f);
                m.close();
                toast("Enquiry saved");
                after && after();
            }}),
            btn("Cancel", { onclick: () => m.close() })
        ]
    });
}

// -------------------------------------------------------------------------------------------------
// PROPOSALS GENERATOR & LIST
// -------------------------------------------------------------------------------------------------
function renderProposalsTab(host, ctx) {
    host.innerHTML = "";
    const c = card("Generated Proposals");
    const proposals = db.list("admissionProposals").sort((a,b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    
    const headerRow = el("div", { class: "row", style: "justify-content: space-between; margin-bottom: 16px" }, [
        btn("Generate Custom Proposal", { variant: "primary", icon: "📄", onclick: () => openProposalGenerator(null, ctx) }),
        input({ placeholder: "Search proposals...", oninput: (e) => filterProposals(e.target.value) })
    ]);
    c.appendChild(headerRow);
    
    const tbl = el("table", { class: "tbl" }, [
        el("thead", {}, [el("tr", {}, ["Proposal No", "Date", "Parent", "Child", "Class", "Actions"].map(h => el("th", { text: h })))])
    ]);
    const tbody = el("tbody");
    tbl.appendChild(tbody);
    
    const filterProposals = (query) => {
        const q = query.toLowerCase();
        tbody.innerHTML = "";
        proposals.filter(p => 
            (p.proposalNo || "").toLowerCase().includes(q) ||
            (p.parentName || "").toLowerCase().includes(q) ||
            (p.childName || "").toLowerCase().includes(q)
        ).slice(0, 50).forEach(p => {
            const tr = el("tr", {}, [
                el("td", { text: p.proposalNo, style: "font-weight: bold; color: var(--primary)" }),
                el("td", { text: fmtDate(p.createdAt) }),
                el("td", { text: p.parentName }),
                el("td", { text: p.childName }),
                el("td", { text: cfg.className(p.classId) || p.classId || "-" }),
                el("td", {}, [
                    btn("Preview", { sm: true, onclick: () => previewProposal(p, ctx) }),
                    btn("Delete", { sm: true, variant: "danger", onclick: () => {
                        confirmDialog("Are you sure you want to delete this proposal?", { title: "Delete Proposal?", danger: true }).then((confirmed) => {
                            if (confirmed) {
                                db.remove("admissionProposals", p.id);
                                toast("Deleted");
                                renderProposalsTab(host, ctx);
                            }
                        });
                    }})
                ])
            ]);
            tbody.appendChild(tr);
        });
    };
    
    c.appendChild(el("div", { class: "table-wrap" }, [tbl]));
    filterProposals("");
    host.appendChild(c);
}

function openProposalGenerator(enquiry, ctx) {
    // Generate snapshot of current live settings
    const snapshot = {
        fees: db.setting("fees") || {},
        books: db.setting("books") || {},
        uniforms: db.setting("uniforms") || {},
        services: db.setting("services") || {},
        schoolAccount: db.setting("schoolAccount") || {},
        sections: db.list("sections") || [],
        classes: db.list("classes") || [],
        calendar: db.setting("calendar") || {} // Hypothetical, usually term dates are in currentTerm
    };

    const nextId = String(db.list("admissionProposals").length + 1).padStart(5, '0');
    const proposalNo = `PROP-${new Date().getFullYear()}-${nextId}`;

    const p = {
        id: uuid(),
        proposalNo,
        createdAt: new Date().toISOString(),
        createdBy: ctx.user.name,
        enquiryId: enquiry ? enquiry.id : null,
        parentName: enquiry ? enquiry.parentName : "",
        childName: enquiry ? enquiry.childName : "",
        classId: enquiry ? enquiry.classId : "",
        sectionId: enquiry ? enquiry.sectionId : "",
        sectionIds: enquiry ? enquiry.sectionIds : null,
        phone: enquiry ? enquiry.phone : "",
        snapshot
    };

    // Before generating, allow admin to confirm/edit the parent details for the proposal
    const body = el("div", { class: "form-grid" });
    const inpParent = input({ value: p.parentName, placeholder: "Parent Name" });
    const inpChild = input({ value: p.childName, placeholder: "Child Name" });
    const _secIds = p.sectionIds || (p.sectionId ? (p.sectionId === "All programs" ? cfg.sections().map(s=>s.id) : [p.sectionId]) : []);
    const selSections = el("div", { class: "checkbox-group", style: "display: flex; flex-direction: column; gap: 8px; max-height: 150px; overflow-y: auto; padding: 8px; border: 1px solid var(--border); border-radius: 4px;" });
    cfg.sections().forEach(s => {
        const cb = input({ type: "checkbox", value: s.id });
        cb.checked = _secIds.includes(s.id);
        selSections.appendChild(el("label", { style: "display:flex; align-items:center; gap:8px; cursor:pointer;" }, [cb, el("span", { text: s.name })]));
    });

    const selClass = select(() => [{ value: "", label: "Select Class..." }]);
    const updateClasses = () => {
        const selected = Array.from(selSections.querySelectorAll("input:checked")).map(i => i.value);
        let classes = [];
        selected.forEach(secId => { classes.push(...cfg.classes(secId)); });
        selClass.innerHTML = `<option value="">Select Class...</option>` + 
            classes.map(c => `<option value="${c.id}" ${c.id === p.classId ? "selected" : ""}>${c.name}</option>`).join("");
    };
    selSections.addEventListener("change", updateClasses);
    updateClasses();

    body.append(
        field("Proposal No", el("b", { text: p.proposalNo })), field("Date", el("b", { text: fmtDate(p.createdAt) })),
        field("Parent Name", inpParent), field("Child Name", inpChild),
        field("Target Sections", selSections), field("Target Class", selClass)
    );

    const warning = el("div", { class: "note", style: "grid-column: 1 / -1", text: "Generating this proposal will capture a live snapshot of ALL current school fees, uniforms, services, and policies. Ensure your global settings are up to date." });
    body.appendChild(warning);

    const m = modal({
        title: "Generate Admission Proposal",
        body,
        footer: [
            btn("Generate & Preview", { variant: "success", onclick: () => {
                const checked = Array.from(selSections.querySelectorAll("input:checked")).map(i => i.value);
                if (checked.length === 0) return toast("Select at least one section", "error");
                
                p.parentName = inpParent.value;
                p.childName = inpChild.value;
                p.sectionIds = checked;
                p.sectionId = checked.length === 1 ? checked[0] : (checked.length > 1 ? "Multiple" : "");
                p.classId = selClass.value;
                
                db.save("admissionProposals", p);
                logActivity({ module: "admissions", action: "Generated Proposal", description: `Generated Proposal ${p.proposalNo} for ${p.parentName}` });
                m.close();
                previewProposal(p, ctx);
            }}),
            btn("Cancel", { onclick: () => m.close() })
        ]
    });
}

function previewProposal(proposal, ctx) {
    const html = buildProposalHtml(proposal);
    const body = el("div", { style: "max-height:75vh; overflow-y:auto; background:#ccc; padding:20px; display:flex; flex-direction:column; align-items:center;" });
    body.innerHTML = `<div style="width:210mm; background:#fff; padding:10mm; box-shadow:0 4px 12px rgba(0,0,0,0.2)">${html}</div>`;

    const m = modal({ title: `Proposal Preview: ${proposal.proposalNo}`, size: "lg", body, footer: [
        btn("Print", { onclick: () => previewHtml(html, { title: proposal.proposalNo }) }),
        btn("Download PDF", { onclick: () => downloadPdf(html, { title: proposal.proposalNo, filename: `${proposal.proposalNo}.pdf` }) }),
        btn("Close", { onclick: () => m.close() })
    ] });
}

// -------------------------------------------------------------------------------------------------
// PROPOSAL RENDER ENGINE (DYNAMIC)
// -------------------------------------------------------------------------------------------------
function buildProposalHtml(p) {
    const b = getBranding();
    const acct = p.snapshot.schoolAccount || {};
    // Use the snapshot's config to avoid side effects
    const sec = (p.snapshot.sections.list || []).find(s => s.id === p.sectionId);
    const cls = (p.snapshot.classes.list || []).find(c => c.id === p.classId);
    
    const logoHtml = b.logoBase64 ? `<img src="${b.logoBase64}" style="width:120px; height:120px; object-fit:contain">` : ``;

    // 1. Page 1: Cover & About
    const page1 = `
    <div class="proposal-page" style="padding-top: 5mm; position:relative; min-height: 277mm;">
        <div style="text-align:center;">
            ${logoHtml}
            <h1 style="color:#0b3d91; font-size:24px; margin-top:10px; font-weight:900">${acct.accountName || "CICK ENTERPRISE SCHOOL"}</h1>
            <div style="font-size:14px; color:#555; font-style:italic">"The Splendour of a Better Tomorrow"</div>
            <hr style="margin:15px 0; border:1px solid #0b3d91">
            <h2 style="font-size:22px; text-transform:uppercase; letter-spacing:1px; margin: 10px 0;">Official Admission Proposal</h2>
        </div>
        
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-top:20px;">
            <div style="font-size:14px">
                <b>Proposal No:</b> ${p.proposalNo}<br>
                <b>Date:</b> ${fmtDate(p.createdAt)}<br>
            </div>
            <div style="font-size:14px; border:1px solid #ddd; padding:10px; border-radius:8px; text-align:left; background:#f9f9f9">
                <b>Prepared For:</b><br>
                Parent: ${p.parentName || "Valued Parent"}<br>
                Child: ${p.childName || "Prospective Student"}<br>
                Intended Class: ${cls ? cls.name : (sec ? sec.name : "To Be Decided")}
            </div>
        </div>

        <div style="margin-top:30px">
            <h2 style="color:#0b3d91; font-size:18px; border-bottom:1px solid #0b3d91; padding-bottom:5px">Welcome to Our School</h2>
            <p style="font-size:13px; line-height:1.5">
                Thank you for considering our institution for your child's education. We are committed to academic excellence, 
                moral development, innovation, and a safe learning environment.
            </p>
            
            <div style="display:flex; gap:20px; margin-top:20px">
                <div style="flex:1">
                    <h3 style="color:#0b3d91; font-size:15px; margin-bottom:5px">Our Vision</h3>
                    <p style="font-size:13px; line-height:1.5">To be a world-class institution raising future leaders equipped with excellent academic and moral standards.</p>
                </div>
                <div style="flex:1">
                    <h3 style="color:#0b3d91; font-size:15px; margin-bottom:5px">Our Mission</h3>
                    <p style="font-size:13px; line-height:1.5">To provide high-quality education using modern technology and dedicated staff, fostering an environment where every child can discover and maximize their potential.</p>
                </div>
            </div>
        </div>
        
        <div style="position:absolute; bottom:5mm; width:100%; left:0; text-align:center; font-size:11px; color:#666">
            ${b.address || "Kano, Nigeria"} | ${b.phone || ""} | ${b.email || ""}<br>
            <i>This document is valid for the current academic session.</i>
        </div>
    </div>
    <div style="page-break-after:always"></div>
    `;

    // 2. Page 2: Financials & Contact
    const allSections = p.snapshot.sections.list || [];
    let targetSections = [];
    if (p.sectionIds && p.sectionIds.length > 0) {
        targetSections = allSections.filter(s => p.sectionIds.includes(s.id));
    } else if (p.sectionId === "All programs") {
        targetSections = allSections;
    } else {
        targetSections = allSections.filter(s => s.id === p.sectionId);
    }

    const feeDefs = (p.snapshot.fees.defs || []).filter(f => f.active !== false);

    let financialHtml = "";

    // Build a table per section
    targetSections.forEach(section => {
        const sid = section.id;
        const sectionFeeRows = feeDefs.map(f => {
            const amt = num(f.amounts?.[sid]);
            if (amt <= 0) return "";
            return `<tr><td>${f.name}</td><td style="text-align:right">${naira(amt)}</td></tr>`;
        }).join("");
        const sectionTotal = feeDefs.reduce((sum, f) => sum + num(f.amounts?.[sid]), 0);

        // Uniforms
        const uni = p.snapshot.uniforms?.bySection?.[sid] || {};
        const uniTotal = Object.values(uni).reduce((a,b) => a + num(b), 0);
        const bkAmt = num(p.snapshot.books?.bySection?.[sid]);
        let uniRows = "";
        if (uniTotal > 0) {
            Object.keys(uni).forEach(k => {
                if (num(uni[k]) > 0) uniRows += `<tr><td>${k.charAt(0).toUpperCase() + k.slice(1)}</td><td style="text-align:right">${naira(uni[k])}</td></tr>`;
            });
        }
        if (bkAmt > 0) uniRows += `<tr><td>Books Package</td><td style="text-align:right">${naira(bkAmt)}</td></tr>`;

        // Services
        const srvs = (p.snapshot.services.list || []).filter(s => s.active !== false && num(s.prices?.[sid]) > 0 && s.type !== "uniform" && s.type !== "books");
        let srvRows = "";
        srvs.forEach(s => { srvRows += `<tr><td>${s.name}</td><td style="text-align:right">${naira(num(s.prices[sid]))}</td></tr>`; });

        if (sectionTotal > 0 || uniRows || srvRows) {
            financialHtml += `<h3 style="color:#0b3d91; font-size:14px; margin-top:15px; border-bottom:1px solid #ddd; padding-bottom:3px">${section.name}</h3>`;
            if (sectionTotal > 0) {
                financialHtml += `<table class="doc-table compact" style="font-size:12px; margin-bottom:8px">
                    <thead><tr><th>Fee Description</th><th style="text-align:right; width:100px">Amount</th></tr></thead>
                    <tbody>${sectionFeeRows}</tbody>
                    <tfoot><tr style="background:#e9eefb; font-weight:bold"><td>Total Tuition & Statutory Fees</td><td style="text-align:right; color:#0b3d91">${naira(sectionTotal)}</td></tr></tfoot>
                </table>`;
            }
            if (uniRows) {
                financialHtml += `<table class="doc-table compact" style="font-size:12px; margin-bottom:8px">
                    <thead><tr><th colspan="2">Uniforms & Books</th></tr></thead>
                    <tbody>${uniRows}</tbody>
                </table>`;
            }
            if (srvRows) {
                financialHtml += `<table class="doc-table compact" style="font-size:12px; margin-bottom:8px">
                    <thead><tr><th colspan="2">Other Services & Sport Wears</th></tr></thead>
                    <tbody>${srvRows}</tbody>
                </table>`;
            }
        }
    });
    if (!financialHtml) financialHtml = `<p style="color:#888">No fees configured for the selected sections.</p>`;

    const sectionLabel = p.sectionIds?.length > 1 ? "Selected Programs" : (sec ? sec.name : "your section");

    const page2 = `
    <div class="proposal-page">
        <h2 style="color:#0b3d91; font-size:18px; border-bottom:1px solid #0b3d91; padding-bottom:5px; margin-top:0">Financial Overview</h2>
        <p style="font-size:12px; margin-bottom:10px">The following is the fee structure for <b>${sectionLabel}</b>.</p>
        
        ${financialHtml}

        <div style="display:flex; gap:20px; margin-top:15px;">
            <div style="flex:1; border:1px solid #111; padding:10px; border-radius:6px; background:#f9f9f9">
                <h3 style="margin-top:0; color:#0b3d91; font-size:14px">Bank Account Details</h3>
                <p style="font-size:12px; line-height:1.4; margin-bottom:0">
                    <b>Account Name:</b> ${acct.accountName || "School Account"}<br>
                    <b>Account Number:</b> ${acct.accountNumber || "N/A"}<br>
                    <b>Bank:</b> ${acct.bankName || "N/A"}
                </p>
            </div>
            
            <div style="flex:1">
                <h3 style="color:#0b3d91; font-size:14px; margin-top:0; margin-bottom:5px">Admission Checklist</h3>
                <ul style="font-size:12px; line-height:1.4; margin:0; padding-left:20px">
                    <li>Completed Application Form</li>
                    <li>Birth Certificate</li>
                    <li>4 Recent Passport Photographs</li>
                    <li>Medical Fitness Report</li>
                    <li>Previous Academic Records (if transferring)</li>
                </ul>
            </div>
        </div>

        <div style="margin-top:20px; text-align:center; font-size:12px; border-top:1px dashed #ccc; padding-top:15px">
            <p style="margin:0 0 5px 0">For any questions or further clarification, please contact our Admissions Office:</p>
            <p style="font-size:14px; font-weight:bold; margin:0">${b.phone || ""} &bull; ${b.email || ""}</p>
        </div>
    </div>
    `;

    return `<style>
        .proposal-page { position: relative; min-height: 250mm; box-sizing: border-box; }
        .doc-table th { background: #0b3d91; color: #fff; }
    </style>` + page1 + page2;
}
