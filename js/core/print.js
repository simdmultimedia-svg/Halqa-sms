// Centralised printing / PDF export. Works offline using the browser print engine.
// Optional crisp PDF download uses html2pdf when available (online); otherwise falls
// back to the browser's "Save as PDF" via the print dialog.
import { hasLogo, getBranding } from "./branding.js";
import { toast } from "./utils.js";

export const PRINT_CSS = `
* { box-sizing: border-box; }
html, body { width:100%; min-height:100%; }
body { font-family: 'Segoe UI', Arial, sans-serif; color:#111; margin:0; padding:0; background:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.doc { width:210mm; max-width:210mm; margin:0 auto; padding:10mm; position:relative; overflow:visible; background:#fff; box-sizing:border-box; }
.doc.a4-landscape { width:297mm; max-width:297mm; }
.doc.a4-fit { transform-origin:top center; }
.doc-watermark { position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); width:140mm; height:140mm; opacity:0.07; pointer-events:none; z-index:-1; display:flex; align-items:center; justify-content:center; }
.doc-watermark img { max-width:100%; max-height:100%; object-fit:contain; }
.a4-one-page { min-height:0; page-break-after:auto; position:relative; z-index:1; }
.invoice-page { page-break-after: always; break-after: page; position: relative; }
.invoice-page:last-child { page-break-after: auto; break-after: auto; }
.doc-header { display:flex; align-items:center; gap:12px; border-bottom:3px solid #0b3d91; padding-bottom:8px; page-break-inside:avoid; break-inside:avoid; }
.doc-header .doc-logo { width:84px; height:84px; object-fit:contain; }
.doc-header .doc-logo.placeholder { display:flex; align-items:center; justify-content:center; border:1px dashed #999; color:#999; font-size:12px; }
.doc-headtext { flex:1; text-align:center; }
.doc-headtext h1 { font-size:20px; margin:0; color:#0b3d91; letter-spacing:.4px; }
.doc-address { font-size:11px; color:#333; margin-top:2px; }
.doc-motto { font-style:italic; font-size:12px; color:#444; margin-top:2px; }
.doc-contact { font-size:11px; color:#333; margin-top:2px; }
.doc-passport { width:90px; height:100px; border:1px solid #888; display:flex; align-items:center; justify-content:center; font-size:10px; color:#888; overflow:hidden; }
.doc-passport img { width:100%; height:100%; object-fit:cover; }
.doc-title { text-align:center; font-size:16px; font-weight:700; letter-spacing:.4px; border:2px solid #111; padding:7px; margin:10px 0; text-transform:uppercase; page-break-inside:avoid; break-inside:avoid; }
table, table.doc-table { width:100%; max-width:100%; border-collapse:collapse; table-layout:auto; margin:7px 0; font-size:11.5px; page-break-inside:auto; break-inside:auto; }
table th, table td, table.doc-table th, table.doc-table td { border:1px solid #555; padding:5px 6px; text-align:left; vertical-align:top; overflow-wrap:anywhere; word-break:normal; }
table th, table.doc-table th { background:#e9eefb; font-weight:700; }
table thead, table.doc-table thead { display:table-header-group; }
table tfoot, table.doc-table tfoot { display:table-footer-group; }
table tr, table.doc-table tr, tr { page-break-inside:avoid !important; break-inside:avoid !important; }
.doc-table.compact, .compact-table { font-size:9.5px; }
.doc-table.compact th, .doc-table.compact td, .compact-table th, .compact-table td { padding:3px 4px; }
.wide-table { font-size:9px; table-layout:fixed; }
.wide-table th, .wide-table td { padding:3px 4px; }
.kv { display:grid; grid-template-columns:1fr 1fr; gap:6px 18px; font-size:12px; margin:8px 0; }
.kv div span { color:#555; }
.right { text-align:right; }
.center { text-align:center; }
.badge { display:inline-block; padding:3px 10px; border-radius:12px; font-size:12px; font-weight:700; color:#fff; }
.badge.red { background:#c0392b; } .badge.green { background:#1e7e34; } .badge.orange { background:#e08e0b; }
.totals { font-weight:700; }
.signature-section { margin-top:0; padding-top:0; text-align:center; page-break-inside:avoid; break-inside:avoid; page-break-before:avoid; break-before:avoid; }
.fees-reminder { margin-bottom:4px !important; margin-top:4px !important; }
.remarks-section { page-break-inside:avoid; break-inside:avoid; }
.sig-row { display:flex; justify-content:center; gap:18px; font-size:12px; page-break-inside:avoid; break-inside:avoid; }
.sig-box { width:45%; }
.sig-line { border-top:1px solid #333; margin-top:30px; padding-top:4px; text-align:center; }
.qr { width:96px; height:96px; }
.muted { color:#666; }
.note { font-size:11px; color:#444; border:1px solid #ccc; padding:5px 7px; border-radius:4px; margin-top:8px; page-break-inside:avoid; break-inside:avoid; }

/* ===== REPORT CARD BASE: tighter than default ===== */
.report-card-doc { line-height:1.3; }
.report-card-doc .doc-header { padding-bottom:4px; gap:8px; }
.report-card-doc .doc-header .doc-logo { width:70px; height:70px; }
.report-card-doc .doc-passport { width:75px; height:85px; }
.report-card-doc .doc-headtext h1 { font-size:17px; }
.report-card-doc .doc-address, .report-card-doc .doc-contact { font-size:10px; margin-top:1px; }
.report-card-doc .doc-motto { font-size:10px; margin-top:1px; }
.report-card-doc .doc-title { font-size:13px; padding:4px; margin:6px 0; border-width:1.5px; }
.report-card-doc .doc-table { margin:4px 0; font-size:10.5px; }
.report-card-doc .doc-table th, .report-card-doc .doc-table td { padding:3px 5px; vertical-align:middle; }
.report-card-doc .note { font-size:9.5px; padding:3px 5px; margin-top:4px; }
.report-card-doc .sig-row { margin-top:0; }
.report-card-doc .sig-box { width:200px; }
.report-card-doc .sig-line { margin-top:18px; padding-top:2px; }
.report-card-doc .signature-section { margin-top:6px !important; }
.report-card-doc .obs-scale-row { gap:8px; margin-top:4px; }

/* ===== DENSITY: COMPACT (11-15 subjects) ===== */
.report-card-doc.density-compact .doc-header { padding-bottom:3px; }
.report-card-doc.density-compact .doc-header .doc-logo { width:60px; height:60px; }
.report-card-doc.density-compact .doc-passport { width:65px; height:75px; }
.report-card-doc.density-compact .doc-headtext h1 { font-size:15px; }
.report-card-doc.density-compact .doc-title { font-size:12px; padding:3px; margin:4px 0; }
.report-card-doc.density-compact .doc-table { margin:2px 0; font-size:9.5px; }
.report-card-doc.density-compact .doc-table th, .report-card-doc.density-compact .doc-table td { padding:2px 3px; }
.report-card-doc.density-compact .note { margin-top:2px; padding:2px 4px; font-size:9px; }
.report-card-doc.density-compact .sig-line { margin-top:12px; }
.report-card-doc.density-compact .signature-section { margin-top:4px !important; }
.report-card-doc.density-compact .obs-scale-row { gap:6px; margin-top:2px; }

/* ===== DENSITY: EXTRA COMPACT (16+ subjects) ===== */
.report-card-doc.density-extra-compact .doc-header { padding-bottom:2px; }
.report-card-doc.density-extra-compact .doc-header .doc-logo { width:50px; height:50px; }
.report-card-doc.density-extra-compact .doc-passport { width:55px; height:65px; }
.report-card-doc.density-extra-compact .doc-headtext h1 { font-size:13px; }
.report-card-doc.density-extra-compact .doc-address, .report-card-doc.density-extra-compact .doc-contact { font-size:8px; }
.report-card-doc.density-extra-compact .doc-motto { font-size:8px; }
.report-card-doc.density-extra-compact .doc-title { font-size:11px; padding:2px; margin:2px 0; }
.report-card-doc.density-extra-compact .doc-table { margin:1px 0; font-size:8.5px; }
.report-card-doc.density-extra-compact .doc-table th, .report-card-doc.density-extra-compact .doc-table td { padding:1px 2px; }
.report-card-doc.density-extra-compact .note { margin-top:1px; padding:1px 3px; font-size:8px; }
.report-card-doc.density-extra-compact .sig-line { margin-top:8px; }
.report-card-doc.density-extra-compact .signature-section { margin-top:2px !important; }
.report-card-doc.density-extra-compact .obs-scale-row { gap:4px; margin-top:1px; }

.invoice-doc { font-size:11px; color:#172033; }
.invoice-doc table.doc-table { margin:5px 0; font-size:10.5px; table-layout:fixed; }
.invoice-doc table.doc-table th, .invoice-doc table.doc-table td { padding:4px 6px; border-color:#9aa8bd; }
.invoice-head-grid { display:grid; grid-template-columns:26mm 1fr 26mm; gap:9mm; align-items:center; border-bottom:3px solid #123f7a; padding:0 0 5mm; page-break-inside:avoid; break-inside:avoid; }
.invoice-logo-box { width:25mm; height:25mm; display:flex; align-items:center; justify-content:center; }
.invoice-logo-box img { width:100%; height:100%; object-fit:contain; }
.invoice-logo-placeholder { width:100%; height:100%; border:1px dashed #8a97aa; display:flex; align-items:center; justify-content:center; color:#8a97aa; font-weight:700; font-size:10px; }
.invoice-school-info { text-align:center; line-height:1.25; color:#2b3445; min-width:0; }
.invoice-school-info h1 { margin:0 0 2px; color:#123f7a; font-size:19px; line-height:1.1; text-transform:uppercase; }
.invoice-arabic { font-weight:800; font-size:13px; color:#222; }
.invoice-motto { font-weight:800; font-size:11px; color:#b28116; text-transform:uppercase; }
.invoice-qr-box { text-align:center; font-size:8.5px; color:#526070; justify-self:end; width:24mm; }
.invoice-qr-box img, .invoice-qr-box canvas { width:22mm !important; height:22mm !important; }
.invoice-title-row { display:flex; justify-content:space-between; align-items:center; gap:8mm; margin:5mm 0 3mm; page-break-inside:avoid; break-inside:avoid; }
.invoice-title { font-size:18px; font-weight:900; color:#123f7a; text-transform:uppercase; letter-spacing:0; }
.invoice-subtitle { font-size:10px; color:#586579; }
.invoice-balance-card { min-width:45mm; border:1.5px solid #123f7a; background:#f3f7ff; padding:3mm 4mm; text-align:right; }
.invoice-balance-card span { display:block; font-size:9px; color:#526070; text-transform:uppercase; font-weight:800; }
.invoice-balance-card b { display:block; font-size:16px; color:#c0392b; margin-top:1mm; }
.invoice-details-grid { display:grid; grid-template-columns:repeat(5, 1fr); gap:1.5mm; margin:0 0 2.5mm; page-break-inside:avoid; break-inside:avoid; }
.invoice-details-grid > div { border:1px solid #c5ceda; background:#fbfcff; padding:2mm; min-width:0; }
.invoice-details-grid span { display:block; color:#5f6c7d; font-size:8.5px; font-weight:800; text-transform:uppercase; }
.invoice-details-grid b { display:block; margin-top:1mm; font-size:10.5px; overflow-wrap:anywhere; }
.invoice-mini-row { display:grid; grid-template-columns:1fr 1.2fr 1.2fr; gap:2mm; border:1px solid #c5ceda; background:#f8fafc; padding:2mm; margin-bottom:2.5mm; font-size:10px; page-break-inside:avoid; break-inside:avoid; }
.invoice-good td { color:#207348; font-weight:700; }
.invoice-warn td { color:#9a6100; font-weight:700; }
.invoice-footer, .doc-footer, .print-footer { page-break-inside:avoid; break-inside:avoid; }
.invoice-footer { margin-top:3mm; border:1px solid #c5ceda; background:#fbfcff; padding:2.5mm; }
.invoice-footer-grid { display:grid; grid-template-columns:1fr 1.4fr; gap:5mm; }
.invoice-section-title { font-size:10px; font-weight:900; color:#123f7a; text-transform:uppercase; margin-bottom:1.5mm; }
.invoice-footer-line { display:grid; grid-template-columns:30mm 1fr; gap:2mm; font-size:10px; margin:1mm 0; }
.invoice-footer-note { font-size:10px; margin-bottom:1mm; }
.invoice-deadline { border:1.5px solid #c0392b; color:#c0392b; font-weight:900; text-align:center; padding:1.5mm; margin-top:2mm; text-transform:uppercase; }
.invoice-notice { margin-top:2mm; color:#6b1d16; font-size:9.5px; font-weight:800; text-transform:uppercase; }
.invoice-signatures { display:flex; justify-content:center; gap:16mm; margin-top:4mm; page-break-inside:avoid; break-inside:avoid; page-break-before:avoid; break-before:avoid; }
.invoice-signatures .sig-box { width:46%; }
.invoice-signatures .sig-line { margin-top:12px; }
.status-active{color:#1e7e34;font-weight:700}.status-inactive{color:#777;font-weight:700}.status-action{color:#c0392b;font-weight:700}.status-eligible{color:#0b3d91;font-weight:700}.status-manageable{color:#b56b00;font-weight:700}
.id-card { width:86mm; height:54mm; border:2px solid #0b3d91; border-radius:4mm; padding:3mm; font-size:9.5px; overflow:hidden; page-break-inside:avoid; break-inside:avoid; }
.id-card-header { display:flex; align-items:center; gap:2mm; border-bottom:1.5px solid #0b3d91; padding-bottom:2mm; min-height:13mm; }
.id-card-logo { width:11mm; height:11mm; object-fit:contain; flex:0 0 auto; }
.id-card-title { flex:1; text-align:center; color:#0b3d91; font-weight:800; font-size:9.5px; line-height:1.1; }
.id-card-sub { color:#333; font-size:6.8px; line-height:1.1; margin-top:1mm; }
.id-card-body { display:grid; grid-template-columns:22mm 1fr 18mm; gap:2.5mm; margin-top:2.5mm; align-items:start; }
.id-card-photo { width:22mm; height:26mm; border:1px solid #999; overflow:hidden; background:#f8f8f8; }
.id-card-photo img { width:100%; height:100%; object-fit:cover; }
.id-card-info { min-width:0; line-height:1.35; }
.id-card-name { font-weight:800; font-size:10px; line-height:1.15; margin-bottom:1mm; }
.id-card-qr img, .id-card-qr canvas { width:18mm !important; height:18mm !important; }
.id-card-footer { border-top:1px solid #ccc; margin-top:2mm; padding-top:1mm; text-align:center; font-style:italic; font-size:7px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.id-card-sheet { width:190mm; height:277mm; display:grid; grid-template-columns:1fr 1fr; grid-template-rows:repeat(4, 1fr); gap:4mm; align-items:center; justify-items:center; page-break-after:always; break-after:page; overflow:hidden; }
.id-card-sheet:last-child { page-break-after:auto; break-after:auto; }
.id-card-slot { width:90mm; height:66mm; display:flex; align-items:center; justify-content:center; overflow:hidden; page-break-inside:avoid; break-inside:avoid; }
@page { size: A4; margin: 10mm; }
@page landscape { size: A4 landscape; margin: 10mm; }
@media print {
  .no-print { display:none !important; }
  .doc.a4-landscape { page: landscape; }
  .doc:not(.id-card-sheet) { padding: 0 !important; margin: 0 !important; border: none !important; box-shadow: none !important; max-width: 100% !important; width: 100% !important; }
  table, tr, td, th, div { max-width:100%; }
  img, svg, canvas { max-width:100%; }
  a { color:inherit; text-decoration:none; }
}
`;

