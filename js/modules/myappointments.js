import { db } from "../core/db.js";
import { lazyListen } from "../core/adapter.js";
import { el, toast, todayISO } from "../core/utils.js";
import { card, pageHead, btn, table } from "../core/ui.js";
import { getBranding } from "../core/branding.js";
import { exportDocumentToPDF } from "../core/print.js";
import * as cfg from "../core/config.js";

export function render(root, ctx) {
    lazyListen("appointmentLetters");

    root.innerHTML = "";
    root.appendChild(pageHead("My Appointment Letters", "View, print, and accept your official appointment letters."));

    const host = el("div");
    root.appendChild(host);

    function draw() {
        host.innerHTML = "";

        // Staff should only see their own letters
        let myLetters = db.list("appointmentLetters").filter(l => l.staffId === ctx.user.staffId || l.staffId === ctx.user.uid);

        // If there are no letters yet
        if (!myLetters.length) {
            host.appendChild(card("", [el("div", { class: "muted", style: "padding: 20px; text-align: center;", text: "You have no appointment letters on file." })]));
            return;
        }

        const rows = myLetters.map(l => [
            l.referenceNo || "-",
            new Date(l.generatedAt).toLocaleDateString("en-GB"),
            el("span", { class: `badge ${l.status === 'Accepted' ? 'success' : (l.status === 'Generated' ? 'primary' : 'outline')}`, text: l.status }),
            el("div", { class: "row", style: "gap:5px" }, [
                btn("View Letter", { sm: true, variant: "primary", onclick: () => viewLetter(l) })
            ])
        ]);

        host.appendChild(card("My Letters", [
            table(["Ref No", "Generated Date", "Status", "Action"], rows)
        ]));
    }

    // --- HTML BUILDER (Identical to Admin View for consistency) ---
    function buildLetterHtml(l) {
        const brand = getBranding();
        const logoSrc = brand.logoBase64 || "";
        const htmlContent = (l.content || "").replace(/\n/g, "<br>");
        const todayStr = new Date(l.generatedAt || Date.now()).toLocaleDateString("en-GB", { day: 'numeric', month: 'long', year: 'numeric' });

        return `
        <div class="letter-page" style="width: 210mm; min-height: 297mm; padding: 25mm 20mm; box-sizing: border-box; background: #fff; font-family: 'Times New Roman', Times, serif; color: #000; position: relative; margin: 0 auto; display:flex; flex-direction:column;">
            
            <!-- HEADER -->
            <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 20px; border-bottom: 2px solid #1e3a8a; padding-bottom: 10px;">
                <div style="width: 100px;">
                    ${logoSrc ? `<img src="${logoSrc}" style="width:80px; height:80px; object-fit:contain;" />` : ''}
                </div>
                <div style="flex: 1; text-align: center;">
                    <h1 style="margin: 0; font-size: 24px; color: #1e3a8a; font-weight: bold; text-transform: uppercase;">${brand.schoolName}</h1>
                    ${brand.arabicName ? `<p style="margin: 5px 0; font-size: 14px; font-weight: bold;" dir="rtl" lang="ar">${brand.arabicName}</p>` : ''}
                    <p style="margin: 5px 0; font-size: 14px; font-style: italic;">${brand.motto || ""}</p>
                    <p style="margin: 0; font-size: 12px;">${brand.address || ""}</p>
                    <p style="margin: 0; font-size: 12px;">${brand.phone || ""} | ${brand.email || ""}</p>
                </div>
                <div style="width: 100px;"></div>
            </div>

            <!-- META -->
            <div style="display: flex; justify-content: space-between; margin-bottom: 30px; font-size: 14px;">
                <div><strong>Ref:</strong> ${l.referenceNo || "-"}</div>
                <div><strong>Date:</strong> ${todayStr}</div>
            </div>

            <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="margin: 0; font-size: 20px; text-decoration: underline; text-transform: uppercase;">APPOINTMENT LETTER</h2>
            </div>

            <!-- CONTENT -->
            <div style="font-size: 14px; line-height: 1.6; flex: 1; text-align: justify;">
                ${htmlContent}
            </div>

            <!-- SIGNATURES -->
            <div style="margin-top: 40px; display: flex; justify-content: space-between; align-items: flex-end;">
                <div style="text-align: center; width: 200px;">
                    <div style="border-bottom: 1px solid #000; height: 40px; margin-bottom: 5px;"></div>
                    <p style="margin:0; font-weight:bold;">${brand.directorName || brand.proprietorName || "School Director"}</p>
                </div>
                
                <div style="text-align: center;">
                    <div style="width: 100px; height: 100px; border: 2px dashed #ccc; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 10px auto; color: #ccc; font-size: 12px;">
                        STAMP
                    </div>
                </div>

                <div style="text-align: center; width: 200px;">
                    <div style="border-bottom: 1px solid #000; height: 40px; margin-bottom: 5px;">
                        ${l.status === 'Accepted' ? '<span style="color:green; font-weight:bold; font-family:cursive; font-size:24px; line-height:40px;">Accepted</span>' : ''}
                    </div>
                    <p style="margin:0; font-weight:bold;">Employee Signature & Date</p>
                </div>
            </div>

        </div>
        `;
    }

    function viewLetter(l) {
        const html = buildLetterHtml(l);
        const overlay = el("div", { style: "position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.8); z-index:9999; display:flex; flex-direction:column; align-items:center; overflow-y:auto; padding:20px;" });

        const controls = el("div", { style: "background:#fff; padding:10px; border-radius:8px; margin-bottom:20px; display:flex; gap:10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);" });

        if (l.status !== 'Accepted') {
            controls.appendChild(btn("Accept Appointment", {
                variant: "success", onclick: () => {
                    if (!confirm("Are you sure you want to officially accept this appointment? This action will electronically sign the document.")) return;
                    l.status = "Accepted";
                    l.acceptedAt = Date.now();
                    db.save("appointmentLetters", l);
                    toast("Appointment Accepted Successfully!", "success");
                    document.body.removeChild(overlay);
                    draw(); // Redraw table
                }
            }));
        }

        controls.appendChild(btn("Print", {
            variant: "outline", onclick: () => {
                const printWindow = window.open('', '_blank');
                printWindow.document.write(`<html><head><title>Print ${l.staffName}</title><style>@media print { @page { size: A4 portrait; margin: 0; } body { margin: 0; } }</style></head><body style="margin:0; padding:0; background:#fff;">${html}</body></html>`);
                printWindow.document.close();
                setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
            }
        }));

        controls.appendChild(btn("Download PDF", {
            variant: "outline", onclick: async () => {
                toast("Generating PDF...", "info");

                const container = document.createElement("div");
                container.innerHTML = html;

                const success = await exportDocumentToPDF(container, {
                    filename: `AppointmentLetter_${l.referenceNo.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
                    title: "Appointment Letter"
                });

                if (success) toast("PDF Downloaded", "success");
            }
        }));

        controls.appendChild(btn("Close", { onclick: () => document.body.removeChild(overlay) }));

        overlay.appendChild(controls);

        const previewWrap = el("div", { style: "background:#fff; box-shadow: 0 4px 10px rgba(0,0,0,0.3); transform: scale(0.9); transform-origin: top center;" });
        previewWrap.innerHTML = html;
        overlay.appendChild(previewWrap);
        document.body.appendChild(overlay);
    }

    draw();
    const off = db.on("appointmentLetters", draw);
    return () => off();
}
