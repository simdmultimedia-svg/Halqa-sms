import { db } from "../core/db.js";
import { el, toast, confirmDialog, num, fmtDateTime } from "../core/utils.js";
import { card, pageHead, btn, select, textarea, table, multiSelectBar, input } from "../core/ui.js";
import * as cfg from "../core/config.js";

export function render(root, ctx) {
    root.appendChild(pageHead("Notification Center", "Send bulk SMS to parents and staff, and view SMS delivery logs."));

    const tabs = el("div", { class: "row", style: "margin-bottom:14px; gap:8px" });
    const tabSms = btn("Bulk SMS", { variant: "primary" });
    const tabWhatsApp = btn("Bulk WhatsApp", { variant: "ghost" });
    const tabLogs = btn("Logs", { variant: "ghost" });
    tabs.appendChild(tabSms);
    tabs.appendChild(tabWhatsApp);
    tabs.appendChild(tabLogs);
    root.appendChild(tabs);

    const host = el("div");
    root.appendChild(host);

    function showBulkSms() {
        tabSms.className = "btn btn-primary";
        tabWhatsApp.className = "btn btn-ghost";
        tabLogs.className = "btn btn-ghost";
        host.innerHTML = "";

        const c = card("Compose SMS");

        const filters = el("div", { class: "row", style: "margin-bottom: 12px; gap: 12px; flex-wrap: wrap" });
        const audSel = select(() => [
            { value: "parents", label: "All Parents" },
            { value: "debtors", label: "Debtors (Negative Balance)" },
            { value: "staff", label: "All Staff" }
        ]);

        const secSel = select(() => [{ value: "", label: "All Sections" }, ...cfg.sections().map(s => ({ value: s.id, label: s.name }))]);
        const clsSel = select(() => [{ value: "", label: "All Classes" }]);
        const loadBtn = btn("Load Audience", { variant: "primary", onclick: loadAudience });

        secSel.onchange = () => {
            clsSel.innerHTML = '<option value="">All Classes</option>';
            if (secSel.value) cfg.classes(secSel.value).forEach(cls => clsSel.appendChild(el("option", { value: cls.id, text: cls.name })));
        };

        audSel.onchange = () => {
            if (audSel.value === "staff") {
                secSel.style.display = "none";
                clsSel.style.display = "none";
            } else {
                secSel.style.display = "";
                clsSel.style.display = "";
            }
        };

        filters.appendChild(audSel);
        filters.appendChild(secSel);
        filters.appendChild(clsSel);
        filters.appendChild(loadBtn);
        c.appendChild(filters);

        let audienceList = [];
        const selectedIds = new Set();
        const tableHost = el("div");
        c.appendChild(tableHost);

        const msgHost = el("div", { style: "margin-top: 20px" });
        const templates = select(() => [
            { value: "", label: "Select Template" },
            { value: "Dear Parent, this is to remind you about the upcoming PTA meeting on [Date]. HALQA.", label: "PTA Meeting" },
            { value: "Dear Parent, please note that school resumes on [Date]. HALQA.", label: "School Resumption" },
            { value: "Dear Parent, this is a reminder regarding outstanding fees for [Student]. Please visit the portal. HALQA.", label: "Fee Reminder" }
        ], { style: "width:100%; margin-bottom:12px" });

        const messageBody = textarea({ placeholder: "Enter your message here (max 160 characters per page)", style: "width:100%; height:100px" });

        templates.onchange = () => { if (templates.value) messageBody.value = templates.value; };

        const sendBtn = btn("Send Bulk SMS", {
            variant: "success", onclick: async () => {
                if (selectedIds.size === 0) return toast("Select at least one recipient.", "error");
                if (!messageBody.value.trim()) return toast("Message body is empty.", "error");

                const ok = await confirmDialog(`Send SMS to ${selectedIds.size} recipients via Secure Backend?`, { okText: "Send SMS" });
                if (ok) {
                    const btnOrig = sendBtn.innerHTML;
                    sendBtn.innerHTML = "Sending...";
                    sendBtn.disabled = true;

                    try {
                        const { sendSms } = await import("../core/sms.js");
                        let successCount = 0;

                        const phones = [];
                        for (const pid of selectedIds) {
                            const person = audienceList.find(p => p.id === pid);
                            if (person && person.phone) phones.push(person.phone);
                        }

                        if (phones.length === 0) throw new Error("No valid phone numbers found.");

                        // Fire sequentially or in chunks. We'll do sequentially for logs accuracy.
                        for (const phone of phones) {
                            const ok = await sendSms(phone, messageBody.value.trim());
                            if (ok) successCount++;
                        }

                        toast(`Successfully sent ${successCount} out of ${phones.length} SMS via Termii!`, "success", 6000);
                        messageBody.value = "";
                        selectedIds.clear();
                        drawTable();
                    } catch (err) {
                        toast("Failed to send bulk SMS: " + err.message, "error");
                    } finally {
                        sendBtn.innerHTML = btnOrig;
                        sendBtn.disabled = false;
                    }
                }
            }
        });

        msgHost.appendChild(el("div", { class: "section-title" }, [el("h4", { text: "Message Details", style: "margin:0" })]));
        msgHost.appendChild(templates);
        msgHost.appendChild(messageBody);
        msgHost.appendChild(el("div", { class: "row", style: "margin-top: 12px; justify-content:flex-end" }, [sendBtn]));

        c.appendChild(msgHost);
        host.appendChild(c);

        function loadAudience() {
            const aud = audSel.value;
            const personMap = new Map();

            if (aud === "staff") {
                const staff = db.list("staff").filter(s => s.status === "active");
                staff.forEach(s => {
                    const phone = String(s.phone || "").replace(/\D/g, '');
                    if (phone.length > 5 && !personMap.has(phone)) {
                        personMap.set(phone, { id: phone, phone: s.phone, name: s.fullName, desc: "Staff" });
                    }
                });
            } else {
                const students = db.query("students", s => s.status === "active" &&
                    (!secSel.value || s.sectionId === secSel.value) &&
                    (!clsSel.value || s.classId === clsSel.value));

                students.forEach(s => {
                    const phone = String(s.parentPhone || "").replace(/\D/g, '');
                    if (phone.length > 5) {
                        let isDebtor = false;
                        if (aud === "debtors") {
                            const invs = db.query("invoices", i => i.studentId === s.id && num(i.balance) > 0);
                            if (invs.length > 0) isDebtor = true;
                        }

                        if (aud === "parents" || (aud === "debtors" && isDebtor)) {
                            if (!personMap.has(phone)) {
                                personMap.set(phone, { id: phone, phone: s.parentPhone, name: s.parentName, desc: [s.fullName] });
                            } else {
                                personMap.get(phone).desc.push(s.fullName);
                            }
                        }
                    }
                });
            }

            audienceList = Array.from(personMap.values());
            if (aud !== "staff") audienceList.forEach(p => p.desc = p.desc.join(", "));

            selectedIds.clear();
            drawTable();
        }

        function drawTable() {
            tableHost.innerHTML = "";
            if (audienceList.length === 0) return tableHost.appendChild(el("p", { class: "muted", text: "No recipients found for this criteria." }));

            const multiBar = multiSelectBar(selectedIds, audienceList, () => drawTable());
            tableHost.appendChild(multiBar);

            const t = table([
                {
                    label: "Select", render: p => {
                        const cb = input({ type: "checkbox" });
                        cb.checked = selectedIds.has(p.id);
                        cb.onchange = () => { if (cb.checked) selectedIds.add(p.id); else selectedIds.delete(p.id); drawTable(); };
                        return cb;
                    }
                },
                { label: "Recipient Name", key: "name" },
                { label: "Phone", key: "phone" },
                { label: "Details (Students/Role)", key: "desc" }
            ], audienceList);
            tableHost.appendChild(t);
        }
    }

    function showBulkWhatsApp() {
        tabSms.className = "btn btn-ghost";
        tabWhatsApp.className = "btn btn-primary";
        tabLogs.className = "btn btn-ghost";
        host.innerHTML = "";

        const c = card("Bulk WhatsApp Queue (Click-to-Chat)");

        const filters = el("div", { class: "row", style: "margin-bottom: 12px; gap: 12px; flex-wrap: wrap" });
        const audSel = select(() => [
            { value: "parents", label: "All Parents" },
            { value: "debtors", label: "Debtors (Negative Balance)" },
            { value: "staff", label: "All Staff" }
        ]);

        const secSel = select(() => [{ value: "", label: "All Sections" }, ...cfg.sections().map(s => ({ value: s.id, label: s.name }))]);
        const clsSel = select(() => [{ value: "", label: "All Classes" }]);
        const loadBtn = btn("Load Audience", { variant: "primary", onclick: loadAudience });

        secSel.onchange = () => {
            clsSel.innerHTML = '<option value="">All Classes</option>';
            if (secSel.value) cfg.classes(secSel.value).forEach(cls => clsSel.appendChild(el("option", { value: cls.id, text: cls.name })));
        };

        audSel.onchange = () => {
            if (audSel.value === "staff") {
                secSel.style.display = "none";
                clsSel.style.display = "none";
            } else {
                secSel.style.display = "";
                clsSel.style.display = "";
            }
        };

        filters.appendChild(audSel);
        filters.appendChild(secSel);
        filters.appendChild(clsSel);
        filters.appendChild(loadBtn);
        c.appendChild(filters);

        let audienceList = [];
        const selectedIds = new Set();
        const tableHost = el("div");
        c.appendChild(tableHost);

        const msgHost = el("div", { style: "margin-top: 20px" });
        const messageBody = textarea({ placeholder: "Enter your WhatsApp message here...", style: "width:100%; height:100px; margin-bottom:12px" });

        let queueIndex = 0;
        let queueList = [];
        const queueHost = el("div", { style: "margin-top: 16px; padding: 16px; background: #f9f9f9; border-radius: 8px; display:none" });

        const generateBtn = btn("Generate WhatsApp Queue", {
            variant: "success", onclick: () => {
                if (selectedIds.size === 0) return toast("Select at least one recipient.", "error");
                if (!messageBody.value.trim()) return toast("Message body is empty.", "error");

                queueList = [];
                for (const pid of selectedIds) {
                    const person = audienceList.find(p => p.id === pid);
                    if (person && person.phone) queueList.push(person);
                }

                if (queueList.length === 0) return toast("No valid phone numbers found.", "error");

                queueIndex = 0;
                renderQueueUI();
            }
        });

        function renderQueueUI() {
            queueHost.style.display = "block";
            queueHost.innerHTML = "";

            if (queueIndex >= queueList.length) {
                queueHost.appendChild(el("h4", { text: "🎉 Queue Completed!", style: "color:var(--success); margin:0" }));
                queueHost.appendChild(el("p", { text: "All queued WhatsApp messages have been processed.", class: "muted" }));
                return;
            }

            const person = queueList[queueIndex];
            queueHost.appendChild(el("h4", { text: `Sending ${queueIndex + 1} of ${queueList.length}`, style: "margin-top:0" }));
            queueHost.appendChild(el("p", { text: `Recipient: ${person.name} (${person.phone})` }));

            const btnRow = el("div", { class: "row", style: "gap: 8px" });
            const sendNextBtn = btn(`Open WhatsApp & Send`, {
                variant: "primary", icon: "💬", onclick: () => {
                    db.push("whatsappLogs", {
                        phone: person.phone,
                        name: person.name,
                        message: messageBody.value.trim(),
                        date: new Date().toISOString(),
                        sentBy: ctx.user.email || "System"
                    });

                    const text = encodeURIComponent(messageBody.value.trim());
                    let phoneStr = person.phone.replace(/\D/g, "");
                    if (phoneStr.startsWith("0")) phoneStr = "234" + phoneStr.substring(1);

                    window.open(`https://wa.me/${phoneStr}?text=${text}`, "_blank");

                    queueIndex++;
                    renderQueueUI();
                }
            });

            const skipBtn = btn("Skip Recipient", {
                variant: "ghost", onclick: () => {
                    queueIndex++;
                    renderQueueUI();
                }
            });

            btnRow.appendChild(sendNextBtn);
            btnRow.appendChild(skipBtn);
            queueHost.appendChild(btnRow);
        }

        msgHost.appendChild(el("div", { class: "section-title" }, [el("h4", { text: "Message Details", style: "margin:0" })]));
        msgHost.appendChild(messageBody);
        msgHost.appendChild(el("div", { class: "row", style: "margin-top: 12px; justify-content:flex-end" }, [generateBtn]));
        msgHost.appendChild(queueHost);

        c.appendChild(msgHost);
        host.appendChild(c);

        function loadAudience() {
            const aud = audSel.value;
            const personMap = new Map();

            if (aud === "staff") {
                const staff = db.list("staff").filter(s => s.status === "active");
                staff.forEach(s => {
                    const phone = String(s.phone || "").replace(/\D/g, '');
                    if (phone.length > 5 && !personMap.has(phone)) {
                        personMap.set(phone, { id: phone, phone: s.phone, name: s.fullName, desc: "Staff" });
                    }
                });
            } else {
                const students = db.query("students", s => s.status === "active" &&
                    (!secSel.value || s.sectionId === secSel.value) &&
                    (!clsSel.value || s.classId === clsSel.value));

                students.forEach(s => {
                    const phone = String(s.parentPhone || "").replace(/\D/g, '');
                    if (phone.length > 5) {
                        let isDebtor = false;
                        if (aud === "debtors") {
                            const invs = db.query("invoices", i => i.studentId === s.id && num(i.balance) > 0);
                            if (invs.length > 0) isDebtor = true;
                        }

                        if (aud === "parents" || (aud === "debtors" && isDebtor)) {
                            if (!personMap.has(phone)) {
                                personMap.set(phone, { id: phone, phone: s.parentPhone, name: s.parentName, desc: [s.fullName] });
                            } else {
                                personMap.get(phone).desc.push(s.fullName);
                            }
                        }
                    }
                });
            }

            audienceList = Array.from(personMap.values());
            if (aud !== "staff") audienceList.forEach(p => p.desc = p.desc.join(", "));

            selectedIds.clear();
            drawTable();
        }

        function drawTable() {
            tableHost.innerHTML = "";
            if (audienceList.length === 0) return tableHost.appendChild(el("p", { class: "muted", text: "No recipients found for this criteria." }));

            const multiBar = multiSelectBar(selectedIds, audienceList, () => drawTable());
            tableHost.appendChild(multiBar);

            const t = table([
                {
                    label: "Select", render: p => {
                        const cb = input({ type: "checkbox" });
                        cb.checked = selectedIds.has(p.id);
                        cb.onchange = () => { if (cb.checked) selectedIds.add(p.id); else selectedIds.delete(p.id); drawTable(); };
                        return cb;
                    }
                },
                { label: "Recipient Name", key: "name" },
                { label: "WhatsApp Phone", key: "phone" },
                { label: "Details", key: "desc" }
            ], audienceList);
            tableHost.appendChild(t);
        }
    }

    function showLogs() {
        tabSms.className = "btn btn-ghost";
        tabWhatsApp.className = "btn btn-ghost";
        tabLogs.className = "btn btn-primary";
        host.innerHTML = "";

        const logTypeSel = select(() => [
            { value: "smsLogs", label: "SMS Logs" },
            { value: "whatsappLogs", label: "WhatsApp Logs" }
        ], { style: "margin-bottom: 12px; max-width: 200px;" });

        logTypeSel.onchange = renderLogTable;

        const c = card("Communication Logs", [logTypeSel]);
        const logHost = el("div");
        c.appendChild(logHost);

        function renderLogTable() {
            logHost.innerHTML = "";
            const coll = logTypeSel.value;
            const logs = db.list(coll).sort((a, b) => new Date(b.date) - new Date(a.date));

            if (logs.length === 0) {
                logHost.appendChild(el("p", { class: "muted", text: `No ${coll === 'smsLogs' ? 'SMS' : 'WhatsApp'} logs found.` }));
            } else {
                const t = table([
                    { label: "Date", render: l => fmtDateTime(l.date) },
                    { label: "Name/Phone", render: l => `${l.name ? l.name + ' (' + l.phone + ')' : l.phone}` },
                    { label: "Message", render: l => el("div", { text: l.message, style: "max-width:300px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis" }) },
                    { label: "Status", render: l => el("span", { class: (l.status === "Success" || coll === "whatsappLogs") ? "badge badge-success" : "badge badge-danger", text: l.status || "Triggered" }) },
                    { label: "Sent By", key: "sentBy" }
                ], logs);
                logHost.appendChild(t);
            }
        }

        const clearBtn = btn("Clear Current Logs", {
            variant: "danger", style: "margin-top: 16px", onclick: async () => {
                const coll = logTypeSel.value;
                if (await confirmDialog(`Clear all ${coll === 'smsLogs' ? 'SMS' : 'WhatsApp'} logs?`)) {
                    db.collections[coll] = [];
                    db.saveDB();
                    toast("Logs cleared", "success");
                    renderLogTable();
                }
            }
        });

        renderLogTable();
        c.appendChild(clearBtn);
        host.appendChild(c);
    }

    tabSms.onclick = showBulkSms;
    tabWhatsApp.onclick = showBulkWhatsApp;
    tabLogs.onclick = showLogs;
    showBulkSms();
}