function normalisePrintableHtml(innerHtml) {
  const raw = String(innerHtml || "");
  const bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : raw.replace(/<!doctype[^>]*>/ig, "").replace(/<\/?html[^>]*>/ig, "").replace(/<head[\s\S]*?<\/head>/ig, "");
}

export function buildDocHtml(innerHtml, { title = "Document", orientation = "portrait", fit = true } = {}) {
  const body = normalisePrintableHtml(innerHtml);
  const orientationClass = orientation === "landscape" ? " a4-landscape" : "";
  const fitClass = fit ? " a4-fit" : "";
  const b = getBranding();
  const watermark = b.logoBase64 ? `<div class="doc-watermark"><img src="${b.logoBase64}" alt="watermark"></div>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>${PRINT_CSS}</style></head><body><div class="doc${orientationClass}${fitClass}">${watermark}${body}</div></body></html>`;
}

export function printHtml(innerHtml, { title = "Document", orientation = "portrait", fit = true } = {}) {
  if (!hasLogo()) {
    toast("Please upload the school logo in Settings \u2192 Branding before printing.", "error", 5000);
    return false;
  }
  const html = buildDocHtml(innerHtml, { title, orientation, fit });
  const iframe = document.createElement("iframe");
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${orientation === "landscape" ? 1123 : 794}px;height:${orientation === "landscape" ? 794 : 1123}px;border:0;background:#fff;`;
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  iframe.onload = () => {
    setTimeout(() => {
      if (fit) autoScalePrintDocument(iframe.contentWindow.document, orientation);
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => iframe.remove(), 1000);
    }, 350);
  };
  return true;
}

