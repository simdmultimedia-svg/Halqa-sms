import { db } from "../core/db.js";
import { lazyListen } from "../core/adapter.js";
import { el, toast, uuid, fmtDate } from "../core/utils.js";
import { card, pageHead, table, btn, select, input, field } from "../core/ui.js";
import { normaliseRole } from "../core/rbac.js";

let currentTerm = "";
let currentSession = "";
let currentStaffFilter = "All";
let currentSectionFilter = "All";
let currentDeptFilter = "All";
let currentCycleFilter = "All";

export function render(root, ctx) {
    lazyListen("performanceRosters");
    const role = normaliseRole(ctx.user.role);
    const isManager = ["Super Admin", "Admin", "Principal", "Vice Principal", "HR"].includes(role);

    root.appendChild(pageHead("Performance Cycle Roster", "Maintain the master roster of staff performance cycles and assignments."));

    const content = el("div");
    root.appendChild(content);
    
    // Top bar: Active Assessment Roster + Assign Staff to Cycle button
    const topBar = el("div", { class: "row", style: "justify-content:space-between; align-items:center; margin-bottom: 20px;" });
    topBar.appendChild(el("h3", { text: "Active Assessment Roster", style: "margin:0;" }));
    
    if (isManager) {
        const assignBtn = btn("+ Assign Staff to Cycle", { variant: "primary", onclick: () => {
            openAssignmentModal();
        }});
        topBar.appendChild(assignBtn);
    }
    content.appendChild(topBar);

    // Filters card
    const filterCard = card();
    filterCard.style.marginBottom = "20px";
    const filterRow = el("div", { class: "row", style: "align-items:flex-end; gap: 20px; flex-wrap:wrap;" });
    
    const terms = db.list("settings").find(s => s.id === "terms")?.options || ["1st Term", "2nd Term", "3rd Term"];
    const sessions = db.list("settings").find(s => s.id === "sessions")?.options || ["2025/2026"];
    if (!currentTerm) currentTerm = terms[0];
    if (!currentSession) currentSession = sessions[0];
    
    const staffList = db.list("staff");
    const sections = ["All", ...new Set(staffList.map(s => s.section).filter(Boolean))];
    const departments = ["All", ...new Set(staffList.map(s => s.department).filter(Boolean))];
    const staffNames = ["All", ...staffList.map(s => s.name)];
    const cycles = ["All", "Weekly", "Monthly", "Termly"];
    
    const staffSel = select(() => staffNames.map(s => ({ value: s, label: s, selected: s === currentStaffFilter })));
    const sectionSel = select(() => sections.map(s => ({ value: s, label: s, selected: s === currentSectionFilter })));
    const deptSel = select(() => departments.map(d => ({ value: d, label: d, selected: d === currentDeptFilter })));
    const cycleSel = select(() => cycles.map(c => ({ value: c, label: c, selected: c === currentCycleFilter })));
    
    staffSel.addEventListener("change", () => { currentStaffFilter = staffSel.value; loadRoster(); });
    sectionSel.addEventListener("change", () => { currentSectionFilter = sectionSel.value; loadRoster(); });
    deptSel.addEventListener("change", () => { currentDeptFilter = deptSel.value; loadRoster(); });
    cycleSel.addEventListener("change", () => { currentCycleFilter = cycleSel.value; loadRoster(); });
    
    filterRow.appendChild(field("Staff Member", staffSel));
    filterRow.appendChild(field("Section", sectionSel));
    filterRow.appendChild(field("Department", deptSel));
    filterRow.appendChild(field("Cycle", cycleSel));
    
    const termSel = select(() => terms.map(t => ({ value: t, label: t, selected: t === currentTerm })));
    const sessionSel = select(() => sessions.map(s => ({ value: s, label: s, selected: s === currentSession })));
    termSel.addEventListener("change", () => { currentTerm = termSel.value; loadRoster(); });
    sessionSel.addEventListener("change", () => { currentSession = sessionSel.value; loadRoster(); });
    
    filterRow.appendChild(field("Term", termSel));
    filterRow.appendChild(field("Session", sessionSel));

    filterCard.appendChild(filterRow);
    content.appendChild(filterCard);
    
    const rosterCard = card();
    rosterCard.appendChild(el("h3", { text: "Roster Assignments", style: "margin-bottom:20px; border-bottom: 1px solid #eee; padding-bottom: 10px;" }));
    const tableContainer = el("div");
    rosterCard.appendChild(tableContainer);
    content.appendChild(rosterCard);

    // Modal UI Elements
    let modalOverlay = null;
    
    function openAssignmentModal(existingRecord = null) {
        if (modalOverlay) document.body.removeChild(modalOverlay);
        
        modalOverlay = el("div", { 
            style: "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:9999; display:flex; justify-content:center; align-items:center;" 
        });

        const modalBox = el("div", { class: "card", style: "width: 500px; padding: 0; display:flex; flex-direction:column; overflow: hidden;" });
        
        // Modal Header
        const modalHeader = el("div", { style: "padding: 15px 20px; border-bottom: 1px solid #eee; display:flex; justify-content:space-between; align-items:center; background: #fff;" });
        modalHeader.appendChild(el("h3", { text: existingRecord ? "Update Roster Assignment" : "Update Roster Assignment", style: "margin:0; font-size:1.2rem; color:#1a1f36;" }));
        const closeIcon = el("span", { text: "✕", style: "cursor:pointer; font-weight:bold; color:#777; font-size:1.2rem;" });
        closeIcon.onclick = () => document.body.removeChild(modalOverlay);
        modalHeader.appendChild(closeIcon);
        modalBox.appendChild(modalHeader);

        // Modal Body
        const modalBody = el("div", { style: "padding: 20px; display:flex; flex-direction:column; gap:20px; background: #fff;" });
        
        const row1 = el("div", { class: "row", style: "gap:20px; display:flex;" });
        
        // Staff Member Dropdown
        const allStaffOpts = staffList.map(s => ({ value: s.id, label: s.name, selected: existingRecord && existingRecord.staffId === s.id }));
        const mStaffSel = select(() => [{value: "", label: "Select Staff..."}, ...allStaffOpts]);
        const fStaff = field("Staff Member", mStaffSel);
        fStaff.style.flex = "1";
        
        // Supervisor Dropdown
        const supervisors = staffList.filter(s => ["Admin", "Principal", "Vice Principal", "HR"].includes(normaliseRole(s.role)));
        const superOpts = [{value: "Self / System Default", label: "Self / System Default", selected: !existingRecord || existingRecord.supervisor === "Self / System Default"}];
        supervisors.forEach(s => superOpts.push({ value: s.id, label: s.name, selected: existingRecord && existingRecord.supervisor === s.id }));
        const mSuperSel = select(() => superOpts);
        const fSuper = field("Designated Supervisor / Evaluator", mSuperSel);
        fSuper.style.flex = "1";
        
        row1.appendChild(fStaff);
        row1.appendChild(fSuper);
        modalBody.appendChild(row1);

        const row2 = el("div", { class: "row", style: "gap:20px; display:flex;" });
        
        // Cycle Dropdown
        const mCycleSel = select(() => [
            {value: "Weekly", label: "Weekly", selected: !existingRecord || existingRecord.cycle === "Weekly"},
            {value: "Monthly", label: "Monthly", selected: existingRecord && existingRecord.cycle === "Monthly"},
            {value: "Termly", label: "Termly", selected: existingRecord && existingRecord.cycle === "Termly"}
        ]);
        const fCycle = field("Assessment Cycle", mCycleSel);
        fCycle.style.flex = "1";

        // Status Dropdown
        const mStatusSel = select(() => [
            {value: "Active", label: "Active", selected: !existingRecord || existingRecord.status === "Active"},
            {value: "Inactive", label: "Inactive", selected: existingRecord && existingRecord.status === "Inactive"}
        ]);
        const fStatus = field("Roster Status", mStatusSel);
        fStatus.style.flex = "1";

        row2.appendChild(fCycle);
        row2.appendChild(fStatus);
        modalBody.appendChild(row2);
        
        modalBox.appendChild(modalBody);

        // Modal Footer
        const modalFooter = el("div", { style: "padding: 15px 20px; border-top: 1px solid #eee; display:flex; justify-content:flex-end; gap:10px; background: #fff;" });
        
        const updateBtn = btn(existingRecord ? "Update" : "Update", { variant: "primary", onclick: () => {
            if (!mStaffSel.value) {
                toast("Please select a staff member.", "error");
                return;
            }
            
            const recId = existingRecord ? existingRecord.id : uuid();
            const payload = {
                id: recId,
                staffId: mStaffSel.value,
                supervisor: mSuperSel.value,
                cycle: mCycleSel.value,
                status: mStatusSel.value,
                term: currentTerm,
                session: currentSession,
                by: ctx.user.email,
                at: Date.now()
            };
            
            db.save("performanceRosters", payload);
            toast("Roster assignment updated.", "success");
            document.body.removeChild(modalOverlay);
            loadRoster();
        }});
        updateBtn.style.padding = "8px 24px";
        updateBtn.style.background = "#0d47a1"; // Deep blue from screenshot
        updateBtn.style.borderColor = "#0d47a1";

        const cancelBtn = btn("Cancel", { variant: "outline", onclick: () => document.body.removeChild(modalOverlay) });
        cancelBtn.style.padding = "8px 24px";
        cancelBtn.style.background = "#fff";
        cancelBtn.style.border = "1px solid #ddd";
        cancelBtn.style.color = "#333";
        
        modalFooter.appendChild(updateBtn);
        modalFooter.appendChild(cancelBtn);
        modalBox.appendChild(modalFooter);

        modalOverlay.appendChild(modalBox);
        document.body.appendChild(modalOverlay);
    }

    function loadRoster() {
        tableContainer.innerHTML = "";
        
        let rosters = db.query("performanceRosters", p => p.session === currentSession && p.term === currentTerm);
        
        // Map rosters to staff
        let mapped = rosters.map(r => {
            const staff = staffList.find(s => s.id === r.staffId) || { name: "Unknown Staff", section: "-", department: "-" };
            return { ...r, staffName: staff.name, section: staff.section || "-", dept: staff.department || "-" };
        });

        // Apply filters
        if (currentStaffFilter !== "All") mapped = mapped.filter(r => r.staffName === currentStaffFilter);
        if (currentSectionFilter !== "All") mapped = mapped.filter(r => r.section === currentSectionFilter);
        if (currentDeptFilter !== "All") mapped = mapped.filter(r => r.dept === currentDeptFilter);
        if (currentCycleFilter !== "All") mapped = mapped.filter(r => r.cycle === currentCycleFilter);
        
        if (!mapped.length) {
            tableContainer.appendChild(el("p", { class: "muted", text: "No roster assignments found matching filters." }));
            return;
        }

        const header = ["S/N", "Staff Name", "Department", "Designated Supervisor", "Cycle", "Status"];
        if (isManager) header.push("Actions");

        const rows = mapped.map((r, i) => {
            let supervisorName = r.supervisor;
            if (r.supervisor !== "Self / System Default") {
                const supStaff = staffList.find(s => s.id === r.supervisor);
                if (supStaff) supervisorName = supStaff.name;
            }

            const statusBadge = el("span", { 
                text: r.status, 
                style: `padding: 4px 8px; border-radius: 4px; font-size: 0.85em; background: ${r.status === 'Active' ? '#e6f4ea' : '#fce8e6'}; color: ${r.status === 'Active' ? '#137333' : '#c5221f'};` 
            });

            const rowData = [
                i + 1,
                r.staffName,
                r.dept,
                supervisorName,
                r.cycle,
                statusBadge
            ];

            if (isManager) {
                const editBtn = btn("Update", { variant: "outline", style: "padding: 4px 8px; font-size: 0.85em;", onclick: () => {
                    openAssignmentModal(r);
                }});
                rowData.push(editBtn);
            }

            return rowData;
        });

        tableContainer.appendChild(table(header, rows));
    }

    // Auto load
    loadRoster();
}
