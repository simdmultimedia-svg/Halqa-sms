import { db } from "../core/db.js";
import { lazyListen } from "../core/adapter.js";
import { el, toast, uuid, fmtDate, num } from "../core/utils.js";
import { card, pageHead, table, btn, select, input, field } from "../core/ui.js";
import { printHtml } from "../core/print.js";
import { headerHtml } from "../core/branding.js";
import { normaliseRole } from "../core/rbac.js";
import { naira } from "../core/utils.js";

const MAX_SCORES = {
    punctuality: 5,
    duty: 5,
    language: 5,
    planning: 5,
    management: 10,
    checking: 5,
    assignments: 10,
    studentsPerf: 15
};

function calculateGrade(percentage) {
    const p = Number(percentage);
    if (p >= 90) return { grade: "Excellent", remark: "Outstanding performance." };
    if (p >= 80) return { grade: "Very Good", remark: "Highly committed and productive." };
    if (p >= 70) return { grade: "Good", remark: "Good performance with room for improvement." };
    if (p >= 60) return { grade: "Fair", remark: "Needs closer supervision." };
    return { grade: "Poor", remark: "Immediate improvement required." };
}

function calculateRecordTotals(record) {
    let monthlyTotal = 0;
    let monthlyBonus = 0;
    let activeWeeks = 0;
    
    ['week1', 'week2', 'week3', 'week4'].forEach(wk => {
        if (record[wk] && typeof record[wk] === 'object') {
            const w = record[wk];
            const weeklyTotal = Number(w.punctuality || 0) + Number(w.duty || 0) + Number(w.language || 0) + 
                                Number(w.planning || 0) + Number(w.management || 0) + Number(w.checking || 0) + 
                                Number(w.assignments || 0) + Number(w.studentsPerf || 0);
            w.total = weeklyTotal;
            w.bonus = weeklyTotal >= 50 ? 500 : 0;
            
            monthlyTotal += weeklyTotal;
            monthlyBonus += w.bonus;
            activeWeeks++;
        }
    });

    record.monthlyTotal = monthlyTotal;
    record.monthlyBonus = monthlyBonus;
    record.monthlyAverage = activeWeeks > 0 ? (monthlyTotal / activeWeeks).toFixed(2) : 0;
    record.percentage = ((monthlyTotal / 240) * 100).toFixed(2);
    
    const evalRes = calculateGrade(record.percentage);
    record.grade = evalRes.grade;
    record.remarks = evalRes.remark;
    record.updatedAt = Date.now();
    return record;
}