function autoScalePrintDocument(doc, orientation = "portrait") {
  try {
    const root = doc.querySelector(".doc");
    if (!root) return;
    root.style.zoom = "1";
    const pageWidth = orientation === "landscape" ? 1046 : 718;
    const pageHeight = orientation === "landscape" ? 718 : 1046;
    const widthScale = Math.min(1, pageWidth / Math.max(root.scrollWidth, 1));

    // Detect document type for targeted scaling
    const reportCard = root.querySelector(".report-card-doc");
    const invoiceDoc = root.querySelector(".invoice-doc");
    let heightScale = 1;
    const measureEl = reportCard || invoiceDoc || root.querySelector(".a4-one-page");
    if (measureEl) {
      heightScale = Math.min(1, pageHeight / Math.max(measureEl.scrollHeight, 1));
    }

    // Lower min for report cards and invoices to guarantee one-page fit
    let minScale = 0.78;
    if (reportCard) minScale = 0.62;
    else if (invoiceDoc) minScale = 0.65;

    const scale = Math.max(minScale, Math.min(widthScale, heightScale));
    root.style.zoom = String(scale);
  } catch (e) {
    console.warn("[Print] Auto-scale skipped:", e.message || e);
  }
}

// Preview in a modal-like new approach: open a print preview window so users can read it.
export function previewHtml(innerHtml, { title = "Document" } = {}) {
  const w = window.open("", "_blank");
  if (!w) { toast("Allow pop-ups to preview the document.", "error"); return; }
  w.document.write(buildDocHtml(
    `<div class="no-print" style="text-align:center;margin-bottom:10px">
      <button onclick="window.print()" style="padding:8px 16px;font-size:14px;cursor:pointer">Print / Save as PDF</button>
     </div>` + innerHtml, { title }));
  w.document.close();
}

