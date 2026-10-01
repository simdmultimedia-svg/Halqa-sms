import { db } from "../core/db.js";
import { el, toast, modal, uuid, fmtDate, fmtTime } from "../core/utils.js";
import { card, pageHead, table, btn, input, field } from "../core/ui.js";
import { captureFingerprint, identifyFingerprint } from "../core/fingerprint.js";

export function render(root, ctx) {
    root.appendChild(pageHead("Visitor Management", "Register and clock-in visitors using their biometric fingerprint."));

    const host = el("div");
    
    // Add Visitor Button
    const addBtn = btn("+ Register Visitor", {
        variant: "primary",
        onclick: () => registerVisitorModal()
    });

    const clockInBtn = btn("Scan Fingerprint (Clock In/Out)", {
        variant: "secondary",
        style: "margin-left: 10px;",
        onclick: async () => await clockVisitor()
    });

    root.appendChild(el("div", { class: "row", style: "margin-bottom:14px;flex-wrap:wrap;gap:8px" }, [addBtn, clockInBtn]));
    root.appendChild(host);

    function draw() {
        const visitors = db.list("visitors").sort((a, b) => (b.lastVisit || 0) - (a.lastVisit || 0));

        host.innerHTML = "";
        host.appendChild(card("Registered Visitors", [table([
            { label: "Name", key: "name" },
            { label: "Phone", key: "phone" },
            { label: "Purpose", key: "purpose" },
            { label: "Last Visit", render: v => v.lastVisit ? `${fmtDate(v.lastVisit)} ${fmtTime(v.lastVisit)}` : "Never" },
            { label: "Status", render: v => el("span", {
                class: `badge ${v.status === "in" ? "badge-success" : "badge-muted"}`,
                text: v.status === "in" ? "Checked In" : "Checked Out"
            })},
            { label: "", render: v => el("div", { class: "row" }, [
                btn(v.status === "in" ? "Clock Out" : "Clock In", { sm: true, onclick: () => manualClock(v) })
            ])}
        ], visitors, { empty: "No visitors registered." })]));
    }

    function manualClock(v) {
        v.status = v.status === "in" ? "out" : "in";
        v.lastVisit = Date.now();
        db.save("visitors", v);
        toast(`Visitor manually clocked ${v.status}`, "success");
    }

    async function clockVisitor() {
        toast("Please scan visitor fingerprint...", "warning");
        const cap = await captureFingerprint();
        if (!cap.success) {
            return toast(cap.error || "Capture failed", "error");
        }

        const allPrints = db.list("fingerprints").filter(f => f.role === "visitor");
        if (allPrints.length === 0) {
            return toast("No visitors enrolled.", "error");
        }

        const match = await identifyFingerprint(cap.template, allPrints.map(f => f.template));
        if (!match.success) {
            return toast("Fingerprint not recognized.", "error");
        }

        const print = allPrints[match.matchIndex];
        const v = db.get("visitors", print.ownerId);
        if (v) {
            manualClock(v);
        } else {
            toast("Visitor record not found.", "error");
        }
    }

    function registerVisitorModal() {
        const nameInp = input({ placeholder: "Visitor Name" });
        const phoneInp = input({ placeholder: "Phone Number" });
        const purposeInp = input({ placeholder: "Purpose of Visit" });
        
        let templateStr = null;
        const scanBtn = btn("Capture Fingerprint", { variant: "ghost", onclick: async () => {
            scanBtn.textContent = "Scanning...";
            const res = await captureFingerprint();
            if (res.success) {
                templateStr = res.template;
                scanBtn.textContent = "Fingerprint Captured \u2713";
                scanBtn.style.color = "var(--success)";
            } else {
                toast(res.error, "error");
                scanBtn.textContent = "Capture Fingerprint";
            }
        }});

        const m = modal("Register Visitor", el("div", {}, [
            field("Name", nameInp),
            field("Phone", phoneInp),
            field("Purpose", purposeInp),
            field("Biometrics", scanBtn),
            btn("Save Visitor", { variant: "primary", style: "width:100%;margin-top:16px", onclick: () => {
                if (!nameInp.value) return toast("Name is required", "error");
                const vId = uuid();
                db.save("visitors", {
                    id: vId,
                    name: nameInp.value,
                    phone: phoneInp.value,
                    purpose: purposeInp.value,
                    status: "out",
                    createdAt: Date.now()
                });
                
                if (templateStr) {
                    db.save("fingerprints", {
                        id: uuid(),
                        ownerId: vId,
                        role: "visitor",
                        template: templateStr,
                        createdAt: Date.now()
                    });
                }
                
                m.close();
                toast("Visitor registered successfully", "success");
            }})
        ]));
    }

    draw();
    const off = db.on("visitors", draw);
    return () => off();
}
