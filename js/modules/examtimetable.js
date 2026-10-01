import { db } from "../core/db.js";
import { el, toast, uuid, fmtDate, todayISO } from "../core/utils.js";
import { card, pageHead, table, btn, select, input, field } from "../core/ui.js";
import { printHtml } from "../core/print.js";
import { headerHtml } from "../core/branding.js";
import { normaliseRole } from "../core/rbac.js";
import * as cfg from "../core/config.js";

function getDevice() {
    return navigator.userAgent.substring(0, 100);
}

// Basic time overlap check
function isOverlapping(start1, end1, start2, end2) {
    if (!start1 || !end1 || !start2 || !end2) return false;
    return (start1 < end2 && start2 < end1);
}

export function render(root, ctx) {
    const role = normaliseRole(ctx.user.role);
    const isManager = ["Super Admin", "Admin", "Principal", "Vice Principal", "Exam Officer"].includes(role);
    const isParent = role === "Parent";
    const isStudent = role === "Student";

    root.appendChild(pageHead("General Exam Timetable", "Manage and view upcoming examinations."));

    const tabs = el("div", { class: "row", style: "margin-bottom:14px" });
    tabs.appendChild(btn("View Timetable", { variant: "primary", onclick: renderView }));
    if (isManager) {
        tabs.appendChild(btn("Create / Edit", { onclick: renderCreate }));
    }
    root.appendChild(tabs);
    
    const content = el("div");
    root.appendChild(content);

    function renderView() {
        content.innerHTML = "";
        
        let availableClasses = ["All", ...cfg.classes().map(c => c.name)];
        if (isParent || isStudent) {
            // For parents/students, default to their specific classes
            const userStudents = isParent ? db.query("students", s => s.familyId === ctx.user.familyId) : [db.get("students", ctx.user.studentId)];
            const myClasses = userStudents.filter(Boolean).map(s => s.classId || s.class);
            if (myClasses.length) {
                availableClasses = myClasses;
                content.appendChild(el("div", { class: "alert alert-info", text: "Showing Upcoming Exams for your specific classes." }));
            }
        }
        
        const filterRow = el("div", { class: "row card", style: "align-items:flex-end; gap: 10px; margin-bottom: 20px" });
        const classSel = select(() => isManager ? availableClasses : availableClasses);
        const typeSel = select(() => ["All", "CA Test", "Mid-Term", "Promotion Exam", "Mock Exam", "WAEC", "NECO"]);
        
        if (isManager) {
            filterRow.appendChild(field("Filter by Class", classSel));
        } else if (availableClasses.length > 1) {
            filterRow.appendChild(field("Filter by Class", classSel));
        }
        
        filterRow.appendChild(field("Exam Type", typeSel));
        
        const loadBtn = btn("Filter", { onclick: loadGrid });
        filterRow.appendChild(loadBtn);
        
        if (isManager) {
            const pubBtn = btn("Publish & Notify", { variant: "primary", style: "margin-left: 20px", onclick: publishTimetable });
            filterRow.appendChild(pubBtn);
        }
        
        content.appendChild(filterRow);
        
        const gridContainer = el("div");
        content.appendChild(gridContainer);

        function loadGrid() {
            gridContainer.innerHTML = "";
            let timetable = db.list("examTimetable");
            
            const clsFilter = isManager ? classSel.value : (classSel.value || availableClasses[0]);
            
            if (clsFilter && clsFilter !== "All") timetable = timetable.filter(t => t.cls === clsFilter);
            if (typeSel.value !== "All") timetable = timetable.filter(t => t.examType === typeSel.value);
            
            // Sort by date then time
            timetable.sort((a, b) => a.examDate.localeCompare(b.examDate) || a.startTime.localeCompare(b.startTime));

            if (!timetable.length) {
                gridContainer.appendChild(el("p", { class: "muted", text: "No exams scheduled." }));
                return;
            }

            const header = ["Date", "Day", "Time", "Class", "Subject", "Type", "Venue", "Supervisor"];
            if (isManager) header.push("Action");
            
            const rows = timetable.map(t => {
                const tr = [
                    fmtDate(t.examDate),
                    new Date(t.examDate).toLocaleDateString('en-US', { weekday: 'long' }),
                    `${t.startTime} - ${t.endTime}`,
                    t.cls,
                    t.subject,
                    t.examType,
                    t.venue,
                    t.supervisor
                ];
                if (isManager) {
                    const acts = el("div", { class: "row", style: "gap: 5px;" });
                    acts.appendChild(btn("Edit", { onclick: () => renderCreate(t) }));
                    acts.appendChild(btn("Del", { variant: "danger", onclick: () => deleteExam(t.id) }));
                    tr.push(acts);
                }
                return tr;
            });

            gridContainer.appendChild(table(header, rows));
            
            if (isManager || isParent || isStudent) {
                const printBtn = btn("Print Timetable / PDF", { style: "margin-top: 20px;", onclick: () => printTimetable(timetable, clsFilter) });
                gridContainer.appendChild(printBtn);
            }
        }
        
        loadGrid();
    }
    
    async function publishTimetable() {
        if (!confirm("Are you sure you want to publish the timetable? This will send SMS and WhatsApp notifications to Parents and Students.")) return;
        toast("Publishing Timetable...", "info");
          try {
              const { sendSms } = await import("../core/sms.js");
              const students = db.query("students", s => s.status === "active" && s.parentPhone);
              let successCount = 0;
              for (const s of students) {
                  const phone = String(s.parentPhone || "").replace(/\D/g, "");
                  if (phone.length > 5) {
                      await sendSms(phone, "CIC KANO Notification: The General Exam Timetable has been published. Please check the Parent Portal for details.");
                      successCount++;
                  }
              }
              toast(`Timetable Published! Notifications sent to ${successCount} parents via SMS.`, "success");
          } catch(e) {
              toast("Timetable saved, but notification delivery failed: " + e.message, "error");
          }
    }
    
    function deleteExam(id) {
        if (!confirm("Delete this exam slot?")) return;
        db.remove("examTimetable", id);
        toast("Deleted");
        renderView();
    }

    function renderCreate(existingSlot = null) {
        content.innerHTML = "";
        const s = existingSlot || {};
        
        const form = el("div", { class: "card", style: "max-width: 600px; display: grid; grid-template-columns: 1fr 1fr; gap: 15px;" });
        
        const typeSel = select(() => ["CA Test", "Mid-Term", "Promotion Exam", "Mock Exam", "WAEC", "NECO"], s.examType);
        const classSel = select(() => cfg.classes().map(c => c.name), s.cls);
        const subjInput = input({ type: "text", value: s.subject || "" });
        const dateInput = input({ type: "date", value: s.examDate || todayISO() });
        const startInput = input({ type: "time", value: s.startTime || "08:00" });
        const endInput = input({ type: "time", value: s.endTime || "10:00" });
        const venueInput = input({ type: "text", value: s.venue || "Main Hall" });
        const supInput = input({ type: "text", value: s.supervisor || "" });
        
        form.appendChild(field("Exam Type", typeSel));
        form.appendChild(field("Class", classSel));
        form.appendChild(field("Subject", subjInput));
        form.appendChild(field("Exam Date", dateInput));
        form.appendChild(field("Start Time", startInput));
        form.appendChild(field("End Time", endInput));
        form.appendChild(field("Venue", venueInput));
        form.appendChild(field("Supervisor", supInput));
        
        content.appendChild(form);
        
        const saveBtn = btn("Save Exam Slot", { variant: "primary", style: "margin-top: 15px", onclick: () => {
            const date = dateInput.value;
            const st = startInput.value;
            const en = endInput.value;
            const cls = classSel.value;
            const ven = venueInput.value;
            const sup = supInput.value;
            
            // CLASH DETECTION
            const allExams = db.list("examTimetable").filter(x => x.id !== s.id && x.examDate === date);
            for (const x of allExams) {
                if (isOverlapping(st, en, x.startTime, x.endTime)) {
                    if (x.cls === cls) {
                        toast(`Clash Detected! Class ${cls} already has an exam (${x.subject}) at this time.`, "error");
                        return;
                    }
                    if (x.venue === ven) {
                        toast(`Clash Detected! Venue ${ven} is occupied by Class ${x.cls} at this time.`, "error");
                        return;
                    }
                    if (x.supervisor === sup && sup.trim() !== "") {
                        toast(`Clash Detected! Supervisor ${sup} is invigilating Class ${x.cls} at this time.`, "error");
                        return;
                    }
                }
            }
            
            const data = {
                id: s.id || uuid(),
                examType: typeSel.value,
                cls,
                subject: subjInput.value,
                examDate: date,
                startTime: st,
                endTime: en,
                venue: ven,
                supervisor: sup,
                createdBy: s.createdBy || ctx.user.email,
                createdAt: s.createdAt || Date.now(),
                updatedBy: ctx.user.email,
                updatedAt: Date.now(),
                device: getDevice()
            };
            db.save("examTimetable", data);
            toast("Exam scheduled successfully!");
            renderView();
        }});
        
        content.appendChild(saveBtn);
    }

    function printTimetable(timetable, filterLabel) {
        let html = headerHtml();
        html += `<h2 style="text-align:center">GENERAL EXAM TIMETABLE</h2>`;
        html += `<p style="text-align:center; font-weight:bold;">Showing: ${filterLabel || "Entire School"}</p>`;
        
        html += `<table><thead><tr>
            <th>Date</th>
            <th>Day</th>
            <th>Time</th>
            <th>Class</th>
            <th>Subject</th>
            <th>Venue</th>
            <th>Supervisor</th>
        </tr></thead><tbody>`;
        
        timetable.forEach((t) => {
            html += `<tr>
                <td>${fmtDate(t.examDate)}</td>
                <td>${new Date(t.examDate).toLocaleDateString('en-US', { weekday: 'long' })}</td>
                <td>${t.startTime} - ${t.endTime}</td>
                <td>${t.cls}</td>
                <td>${t.subject}</td>
                <td>${t.venue}</td>
                <td>${t.supervisor}</td>
            </tr>`;
        });
        html += `</tbody></table>`;
        printHtml(html);
    }

    renderView();
}