export async function exportDocumentToPDF(content, { title = "Document", filename, orientation } = {}) {
  if (!hasLogo()) {
    toast("Please upload the school logo in Settings \u2192 Branding before exporting.", "error", 5000);
    return false;
  }
  filename = filename || (title.replace(/\s+/g, "_") + ".pdf");
  
  try {
    console.log("[PDF EXPORT] Starting PDF export engine...");
    if (!window.html2pdf) {
      console.log("[PDF EXPORT] Loading html2pdf library...");
      await new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = "/vendor/html2pdf.bundle.min.js";
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    
    const holder = document.createElement("div");
    
    let body = typeof content === "string" ? normalisePrintableHtml(content) : (content.outerHTML || content.innerHTML);
    orientation = orientation || (/a4-landscape|wide-table|payment voucher|class fee monitoring/i.test(body + " " + title) ? "landscape" : "portrait");
    
    const b = getBranding();
    const watermark = b.logoBase64 ? `<div class="doc-watermark"><img src="${b.logoBase64}" alt="watermark"></div>` : "";
    holder.innerHTML = `<style>${PRINT_CSS}</style><div class="doc${orientation === "landscape" ? " a4-landscape" : ""}">${watermark}${body}</div>`;
    
    holder.style.position = "absolute";
    holder.style.top = "0";
    holder.style.left = "-9999px";
    holder.style.pointerEvents = "none";
    holder.style.zIndex = "-9999";
    document.body.appendChild(holder);

    if (holder.innerText.trim().length === 0) {
        console.error("[PDF EXPORT ERROR] Document content missing");
        document.body.removeChild(holder);
        toast("Document content missing. Export aborted.", "error");
        return false;
    }

    const docNode = holder.querySelector('.doc');
    if (docNode) {
        let loops = 0;
        const maxH = orientation === "landscape" ? 794 : 1122;
        while(docNode.scrollHeight > maxH && loops < 10) {
            const currentSize = parseFloat(window.getComputedStyle(docNode).fontSize) || 14;
            if (currentSize <= 8) break;
            docNode.style.fontSize = (currentSize - 0.5) + "px";
            loops++;
        }
    }

    const qrImages = Array.from(holder.querySelectorAll("img[src*='qrserver'], img[src*='data:image']"));
    if (holder.innerHTML.includes("verification/") && qrImages.length === 0) {
         console.error("[PDF EXPORT ERROR] QR Code generation failed or missing.");
         document.body.removeChild(holder);
         toast("QR generation failed. Export aborted.", "error");
         return false;
    }
    if (qrImages.length > 0) console.log("[PDF EXPORT] QR Generated");

    const images = Array.from(holder.querySelectorAll("img"));
    await Promise.all(images.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => {
            img.onload = resolve;
            img.onerror = resolve;
        });
    }));
    console.log("[PDF EXPORT] Images Loaded");

    await document.fonts.ready;
    console.log("[PDF EXPORT] Fonts Ready");

    await new Promise(r => setTimeout(r, 100));
    console.log("[PDF EXPORT] Canvas Ready");
    
    console.group("[PDF EXPORT FORENSICS]");
    console.warn("Is Connected:", holder.isConnected);
    console.warn("Receipt HTML size:", holder.innerHTML.length);
    console.warn("Receipt Width:", holder.offsetWidth);
    console.warn("Receipt Height:", holder.offsetHeight);
    console.warn("scrollHeight:", holder.scrollHeight);
    console.warn("Images Loaded:", images.length);
    console.warn("Fonts Ready:", document.fonts.status === "loaded");
    console.log("QR Ready:", qrImages.length > 0);
    console.log("Canvas Generated (exists):", !!holder.querySelector("canvas"));
    console.groupEnd();
    
    await window.html2pdf().set({
        margin: 0, filename,
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, windowWidth: orientation === "landscape" ? 1123 : 794, height: holder.scrollHeight, windowHeight: holder.scrollHeight },
        pagebreak: { mode: ["avoid-all", "css", "legacy"] },
        jsPDF: { unit: "mm", format: "a4", orientation }
    }).from(holder).save();
    
    console.log("[PDF EXPORT] PDF Saved");
    document.body.removeChild(holder);
    return true;

  } catch (e) {
    console.error("[PDF EXPORT ERROR]", e);
    toast("PDF export failed \u2014 opening print dialog instead.", "info", 4500);
    previewHtml(content, { title });
    return false;
  }
}

