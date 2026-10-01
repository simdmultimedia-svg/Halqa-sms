import { db } from "../core/db.js";
import { el, toast, uuid, fmtDate, modal } from "../core/utils.js";
import { pageHead, card, table, btn, select, field } from "../core/ui.js";
import { canAccess, normaliseRole } from "../core/rbac.js";
import * as cfg from "../core/config.js";

export function render(root, ctx) {
    const role = normaliseRole(ctx.user.role);
    const isManager = ["Super Admin", "Admin", "Principal", "HR Officer"].includes(role);
    
    if (!isManager && !canAccess(role, "staffroster")) {
        root.appendChild(pageHead("Staff Roster", "Manage staff performance cycles."));
        root.appendChild(card("Access Denied", [el("p", { class: "muted", text: "You do not have permission to manage the staff roster." })]));
        return;
    }

    root.appendChild(pageHead("Staff Roster", "Maintain the master roster of staff performance cycles and assignments."));
    
    const host = el("div");
    root.appendChild(host);

    function drawDashboard() {
        host.innerHTML = "";
        
        const controls = el("div", { class: "row", style: "justify-content:space-between; margin-bottom:15px;" }, [
            el("h3", { text: "Active Assessment Roster" }),
            isManager ? btn("Assign Staff to Cycle", { variant: "primary", icon: "➕", onclick: showAssignmentModal }) : el("span")
        ]);
        
        host.appendChild(controls);

        const rosterData = db.list("staffRoster").sort((a, b) => b.updatedAt - a.updatedAt);
        
        // Simple filter state
        const filterSection = el("div", { class: "card row", style: "gap: 10px; align-items:flex-end; flex-wrap:wrap;" });
        
        const allRosterStaffIds = [...new Set(rosterData.map(r => r.staffId))];
        const staffFilterSel = select(() => ["All", ...allRosterStaffIds.map(id => {
            const staff = db.get("staff", id);
            return { value: id, label: staff ? staff.name : id };
        })]);
        
        const sectionSel = select(() => ["All", ...cfg.sections().map(s => s.name)]);
        const deptSel = select(() => ["All", "Academic", "Administrative", "Support"]);
        const cycleSel = select(() => ["All", "Weekly", "Bi-Weekly", "Monthly", "Termly"]);
        
        filterSection.appendChild(field("Staff Member", staffFilterSel));
        filterSection.appendChild(field("Section", sectionSel));
        filterSection.appendChild(field("Department", deptSel));
        filterSection.appendChild(field("Cycle", cycleSel));
        
        const renderTable = () => {
            const tbodyId = "roster-tbody-" + uuid();
            const tb = el("div", { id: tbodyId });
            
            const filtered = rosterData.filter(r => {
                if (staffFilterSel.value !== "All" && r.staffId !== staffFilterSel.value) return false;
                if (sectionSel.value !== "All" && r.section !== sectionSel.value) return false;
                if (deptSel.value !== "All" && r.department !== deptSel.value) return false;
                if (cycleSel.value !== "All" && r.assessmentCycle !== cycleSel.value) return false;
                return true;
            });
            
            const headers = ["Staff Name", "Designation", "Section", "Supervisor", "Cycle", "Last Updated", "Actions"];
            const rows = filtered.map(r => [
                el("div", { style: "font-weight:600", text: r.staffName }),
                r.designation || "-",
                r.section || "-",
                r.supervisorName || "-",
                el("span", { class: "badge", style: "background:#e3f2fd; color:#1976d2", text: r.assessmentCycle || "Weekly" }),
                fmtDate(r.updatedAt),
                isManager ? btn("Edit", { variant: "secondary", onclick: () => showAssignmentModal(r) }) : el("span")
            ]);
            
            tb.appendChild(table(headers, rows, { empty: "No staff assigned to performance roster." }));
            return tb;
        };
        
        const tableContainer = el("div");
        tableContainer.appendChild(renderTable());
        
        staffFilterSel.onchange = () => { tableContainer.innerHTML = ""; tableContainer.appendChild(renderTable()); };
        sectionSel.onchange = () => { tableContainer.innerHTML = ""; tableContainer.appendChild(renderTable()); };
        deptSel.onchange = () => { tableContainer.innerHTML = ""; tableContainer.appendChild(renderTable()); };
        cycleSel.onchange = () => { tableContainer.innerHTML = ""; tableContainer.appendChild(renderTable()); };
        
        host.appendChild(filterSection);
        host.appendChild(card("Roster Assignments", [tableContainer]));
    }

    function showAssignmentModal(existing = null) {
        const staffList = db.list("staff").filter(s => 
            (s.employmentStatus || "Active") === "Active" || (existing && s.id === existing.staffId)
        );
        if (staffList.length === 0) return toast("No active staff found.", "error");

        const isEdit = !!existing;
        
        const staffSel = select(() => [{value: "", label: "-- Select Staff Member --"}, ...staffList.map(s => ({ value: s.id, label: `${s.name} (${s.designation || "Staff"})` }))]);
        if (isEdit) {
            staffSel.value = existing.staffId;
        }

        const supervisors = staffList.filter(s => ["super-admin", "admin", "principal", "vice-principal", "hr-officer"].includes(normaliseRole(s.role)));
        const supervisorSel = select(() => [{value: "", label: "Self / System Default"}, ...supervisors.map(s => ({ value: s.id, label: s.name }))]);
        if (isEdit) supervisorSel.value = existing.supervisorId || "";

        const cycleSel = select(() => ["Weekly", "Bi-Weekly", "Monthly", "Termly"]);
        if (isEdit) cycleSel.value = existing.assessmentCycle || "Weekly";
        
        const statusSel = select(() => ["Active", "Suspended"]);
        if (isEdit) statusSel.value = existing.status || "Active";

        const m = modal({
            title: isEdit ? "Update Roster Assignment" : "Assign to Roster",
            body: el("div", { class: "form-grid" }, [
                field("Staff Member", staffSel),
                field("Designated Supervisor / Evaluator", supervisorSel),
                field("Assessment Cycle", cycleSel),
                field("Roster Status", statusSel)
            ]),
            footer: [
                btn(isEdit ? "Update" : "Assign", {
                    variant: "primary",
                    onclick: () => {
                        const staff = staffList.find(s => s.id === staffSel.value);
                        if (!staff) return toast("Select a valid staff member.", "error");
                        
                        let svName = "";
                        if (supervisorSel.value) {
                            const sv = supervisors.find(s => s.id === supervisorSel.value);
                            if (sv) svName = sv.name;
                        }

                        const payload = {
                            id: isEdit ? existing.id : uuid(),
                            staffId: staff.id,
                            staffName: staff.name,
                            designation: staff.designation || "-",
                            department: staff.department || "Academic",
                            section: cfg.sectionName(staff.sectionId) || "-",
                            supervisorId: supervisorSel.value,
                            supervisorName: svName,
                            assessmentCycle: cycleSel.value,
                            status: statusSel.value,
                            createdBy: isEdit ? existing.createdBy : ctx.user.email,
                            createdAt: isEdit ? existing.createdAt : Date.now(),
                            updatedAt: Date.now()
                        };

                        db.save("staffRoster", payload, { sync: true });
                        db.save("auditLogs", {
                            id: uuid(),
                            type: isEdit ? "STAFF_ROSTER_UPDATED" : "STAFF_ROSTER_CREATED",
                            uid: ctx.user.uid,
                            at: Date.now(),
                            message: `${isEdit ? "Updated" : "Added"} roster assignment for ${staff.name}`
                        });

                        toast(`Roster ${isEdit ? "updated" : "saved"} successfully.`, "success");
                        m.close();
                        drawDashboard();
                    }
                }),
                btn("Cancel", { onclick: () => m.close() })
            ]
        });
    }

    drawDashboard();
}
