import { db } from "../core/db.js";
import { el, toast, uuid, fmtDate } from "../core/utils.js";
import { card, pageHead, table, btn, select, input, field } from "../core/ui.js";
import { printHtml } from "../core/print.js";
import { headerHtml } from "../core/branding.js";
import { normaliseRole } from "../core/rbac.js";
import * as cfg from "../core/config.js";

function getDevice() {
    return navigator.userAgent.substring(0, 100);
}

export function render(root, ctx) {
    const role = normaliseRole(ctx.user.role);
    const isTeacher = role === "Teacher";
    const canApprove = ["Super Admin", "Admin", "Principal", "Vice Principal"].includes(role);

    root.appendChild(pageHead("Scheme of Work", "Create, manage, and approve teaching schemes."));

    const tabs = el("div", { class: "row", style: "margin-bottom:14px" }, [
        btn("View Schemes", { variant: "primary", onclick: renderView }),
        btn("Create Scheme", { onclick: renderCreate })
    ]);
    root.appendChild(tabs);
    
    const content = el("div");
    root.appendChild(content);

    function renderView() {
        content.innerHTML = "";
        
        const filterRow = el("div", { class: "row card", style: "align-items:flex-end; gap: 10px; margin-bottom: 20px" });
        const termSel = select(() => ["All", "1st Term", "2nd Term", "3rd Term"]);
        const classSel = select(() => [{value: "All", label: "All Classes"}, ...cfg.classes().map(c => ({value: c.name, label: c.name}))]);
        const subjectSel = input({ type: "text", placeholder: "Filter Subject" });
        
        filterRow.appendChild(field("Term", termSel));
        filterRow.appendChild(field("Class", classSel));
        filterRow.appendChild(field("Subject", subjectSel));
        
        const loadBtn = btn("Filter", { onclick: loadGrid });
        filterRow.appendChild(loadBtn);
        content.appendChild(filterRow);
        
        const gridContainer = el("div");
        content.appendChild(gridContainer);

        function loadGrid() {
            gridContainer.innerHTML = "";
            let schemes = db.list("schemeOfWork");
            
            if (isTeacher) {
                schemes = schemes.filter(s => s.createdBy === ctx.user.email);
            }
            
            if (termSel.value !== "All") schemes = schemes.filter(s => s.term === termSel.value);
            if (classSel.value !== "All") schemes = schemes.filter(s => s.cls === classSel.value);
            if (subjectSel.value.trim()) schemes = schemes.filter(s => (s.subject||"").toLowerCase().includes(subjectSel.value.toLowerCase()));

            if (!schemes.length) {
                gridContainer.appendChild(el("p", { class: "muted", text: "No scheme of work found." }));
                return;
            }

            const header = ["Class", "Subject", "Term", "Week", "Topic", "Status", "Action"];
            const rows = schemes.map(s => {
                const acts = el("div", { class: "row", style: "gap: 5px;" });
                acts.appendChild(btn("View/Edit", { onclick: () => renderCreate(s) }));
                if (canApprove && s.status === "Submitted") {
                    acts.appendChild(btn("Approve", { variant: "primary", onclick: () => updateStatus(s, "Approved") }));
                    acts.appendChild(btn("Reject", { variant: "danger", onclick: () => updateStatus(s, "Rejected") }));
                }
                return [s.cls, s.subject, s.term, s.week, s.topic, s.status, acts];
            });

            gridContainer.appendChild(table(header, rows));
            
            const printBtn = btn("Print / PDF Export", { style: "margin-top: 20px;", onclick: () => printSchemes(schemes) });
            gridContainer.appendChild(printBtn);
        }
        
        loadGrid();
    }
    
    function updateStatus(scheme, newStatus) {
        scheme.status = newStatus;
        scheme.approverName = ctx.user.email;
        scheme.approvalDate = Date.now();
        scheme.updatedBy = ctx.user.email;
        scheme.updatedAt = Date.now();
        db.save("schemeOfWork", scheme);
        toast(`Scheme marked as ${newStatus}`);
        renderView();
    }

    function renderCreate(existingScheme = null) {
        content.innerHTML = "";
        const s = existingScheme || {};
        
        const form = el("div", { class: "card", style: "max-width: 800px; display: grid; grid-template-columns: 1fr 1fr; gap: 15px;" });
        
        const sessionSel = select(() => db.list("settings").find(set => set.id === "sessions")?.options || ["2025/2026"], s.session);
        const termSel = select(() => ["First Term", "Second Term", "Third Term"], s.term || "First Term");
        const classSel = select(() => cfg.classes().map(c => c.name), s.cls);
        const subjInput = input({ type: "text", value: s.subject || "" });
        const weekInput = input({ type: "number", value: s.week || 1 });
        const topicInput = input({ type: "text", value: s.topic || "" });
        
        form.appendChild(field("Session", sessionSel));
        form.appendChild(field("Term", termSel));
        form.appendChild(field("Class", classSel));
        form.appendChild(field("Subject", subjInput));
        form.appendChild(field("Week", weekInput));
        form.appendChild(field("Topic", topicInput));
        
        const subTopic = el("textarea", { rows: "2", style: "width:100%", value: s.subTopic || "" });
        const objInput = el("textarea", { rows: "3", style: "width:100%", value: s.objectives || "" });
        const aidsInput = el("textarea", { rows: "2", style: "width:100%", value: s.teachingAids || "" });
        const actsInput = el("textarea", { rows: "3", style: "width:100%", value: s.activities || "" });
        const evalInput = el("textarea", { rows: "2", style: "width:100%", value: s.assessment || "" });
        const remInput = el("textarea", { rows: "2", style: "width:100%", value: s.remarks || "" });
        
        form.appendChild(field("Sub Topic", subTopic));
        form.appendChild(field("Objectives", objInput));
        form.appendChild(field("Teaching Aids", aidsInput));
        form.appendChild(field("Activities", actsInput));
        form.appendChild(field("Assessment", evalInput));
        form.appendChild(field("Remarks", remInput));
        
        content.appendChild(form);
        
        const acts = el("div", { class: "row", style: "margin-top: 15px; gap: 10px;" });
        if (!s.id || s.status === "Draft" || s.status === "Rejected") {
            acts.appendChild(btn("Save Draft", { onclick: () => saveScheme("Draft") }));
            acts.appendChild(btn("Submit for Approval", { variant: "primary", onclick: () => saveScheme("Submitted") }));
        }
        
        if (s.id && s.status) {
            acts.appendChild(el("span", { text: `Current Status: ${s.status}`, style: "font-weight: bold; margin-left: 20px; align-self: center;" }));
            if (s.approverName) {
                acts.appendChild(el("span", { text: `(by ${s.approverName})`, style: "margin-left: 5px; align-self: center;" }));
            }
        }
        
        content.appendChild(acts);
        
        function saveScheme(status) {
            const data = {
                id: s.id || uuid(),
                session: sessionSel.value,
                term: termSel.value,
                cls: classSel.value,
                subject: subjInput.value,
                week: weekInput.value,
                topic: topicInput.value,
                subTopic: subTopic.value,
                objectives: objInput.value,
                teachingAids: aidsInput.value,
                activities: actsInput.value,
                assessment: evalInput.value,
                remarks: remInput.value,
                status: status,
                createdBy: s.createdBy || ctx.user.email,
                createdAt: s.createdAt || Date.now(),
                updatedBy: ctx.user.email,
                updatedAt: Date.now(),
                device: getDevice(),
                approverName: s.approverName || null,
                approvalDate: s.approvalDate || null
            };
            db.save("schemeOfWork", data);
            toast("Scheme of Work saved!");
            renderView();
        }
    }

    function printSchemes(schemes) {
        let html = headerHtml();
        html += `<h2 style="text-align:center">SCHEME OF WORK</h2>`;
        
        html += `<table><thead><tr>
            <th>Class</th>
            <th>Subject</th>
            <th>Week / Topic</th>
            <th>Objectives</th>
            <th>Activities</th>
            <th>Assessment</th>
            <th>Status</th>
        </tr></thead><tbody>`;
        
        schemes.forEach((s) => {
            html += `<tr>
                <td>${s.cls}</td>
                <td>${s.subject}</td>
                <td><b>Week ${s.week}:</b> ${s.topic}<br><small>${s.subTopic}</small></td>
                <td>${s.objectives}</td>
                <td>${s.activities}</td>
                <td>${s.assessment}</td>
                <td>${s.status}</td>
            </tr>`;
        });
        html += `</tbody></table>`;
        printHtml(html);
    }

    renderView();
}