export const downloadPdf = exportDocumentToPDF;

export async function exportDocumentToImage(content, { title = "Document", filename, orientation } = {}) {
  if (!hasLogo()) {
    toast("Please upload the school logo in Settings \u2192 Branding before exporting.", "error", 5000);
    return false;
  }
  filename = filename || (title.replace(/\s+/g, "_") + ".png");
  
  try {
    toast("Generating Image... Please wait", "info");
    if (!window.html2canvas) {
      await new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = "/vendor/html2canvas.min.js";
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    
    const holder = document.createElement("div");
    
    let body = typeof content === "string" ? normalisePrintableHtml(content) : (content.outerHTML || content.innerHTML);
    orientation = orientation || (/a4-landscape|wide-table|payment voucher|class fee monitoring/i.test(body + " " + title) ? "landscape" : "portrait");
    
    const b = getBranding();
    const watermark = b.logoBase64 ? `<div class="doc-watermark"><img src="${b.logoBase64}" alt="watermark"></div>` : "";
    holder.innerHTML = `<style>${PRINT_CSS}</style><div class="doc${orientation === "landscape" ? " a4-landscape" : ""}">${watermark}${body}</div>`;
    
    holder.style.position = "absolute";
    holder.style.top = "0";
    holder.style.left = "-9999px";
    holder.style.pointerEvents = "none";
    holder.style.zIndex = "-9999";
    document.body.appendChild(holder);

    if (holder.innerText.trim().length === 0) {
        console.error("[IMAGE EXPORT ERROR] Document content missing");
        document.body.removeChild(holder);
        toast("Document content missing. Export aborted.", "error");
        return false;
    }

    const docNode = holder.querySelector('.doc');
    if (docNode) {
        let loops = 0;
        const maxH = orientation === "landscape" ? 794 : 1122;
        while(docNode.scrollHeight > maxH && loops < 10) {
            const currentSize = parseFloat(window.getComputedStyle(docNode).fontSize) || 14;
            if (currentSize <= 8) break;
            docNode.style.fontSize = (currentSize - 0.5) + "px";
            loops++;
        }
    }

    const qrImages = Array.from(holder.querySelectorAll("img[src*='qrserver'], img[src*='data:image']"));
    if (holder.innerHTML.includes("verification/") && qrImages.length === 0) {
         console.error("[IMAGE EXPORT ERROR] QR Code generation failed or missing.");
         document.body.removeChild(holder);
         toast("QR generation failed. Export aborted.", "error");
         return false;
    }

    const images = Array.from(holder.querySelectorAll("img"));
    await Promise.all(images.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => {
            img.onload = resolve;
            img.onerror = resolve;
        });
    }));

    await document.fonts.ready;
    await new Promise(r => setTimeout(r, 100));

    const canvas = await window.html2canvas(holder, {
        scale: 2,
        useCORS: true,
        windowWidth: orientation === "landscape" ? 1123 : 794,
        height: holder.scrollHeight,
        windowHeight: holder.scrollHeight
    });

    const dataUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = filename;
    link.href = dataUrl;
    link.click();
    
    document.body.removeChild(holder);
    return true;

  } catch (e) {
    console.error("[IMAGE EXPORT ERROR]", e);
    toast("Image export failed \u2014 opening print dialog instead.", "info", 4500);
    previewHtml(content, { title });
    return false;
  }
}

