import { db } from "../core/db.js";
import { el, toast } from "../core/utils.js";
import { card, pageHead, btn, input, table } from "../core/ui.js";

export function render(root, ctx) {
    root.appendChild(pageHead("WhatsApp AI Agent", "Manage automated WhatsApp responses and AI integration."));

    const tabs = el("div", { class: "row", style: "margin-bottom:14px" });
    const tabStatus = btn("Status & Settings", { variant: "primary" });
    const tabLogs = btn("Conversation Logs", { variant: "ghost" });
    tabs.appendChild(tabStatus);
    tabs.appendChild(tabLogs);
    root.appendChild(tabs);

    const host = el("div");
    root.appendChild(host);

    const c = card("WhatsApp Integration Status");
    
    const statusWrap = el("div", { style: "display:flex; align-items:center; gap:16px; margin-bottom: 20px" });
    const dot = el("div", { style: "width:16px; height:16px; border-radius:50%; background:var(--warning)" });
    const statusText = el("h3", { text: "Disconnected", style: "margin:0" });
    statusWrap.appendChild(dot);
    statusWrap.appendChild(statusText);
    c.appendChild(statusWrap);

    c.appendChild(el("p", { text: "Connect your school's WhatsApp Business account to enable AI-powered automated responses for parents.", class: "muted" }));

    const btnRow = el("div", { class: "row", style: "gap: 12px; margin-bottom: 24px" });
    const connectBtn = btn("Connect WhatsApp", { variant: "success", icon: "🔗", onclick: () => {
        toast("WhatsApp API integration is pending webhook configuration.", "info");
    }});
    const syncBtn = btn("Sync Templates", { onclick: () => toast("Templates synced.", "success") });
    btnRow.appendChild(connectBtn);
    btnRow.appendChild(syncBtn);
    c.appendChild(btnRow);

    const aiSettings = card("AI Agent Capabilities", [
        el("div", { class: "svc-row" }, [
            el("input", { type: "checkbox", checked: true }),
            el("span", { class: "nm", text: "Fee Lookup (Parents can query balances)" }),
            el("span", { class: "muted", text: "Requires Student ID & Parent Phone match" })
        ]),
        el("div", { class: "svc-row" }, [
            el("input", { type: "checkbox", checked: true }),
            el("span", { class: "nm", text: "Attendance Reports" }),
            el("span", { class: "muted", text: "Auto-reply with student attendance" })
        ]),
        el("div", { class: "svc-row" }, [
            el("input", { type: "checkbox", checked: false }),
            el("span", { class: "nm", text: "General Enquiries (AI Powered)" }),
            el("span", { class: "muted", text: "Uses Gemini/ChatGPT to answer FAQs" })
        ]),
        el("div", { class: "row", style: "margin-top: 16px" }, [
            btn("Save Settings", { variant: "primary", onclick: () => toast("Settings saved.", "success") })
        ])
    ]);

    host.appendChild(c);
    host.appendChild(aiSettings);
}