export function render(root, ctx) {
    lazyListen("staffPerformance");
    const role = normaliseRole(ctx.user.role);
    const isManager = ["Super Admin", "Admin", "Principal", "Vice Principal", "HR"].includes(role);

    root.appendChild(pageHead("Staff Weekly Performance Record", "Evaluate staff activities and manage monthly performance."));

    const tabs = el("div", { class: "row", style: "margin-bottom:14px" }, [
        btn("Record Performance", { variant: "primary", onclick: renderRecord }),
        btn("View Analytics", { onclick: renderAnalytics })
    ]);
    root.appendChild(tabs);
    
    const content = el("div");
    root.appendChild(content);

    function getMonthsList() {
        const months = [];
        const d = new Date();
        for (let i = 0; i < 12; i++) {
            const temp = new Date(d.getFullYear(), d.getMonth() - i, 1);
            months.push(temp.toISOString().substring(0, 7)); // YYYY-MM
        }
        return months;
    }

    function renderRecord() {
        content.innerHTML = "";
        
        const filterRow = el("div", { class: "row card", style: "align-items:flex-end; gap: 10px; margin-bottom: 10px" });
        const termSel = select(() => db.list("settings").find(s => s.id === "terms")?.options || ["1st Term", "2nd Term", "3rd Term"]);
        const sessionSel = select(() => db.list("settings").find(s => s.id === "sessions")?.options || ["2025/2026"]);
        const monthSel = select(() => getMonthsList());
        const weekSel = select(() => ["week1", "week2", "week3", "week4"]);
        
        filterRow.appendChild(field("Session", sessionSel));
        filterRow.appendChild(field("Term", termSel));
        filterRow.appendChild(field("Month", monthSel));
        filterRow.appendChild(field("Week", weekSel));
        
        const filterRow2 = el("div", { class: "row card", style: "align-items:flex-end; gap: 10px; margin-bottom: 20px" });
        
        const allStaff = db.list("staff");
        const depts = ["All", ...new Set(allStaff.map(s => s.department).filter(Boolean))];
        const roles = ["All", ...new Set(allStaff.map(s => s.role).filter(Boolean))];
        
        const nameFilter = input({ placeholder: "Search staff name..." });
        const deptFilter = select(() => depts);
        const roleFilter = select(() => roles);
        
        filterRow2.appendChild(field("Department", deptFilter));
        filterRow2.appendChild(field("Designation", roleFilter));
        filterRow2.appendChild(field("Staff Name", nameFilter));
        
        const loadBtn = btn("Load Staff", { onclick: loadStaffList });
        filterRow2.appendChild(loadBtn);
        
        content.appendChild(filterRow);
        content.appendChild(filterRow2);
        
        const tableContainer = el("div");
        content.appendChild(tableContainer);

        function loadStaffList() {
            tableContainer.innerHTML = "";
            let staffList = db.list("staff");
            
            if (deptFilter.value !== "All") staffList = staffList.filter(s => s.department === deptFilter.value);
            if (roleFilter.value !== "All") staffList = staffList.filter(s => s.role === roleFilter.value);
            if (nameFilter.value.trim()) staffList = staffList.filter(s => s.name.toLowerCase().includes(nameFilter.value.trim().toLowerCase()));

            if (!isManager) {
                staffList = staffList.filter(s => s.id === ctx.user.staffId || s.email === ctx.user.email);
            }
            if (!staffList.length) {
                tableContainer.appendChild(el("p", { class: "muted", text: "No staff found." }));
                return;
            }

            const term = termSel.value;
            const session = sessionSel.value;
            const month = monthSel.value;
            const week = weekSel.value;
            
            const records = db.query("staffPerformance", p => p.session === session && p.term === term && p.month === month);
            
            let existingRoster = {};
            const rosterWeekNum = week.replace("week", "");
            const rosterQuery = db.query("staffRosters", p => p.session === session && p.term === term && p.week == rosterWeekNum);
            if (rosterQuery.length > 0) {
                existingRoster = rosterQuery[0].roster || {};
            }
            
            const header = ["S/N", "Staff Name", "Rostered Duty", "Punctuality (5)", "Duty (5)", "Language (5)", "Planning (5)", "Mgmt (10)", "Checking (5)", "Assignments (10)", "Students (15)", "Wk Total", "Action"];
            const rows = staffList.map((s, i) => {
                let rec = records.find(r => r.staffId === s.id);
                const curWeek = rec && rec[week] ? rec[week] : {};
                
                const mInput = (val, max) => {
                    const inp = input({ type: "number", value: val || "", min: 0, max: max, style: "width:60px" });
                    if (!isManager) inp.disabled = true;
                    return inp;
                };

                const i1 = mInput(curWeek.punctuality, MAX_SCORES.punctuality);
                const i2 = mInput(curWeek.duty, MAX_SCORES.duty);
                const i3 = mInput(curWeek.language, MAX_SCORES.language);
                const i4 = mInput(curWeek.planning, MAX_SCORES.planning);
                const i5 = mInput(curWeek.management, MAX_SCORES.management);
                const i6 = mInput(curWeek.checking, MAX_SCORES.checking);
                const i7 = mInput(curWeek.assignments, MAX_SCORES.assignments);
                const i8 = mInput(curWeek.studentsPerf, MAX_SCORES.studentsPerf);

                const totalSpan = el("b", { text: curWeek.total || 0 });
                
                const saveRowBtn = isManager ? btn("Save", { sm: true, variant: "primary", onclick: () => {
                    if (!rec) {
                        rec = {
                            id: uuid(), performanceId: uuid(),
                            staffId: s.id, staffName: s.name,
                            month, session, term,
                            createdAt: Date.now(), createdBy: ctx.user.email
                        };
                    }
                    
                    rec[week] = {
                        punctuality: num(i1.value),
                        duty: num(i2.value),
                        language: num(i3.value),
                        planning: num(i4.value),
                        management: num(i5.value),
                        checking: num(i6.value),
                        assignments: num(i7.value),
                        studentsPerf: num(i8.value)
                    };
                    
                    rec = calculateRecordTotals(rec);
                    db.save("staffPerformance", rec);
                    toast("Saved performance for " + s.name, "success");
                    totalSpan.textContent = rec[week].total;
                }}) : el("span", { text: "-" });

                return [
                    i + 1,
                    s.name,
                    existingRoster[s.id] ? el("span", { style: "font-weight:600; color:#555;" }, existingRoster[s.id]) : el("span", { class: "muted", text: "-" }),
                    i1, i2, i3, i4, i5, i6, i7, i8,
                    totalSpan,
                    saveRowBtn
                ];
            });

            tableContainer.appendChild(table(header, rows));
            
            if (isManager) {
                const printAllBtn = btn("Print Monthly Report", { variant: "success", style: "margin-top: 20px;", onclick: () => {
                    printMonthlyReport(month, session, term, staffList, records);
                }});
                tableContainer.appendChild(printAllBtn);
            }
        }
    }

    function renderAnalytics() {
        content.innerHTML = "";
        const allRecords = db.list("staffPerformance").sort((a, b) => b.createdAt - a.createdAt);
        
        if (!allRecords.length) {
            content.appendChild(el("p", { class: "muted", text: "No performance data available." }));
            return;
        }

        const filterRow = el("div", { class: "row card", style: "margin-bottom: 20px; align-items:flex-end; gap: 10px;" });
        const monthSel = select(() => getMonthsList());
        filterRow.appendChild(field("Month", monthSel));
        filterRow.appendChild(btn("Update Dash", { onclick: () => drawDash(monthSel.value) }));
        content.appendChild(filterRow);
        
        const dashContainer = el("div");
        content.appendChild(dashContainer);

        function drawDash(month) {
            dashContainer.innerHTML = "";
            let records = allRecords.filter(r => r.month === month);
            
            if (!isManager) {
                records = records.filter(r => r.staffId === ctx.user.staffId || r.createdBy === ctx.user.email);
            }

            if (!records.length) {
                dashContainer.appendChild(el("p", { class: "muted", text: "No data in this month." }));
                return;
            }

            if (isManager) {
                // Admin Widgets
                const totalBonus = records.reduce((sum, r) => sum + num(r.monthlyBonus), 0);
                const sorted = [...records].sort((a,b) => num(b.percentage) - num(a.percentage));
                const topStaff = sorted[0]?.staffName || "N/A";
                const lowStaff = sorted[sorted.length-1]?.staffName || "N/A";
                
                const widgets = el("div", { class: "grid grid-3", style: "margin-bottom:20px" }, [
                    card("Total Bonus Paid", `₦${totalBonus.toLocaleString()}`, { bg: "#e8f5e9" }),
                    card("Top Performer", topStaff, { bg: "#e3f2fd" }),
                    card("Lowest Performer", lowStaff, { bg: "#ffebee" })
                ]);
                dashContainer.appendChild(widgets);
            }

            const header = ["Staff Name", "Week 1", "Week 2", "Week 3", "Week 4", "Total (240)", "Percentage", "Grade", "Bonus", "Action"];
            const rows = records.map(r => {
                return [
                    r.staffName,
                    r.week1?.total || "-",
                    r.week2?.total || "-",
                    r.week3?.total || "-",
                    r.week4?.total || "-",
                    el("b", { text: r.monthlyTotal }),
                    `${r.percentage}%`,
                    el("b", { text: r.grade }),
                    naira(r.monthlyBonus),
                    btn("View Slip", { sm: true, onclick: () => printStaffSlip(r) })
                ];
            });

            dashContainer.appendChild(card("Monthly Rankings", table(header, rows)));
        }
        
        drawDash(monthSel.value);
    }

    function printStaffSlip(r) {
        let html = headerHtml();
        html += `<div style="text-align:center; margin-bottom: 20px;">
            <h2>STAFF MONTHLY PERFORMANCE APPRAISAL</h2>
            <p><b>Name:</b> ${r.staffName} &nbsp;&nbsp; <b>Month:</b> ${r.month} &nbsp;&nbsp; <b>Session:</b> ${r.session}</p>
        </div>`;
        
        html += `<table style="width:100%; border-collapse: collapse; margin-bottom: 20px;" border="1">
            <thead>
                <tr style="background:#f5f5f5">
                    <th>Criteria (Max Score)</th><th>Week 1</th><th>Week 2</th><th>Week 3</th><th>Week 4</th><th>Total</th>
                </tr>
            </thead>
            <tbody>`;
            
        const metrics = [
            { key: "punctuality", label: "Punctuality and Regularity (5)" },
            { key: "duty", label: "Weekly Duty Performance (5)" },
            { key: "language", label: "Use of Proper Language (5)" },
            { key: "planning", label: "Lesson Planning and Recording (5)" },
            { key: "management", label: "Class Management and Control (10)" },
            { key: "checking", label: "Checking Notes and Marking (5)" },
            { key: "assignments", label: "Assignments and Exercises (10)" },
            { key: "studentsPerf", label: "Students Performance (15)" }
        ];

        metrics.forEach(m => {
            const w1 = r.week1 ? (r.week1[m.key] || 0) : "-";
            const w2 = r.week2 ? (r.week2[m.key] || 0) : "-";
            const w3 = r.week3 ? (r.week3[m.key] || 0) : "-";
            const w4 = r.week4 ? (r.week4[m.key] || 0) : "-";
            const tot = (num(w1)+num(w2)+num(w3)+num(w4)) || 0;
            html += `<tr><td>${m.label}</td><td class="center">${w1}</td><td class="center">${w2}</td><td class="center">${w3}</td><td class="center">${w4}</td><td class="center"><b>${tot}</b></td></tr>`;
        });
        
        html += `<tr style="background:#f9f9f9; font-weight:bold;">
            <td>WEEKLY TOTALS (Max 60)</td>
            <td class="center">${r.week1?.total || "-"}</td><td class="center">${r.week2?.total || "-"}</td><td class="center">${r.week3?.total || "-"}</td><td class="center">${r.week4?.total || "-"}</td><td class="center">${r.monthlyTotal}</td>
        </tr>`;
        html += `</tbody></table>`;
        
        html += `<table style="width:50%; border-collapse: collapse; margin-bottom: 30px;" border="1">
            <tr><td><b>Monthly Percentage</b></td><td>${r.percentage}%</td></tr>
            <tr><td><b>Performance Grade</b></td><td>${r.grade}</td></tr>
            <tr><td><b>Bonus Earned</b></td><td>${naira(r.monthlyBonus)}</td></tr>
            <tr><td><b>Remarks</b></td><td>${r.remarks}</td></tr>
        </table>`;
        
        html += `<div style="display:flex; justify-content:space-between; margin-top: 50px;">
            <div style="text-align:center; border-top:1px solid #000; width: 250px; padding-top:5px;">Principal's Signature</div>
            <div style="text-align:center; border-top:1px solid #000; width: 250px; padding-top:5px;">HR / Admin Signature</div>
        </div>`;
        
        printHtml(html);
    }

    function printMonthlyReport(month, session, term, staffList, records) {
        let html = headerHtml();
        html += `<div style="text-align:center; margin-bottom: 20px;">
            <h2>STAFF MONTHLY PERFORMANCE SUMMARY</h2>
            <p><b>Month:</b> ${month} &nbsp;&nbsp; <b>Session:</b> ${session} &nbsp;&nbsp; <b>Term:</b> ${term}</p>
        </div>`;
        
        html += `<table style="width:100%; border-collapse: collapse;" border="1">
            <thead style="background:#f5f5f5">
                <tr><th>S/N</th><th>Staff Name</th><th>Wk 1</th><th>Wk 2</th><th>Wk 3</th><th>Wk 4</th><th>Monthly Total (240)</th><th>%</th><th>Grade</th><th>Bonus (₦)</th></tr>
            </thead>
            <tbody>`;
            
        staffList.forEach((s, i) => {
            const r = records.find(x => x.staffId === s.id);
            if (!r) return;
            html += `<tr>
                <td class="center">${i+1}</td>
                <td>${s.name}</td>
                <td class="center">${r.week1?.total || "-"}</td>
                <td class="center">${r.week2?.total || "-"}</td>
                <td class="center">${r.week3?.total || "-"}</td>
                <td class="center">${r.week4?.total || "-"}</td>
                <td class="center"><b>${r.monthlyTotal}</b></td>
                <td class="center">${r.percentage}%</td>
                <td class="center">${r.grade}</td>
                <td class="right">${num(r.monthlyBonus).toLocaleString()}</td>
            </tr>`;
        });
        
        html += `</tbody></table>`;
        
        html += `<div style="display:flex; justify-content:space-between; margin-top: 50px;">
            <div style="text-align:center; border-top:1px solid #000; width: 250px; padding-top:5px;">Principal's Signature</div>
            <div style="text-align:center; border-top:1px solid #000; width: 250px; padding-top:5px;">HR / Admin Signature</div>
        </div>`;
        
        printHtml(html);
    }

    renderRecord();
}