export const downloadImage = exportDocumentToImage;

export async function generatePdfBlob(innerHtml, { title = "Document", filename } = {}) {
  if (!window.html2pdf) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "/vendor/html2pdf.bundle.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const holder = document.createElement("div");
  const body = normalisePrintableHtml(innerHtml);
  const orientation = /a4-landscape|wide-table|payment voucher|class fee monitoring/i.test(body + " " + title) ? "landscape" : "portrait";
  holder.innerHTML = `<style>${PRINT_CSS}</style><div class="doc${orientation === "landscape" ? " a4-landscape" : ""}">${body}</div>`;
  
  holder.style.position = "absolute";
  holder.style.left = "-9999px";
  document.body.appendChild(holder);

  const images = Array.from(holder.querySelectorAll("img"));
  await Promise.all(images.map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise(resolve => {
          img.onload = resolve;
          img.onerror = resolve;
      });
  }));
  await new Promise(r => setTimeout(r, 100));

  const blob = await window.html2pdf().set({
    margin: 10, filename: filename || "doc.pdf",
    image: { type: "jpeg", quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true, windowWidth: orientation === "landscape" ? 1123 : 794, height: holder.scrollHeight, windowHeight: holder.scrollHeight },
    pagebreak: { mode: ["avoid-all", "css", "legacy"] },
    jsPDF: { unit: "mm", format: "a4", orientation }
  }).from(holder).outputPdf("blob");

  document.body.removeChild(holder);
  return blob;
}

