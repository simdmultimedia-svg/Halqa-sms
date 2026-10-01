import { db } from "../core/db.js";
import { el, toast, todayISO, uuid } from "../core/utils.js";
import { card, pageHead, btn, input, field } from "../core/ui.js";
import { loginWithBiometric, registerKioskBiometric, scanKioskBiometric } from "../core/webauthn.js";
import { lazyListen } from "../core/adapter.js";
import { captureFingerprint, identifyFingerprint, fingerprintServiceAvailable } from "../core/fingerprint.js";
import { sha256 } from "../core/auth.js";

export function render(root, ctx) {
    lazyListen("kioskScans");
    root.appendChild(pageHead("Attendance Kiosk", "Biometric and manual staff clock-in / clock-out"));

    const wrap = el("div", { style: "display:flex; flex-direction:column; align-items:center; margin-top:40px; gap: 20px" });
    
    const timeDisplay = el("h1", { style: "font-size:48px; font-variant-numeric: tabular-nums; margin: 0" });
    const dateDisplay = el("div", { style: "font-size:20px; color:var(--muted)" });
    
    function updateClock() {
        const now = new Date();
        timeDisplay.textContent = now.toLocaleTimeString();
        dateDisplay.textContent = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }
    setInterval(updateClock, 1000);
    updateClock();

    wrap.appendChild(timeDisplay);
    wrap.appendChild(dateDisplay);

    const hardwareMode = el("div", { class: "row", style: "margin-top: 20px; align-items:center; gap: 8px" });
    const hwToggle = el("input", { type: "checkbox", id: "hw-toggle" });
    const hwStatus = el("span", { class: "muted", text: "External Scanner (DigitalPersona) Disconnected" });
    hardwareMode.appendChild(hwToggle);
    hardwareMode.appendChild(el("label", { text: "Enable DigitalPersona U.are.U Scanner Mode", for: "hw-toggle" }));
    
    let hwPollingActive = false;
    let registeringStaffEmail = null;
    const regStatus = el("div", { class: "alert alert-warning", style: "display:none; margin-top: 10px;" });
    hardwareMode.appendChild(regStatus);

    async function pollFingerprint() {
        if (!hwPollingActive) return;
        try {
            const capture = await captureFingerprint();
            if (capture.success && capture.template) {
                if (registeringStaffEmail) {
                    const staffDoc = db.find("staff", s => s.email === registeringStaffEmail);
                    if (staffDoc) {
                        db.save("fingerprints", { id: uuid(), ownerId: staffDoc.id, role: "staff", template: capture.template, createdAt: Date.now() });
                        toast(`Fingerprint registered for ${staffDoc.name}`, "success");
                        regStatus.style.display = "none";
                        registeringStaffEmail = null;
                        hwStatus.textContent = "DigitalPersona Scanner Ready — Waiting for finger...";
                        setTimeout(pollFingerprint, 2000);
                        return;
                    }
                }
                
                hwStatus.textContent = "Fingerprint Captured! Identifying...";
                const allPrints = db.list("fingerprints").filter(f => f.role === "staff");
                
                if (allPrints.length > 0) {
                    const match = await identifyFingerprint(capture.template, allPrints.map(f => f.template));
                    if (match.success) {
                        const ownerId = allPrints[match.matchIndex].ownerId;
                        const staff = db.get("staff", ownerId) || db.query("staff", s => s.id === ownerId || s.uid === ownerId || s.staffId === ownerId)[0];
                        if (staff) {
                            hwStatus.textContent = `Identified: ${staff.name}!`;
                            document.body.style.transition = "background-color 0.3s";
                            document.body.style.backgroundColor = "var(--success-light, #dcfce7)";
                            setTimeout(() => { 
                                document.body.style.backgroundColor = ""; 
                                if (hwPollingActive) hwStatus.textContent = "DigitalPersona Scanner Ready — Waiting for finger...";
                            }, 1500);
                            
                            // Get actionSel from DOM
                            const actionSel = document.getElementById("kiosk-action-sel");
                            const action = actionSel ? actionSel.value : "auto";
                            clockStaff(staff, action);
                        } else {
                            toast("Staff record not found.", "error");
                            hwStatus.textContent = "DigitalPersona Scanner Ready — Waiting for finger...";
                        }
                    } else {
                        toast("Unrecognized Fingerprint.", "error");
                        hwStatus.textContent = "DigitalPersona Scanner Ready — Waiting for finger...";
                    }
                } else {
                    toast("No staff fingerprints enrolled.", "error");
                    hwStatus.textContent = "DigitalPersona Scanner Ready — Waiting for finger...";
                }
                
                setTimeout(pollFingerprint, 2000);
                return;
            }
        } catch (e) {
            console.warn("Polling error:", e);
        }
        if (hwPollingActive) setTimeout(pollFingerprint, 500);
    }

    hwToggle.onchange = async () => {
        if (hwToggle.checked) {
            hwStatus.textContent = "Connecting to DigitalPersona Local Service...";
            hwStatus.style.color = "var(--warning)";
            
            const isAvail = await fingerprintServiceAvailable();
            if (!isAvail) {
                hwStatus.textContent = "Service not found. Start DPServer.exe on port 8081.";
                hwStatus.style.color = "var(--danger)";
                hwToggle.checked = false;
                return;
            }
            
            hwStatus.textContent = "DigitalPersona Scanner Ready — Waiting for finger...";
            hwStatus.style.color = "var(--success)";
            
            hwPollingActive = true;
            pollFingerprint();
        } else {
            hwPollingActive = false;
            hwStatus.textContent = "External Scanner (DigitalPersona) Disconnected";
            hwStatus.style.color = "var(--muted)";
            regStatus.style.display = "none";
            registeringStaffEmail = null;
        }
    };

    wrap.appendChild(hardwareMode);
    wrap.appendChild(hwStatus);

    const actionSel = el("select", { id: "kiosk-action-sel", style: "padding: 8px; font-size: 16px; margin-top: 10px" }, [
        el("option", { value: "auto", text: "Auto (Check In / Check Out)" }),
        el("option", { value: "present", text: "Mark Present" }),
        el("option", { value: "late", text: "Mark Late (Deduction applies)" }),
        el("option", { value: "permission", text: "Permission / Excused" }),
        el("option", { value: "absent", text: "Mark Absent" })
    ]);
    wrap.appendChild(actionSel);

    const bioBtn = btn("Scan Fingerprint", { variant: "primary", style: "font-size:24px; padding:20px 40px; border-radius:12px; box-shadow: 0 4px 12px rgba(79,70,229,0.3); margin-top: 20px; width: 100%; max-width: 400px", onclick: async () => {
        try {
            const email = await scanKioskBiometric();
            const staff = db.find("staff", s => s.email === email);
            if (!staff) throw new Error("Staff record not found for " + email);
            clockStaff(staff);
        } catch (err) {
            toast(err.message, "error");
        }
    }});
    
    const regBtn = btn("Register Staff Fingerprint (This Device)", { variant: "secondary", style: "margin-top: 10px; width: 100%; max-width: 400px", onclick: async () => {
        const email = prompt("Enter your staff email to register fingerprint on this Kiosk:");
        if (!email) return;
        const staff = db.find("staff", s => String(s.email || "").toLowerCase() === String(email).toLowerCase());
        if (!staff) return toast("Staff record not found in HR Directory.", "error");
        
        if (hwToggle.checked) {
            // Hardware Mode Registration
            registeringStaffEmail = staff.email;
            regStatus.textContent = `Registration Mode: Please place ${staff.name}'s finger on the DigitalPersona scanner...`;
            regStatus.style.display = "block";
        } else {
            // WebAuthn Mode Registration
            await registerKioskBiometric(staff.email);
        }
    }});
    
    const fallbackBtn = btn("Manual Fallback", { variant: "ghost", style: "margin-top: 10px; width: 100%; max-width: 400px", onclick: async () => {
        const email = prompt("Enter your staff email to clock in/out:");
        if (!email) return;
        const staff = db.find("staff", s => String(s.email || "").toLowerCase() === String(email).toLowerCase());
        if (!staff) return toast("Staff record not found.", "error");
        
        const pwd = prompt("Enter your staff password to authorize:");
        if (!pwd) return;
        
        const userRec = db.find("users", u => String(u.email).toLowerCase() === String(staff.email).toLowerCase());
        if (!userRec) return toast("Auth record not found.", "error");
        
        // Using statically imported sha256
        const hashed = await sha256(pwd);
        if (hashed !== userRec.passwordHash) return toast("Incorrect password.", "error");

        clockStaff(staff);
    }});

    wrap.appendChild(bioBtn);
    wrap.appendChild(regBtn);
    wrap.appendChild(fallbackBtn);

    const logWrap = el("div", { style: "margin-top:40px; width:100%; max-width:600px" });
    wrap.appendChild(logWrap);

    // Kiosk listener for ZKTeco scans
    const processedScans = new Set();
    db.on("kioskScans", () => {
        const scans = db.list("kioskScans").sort((a, b) => b.ts - a.ts);
        const now = Date.now();
        scans.forEach(scan => {
            // Ignore old scans (older than 1 minute) or already processed scans
            if (processedScans.has(scan.id) || now - scan.ts > 60000) return;
            processedScans.add(scan.id);
            
            const staff = db.find("staff", s => s.fingerprintId && String(s.fingerprintId) === String(scan.fingerprint_id));
            if (staff) {
                // Flash green background
                document.body.style.transition = "background-color 0.3s";
                document.body.style.backgroundColor = "var(--success-light, #dcfce7)";
                setTimeout(() => { document.body.style.backgroundColor = ""; }, 1500);
                
                clockStaff(staff, "auto");
            } else {
                toast(`Unknown fingerprint ID: ${scan.fingerprint_id}`, "error");
            }
        });
    });

    function clockStaff(staff, forcedAction = null) {
        const date = todayISO();
        let existing = db.find("staffAttendance", a => a.date === date);
        if (!existing) {
            existing = { id: uuid(), date, records: [], by: "Kiosk", at: Date.now() };
        }
        
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        let rec = existing.records.find(r => r.staffId === staff.id);
        let action = "";
        let finalStatus = forcedAction || actionSel.value;
        let deduction = 0;

        if (finalStatus === "auto") {
            if (!rec) finalStatus = now.getHours() >= 8 ? "late" : "present";
            else finalStatus = "checkout";
        }

        if (finalStatus === "late" || finalStatus === "absent") {
            // Suggest deduction for salary.js to pick up
            deduction = finalStatus === "late" ? 1000 : 3000;
        }

        if (!rec || finalStatus !== "checkout") {
            rec = { staffId: staff.id, name: staff.name, status: finalStatus, arrivalTime: timeStr, reason: "", approvedBy: "", notes: "", deduction, permission: finalStatus === "permission" };
            existing.records = existing.records.filter(r => r.staffId !== staff.id);
            existing.records.push(rec);
            action = `Logged as ${finalStatus.toUpperCase()} at ${timeStr}` + (deduction ? ` (Deduction: \u20A6${deduction})` : "");
        } else {
            rec.departureTime = timeStr;
            action = `Clocked Out at ${timeStr}`;
        }
        
        db.save("staffAttendance", existing);
        
        const logEntry = el("div", { style: "padding:12px; background:white; border-left:4px solid var(--success); margin-bottom:8px; border-radius:4px; box-shadow:0 1px 3px rgba(0,0,0,0.1)" });
        logEntry.innerHTML = `<b>${staff.name}</b> \u2014 ${action}`;
        logWrap.insertBefore(logEntry, logWrap.firstChild);
        
        toast(`Successfully recorded: ${staff.name}`, "success");
    }

    root.appendChild(wrap);
}