export function makeQr(text, size = 96) {
  try {
    if (!window.qrcode) return "";
    const qr = window.qrcode(0, "M");
    qr.addData(String(text));
    qr.make();
    return qr.createImgTag(Math.max(2, Math.round(size / 25)), 4);
  } catch (e) {
    return "";
  }
}

export async function shareDocumentToWhatsApp(content, { title = "Document", filename, orientation, phone } = {}) {
  try {
    toast("Preparing image for WhatsApp...", "info");
    if (!window.html2canvas) {
      await new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = "/vendor/html2canvas.min.js";
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    
    const holder = document.createElement("div");
    let body = typeof content === "string" ? normalisePrintableHtml(content) : (content.outerHTML || content.innerHTML);
    orientation = orientation || (/a4-landscape|wide-table|payment voucher|class fee monitoring/i.test(body + " " + title) ? "landscape" : "portrait");
    
    const b = getBranding();
    const watermark = b.logoBase64 ? `<div class="doc-watermark"><img src="${b.logoBase64}" alt="watermark"></div>` : "";
    holder.innerHTML = `<style>${PRINT_CSS}</style><div class="doc${orientation === "landscape" ? " a4-landscape" : ""}">${watermark}${body}</div>`;
    
    holder.style.position = "absolute";
    holder.style.top = "0";
    holder.style.left = "-9999px";
    holder.style.pointerEvents = "none";
    holder.style.zIndex = "-9999";
    document.body.appendChild(holder);

    const docNode = holder.querySelector('.doc');
    if (docNode) {
        let loops = 0;
        const maxH = orientation === "landscape" ? 794 : 1122;
        while(docNode.scrollHeight > maxH && loops < 10) {
            const currentSize = parseFloat(window.getComputedStyle(docNode).fontSize) || 14;
            if (currentSize <= 8) break;
            docNode.style.fontSize = (currentSize - 0.5) + "px";
            loops++;
        }
    }

    const images = Array.from(holder.querySelectorAll("img"));
    await Promise.all(images.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => {
            img.onload = resolve;
            img.onerror = resolve;
        });
    }));

    await document.fonts.ready;
    await new Promise(r => setTimeout(r, 100));

    const canvas = await window.html2canvas(holder, {
        scale: 2,
        useCORS: true,
        windowWidth: orientation === "landscape" ? 1123 : 794,
        height: holder.scrollHeight,
        windowHeight: holder.scrollHeight
    });

    document.body.removeChild(holder);
    
    canvas.toBlob(async (blob) => {
      if (!blob) return toast("Failed to generate image.", "error");
      const file = new File([blob], filename || "Document.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
              await navigator.share({
                  files: [file],
                  title,
                  text: "Please find your document attached."
              });
              toast("Shared successfully.", "success");
          } catch (e) {
              console.error(e);
          }
      } else {
          toast("Image sharing is not supported by your browser. The image will download so you can attach it to WhatsApp Web manually.", "info", 8000);
          const link = document.createElement("a");
          link.download = filename || "Document.png";
          link.href = canvas.toDataURL("image/png");
          link.click();
          const cleanPhone = (phone || "").replace(/\D/g, '');
          if (cleanPhone) {
              const text = `Please find your ${title} attached.`;
              window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`, "_blank");
          } else {
              window.open("https://web.whatsapp.com/", "_blank");
          }
      }
    }, "image/png");
  } catch(err) {
      console.error(err);
      toast("Failed to process document for sharing.", "error");
  }
}
