import { db } from "../core/db.js";
import { lazyListen, getState } from "../core/adapter.js";
import { el, toast, todayISO } from "../core/utils.js";
import { card, pageHead, table, btn, select, input, field } from "../core/ui.js";
import { getBranding } from "../core/branding.js";
import * as cfg from "../core/config.js";

// CSS for the Certificate Engine
const CERT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Great+Vibes&family=Times+New+Roman:ital,wght@0,400;0,700;1,400;1,700&display=swap');

.cert-engine-wrapper { display: flex; gap: 20px; align-items: flex-start; }
.cert-editor-pane { flex: 1; min-width: 350px; }
.cert-preview-pane { width: 210mm; flex-shrink: 0; box-shadow: 0 10px 25px rgba(0,0,0,0.2); background: #fff; transform-origin: top left; }

@media (max-width: 1200px) {
    .cert-engine-wrapper { flex-direction: column; }
    .cert-preview-pane { transform: scale(0.8); margin-bottom: -60px; }
}
@media (max-width: 768px) {
    .cert-preview-pane { transform: scale(0.45); margin-bottom: -150px; }
}

.cert-page {
    width: 210mm;
    height: 297mm;
    padding: 10mm;
    box-sizing: border-box;
    background: #ffffff;
    font-family: 'Times New Roman', Times, serif;
    position: relative;
    margin: 0 auto;
    overflow: hidden;
    color: #000;
}
.cert-outer-border {
    border: 6px double var(--cert-primary, #0B2D6D);
    padding: 4mm;
    height: 100%;
    box-sizing: border-box;
    position: relative;
}
.cert-inner-border {
    border: 2px solid var(--cert-secondary, #D4AF37);
    height: 100%;
    box-sizing: border-box;
    padding: 6mm 8mm;
    padding-bottom: 55mm;
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

/* Ornate Corners */
.cert-corner {
    position: absolute;
    width: 40px; height: 40px;
    border: 5px solid var(--cert-secondary, #D4AF37);
    border-radius: 6px;
}
.cert-tl { top: -10px; left: -10px; border-right:none; border-bottom:none; }
.cert-tr { top: -10px; right: -10px; border-left:none; border-bottom:none; }
.cert-bl { bottom: -10px; left: -10px; border-right:none; border-top:none; }
.cert-br { bottom: -10px; right: -10px; border-left:none; border-top:none; }

/* Watermark */
.cert-watermark {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 60%; height: auto;
    opacity: 0.05;
    pointer-events: none;
    z-index: 1;
}

/* Header */
.cert-header { 
    display: grid;
    grid-template-columns: 140px 1fr 140px;
    align-items: center;
    z-index: 2; 
    position: relative; 
    margin-bottom: 5px;
}
.cert-logo { text-align: left; }
.cert-logo img { width: 120px; height: 120px; object-fit: contain; }
.cert-photo { text-align: right; }
.cert-photo img { 
    width: 35mm; height: 45mm; 
    object-fit: cover; 
    border: 3px double var(--cert-primary, #0B2D6D); 
    border-radius: 8px; 
    padding: 2px;
    background: #fff;
}

.cert-header-center { text-align: center; }
.cert-school-name { font-family: 'Cinzel', serif; font-size: 26px; font-weight: bold; color: var(--cert-primary, #0B2D6D); margin: 0; text-transform: uppercase; line-height: 1.1; letter-spacing: 1px; }
.cert-arabic { font-size: 20px; color: var(--cert-primary, #0B2D6D); margin: 4px 0; font-weight: bold; }
.cert-address { font-size: 13px; margin: 3px 0; font-weight: bold; color: #000; font-family: 'Cinzel', serif; }
.cert-motto { font-size: 14px; font-style: italic; color: #000; margin: 5px 0; font-weight: bold; }

/* Divider */
.cert-divider {
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 5px 0;
    z-index: 2;
    position: relative;
}
.cert-divider::before, .cert-divider::after {
    content: '';
    flex: 1;
    border-bottom: 2px dotted var(--cert-secondary, #D4AF37);
}
.cert-divider-icon {
    margin: 0 10px;
    color: var(--cert-secondary, #D4AF37);
    font-size: 14px;
}

/* Title */
.cert-title-container { text-align: center; margin: 0 0 5px 0; position: relative; z-index: 2; }
.cert-title { font-family: 'Great Vibes', cursive; font-size: 72px; color: var(--cert-primary, #0B2D6D); margin: 0; font-weight: normal; line-height: 1; }

/* Main Content */
.cert-content { 
    display: grid; 
    grid-template-columns: 60% 36%; 
    gap: 4%; 
    z-index: 2; 
    position: relative;
    flex: 1;
    overflow: hidden;
}

/* Left Panel */
.cert-left-panel { display: flex; flex-direction: column; gap: 15px; }
.cert-row { display: grid; grid-template-columns: 160px 1fr; align-items: end; }
.cert-label { font-weight: bold; color: var(--cert-primary, #0B2D6D); font-size: 13px; text-transform: uppercase; }
.cert-value { border-bottom: 2px dotted #000; text-align: center; font-weight: bold; font-size: 15px; padding-bottom: 2px; text-transform: uppercase; }

.cert-body-text { 
    margin-top: 25px; 
    font-size: 16px; 
    line-height: 1.8; 
    text-align: justify; 
    color: #000;
    max-height: 95mm;
    overflow: hidden;
}

/* Right Panel */
.cert-right-panel { display: flex; flex-direction: column; gap: 12px; }
.cert-box { 
    border: 2px solid var(--cert-secondary, #D4AF37); 
    text-align: center; 
    background: #fff; 
    border-radius: 4px; 
    overflow: hidden; 
    display: flex;
    flex-direction: column;
}
.cert-box-title { 
    background: var(--cert-primary, #0B2D6D); 
    color: #fff; 
    font-weight: bold; 
    padding: 6px; 
    font-size: 11px; 
    text-transform: uppercase; 
    letter-spacing: 1px;
}
.cert-box-content { 
    padding: 8px 10px; 
    font-weight: bold; 
    font-size: 15px; 
    min-height: 35px; 
    display: flex; 
    align-items: center; 
    justify-content: center; 
    color: #000;
}
.cert-remarks-card {
    max-height: 120px;
    overflow: hidden;
}
.cert-remarks-content { 
    padding: 12px; 
    font-size: 15px; 
    text-align: justify; 
    font-style: italic; 
    flex-grow: 1; 
    line-height: 1.6; 
    color: #000;
}



/* ===== FOOTER ===== */
.cert-footer-container {
    position: absolute;
    left: 8mm;
    right: 8mm;
    bottom: 10mm;
    z-index: 10;
}

/* Top decorative divider */
.cert-footer-divider {
    position: relative;
    width: 100%;
    margin-bottom: 20px;
    text-align: center;
    height: 12px;
}
.cert-footer-divider::before {
    content: '';
    position: absolute;
    top: 2px;
    left: 0;
    width: 100%;
    border-top: 1.5px solid var(--cert-secondary, #D4AF37);
}
.cert-footer-divider::after {
    content: '';
    position: absolute;
    top: 6px;
    left: 0;
    width: 100%;
    border-top: 1.5px solid var(--cert-primary, #0B2D6D);
}
.cert-footer-icon {
    position: relative;
    background: #fff;
    padding: 0 10px;
    color: var(--cert-secondary, #D4AF37);
    font-size: 16px;
    z-index: 2;
    top: -6px;
}

/* Certificate Number (above signatures) */
.cert-certno {
    text-align: center;
    margin-bottom: 20px;
    font-family: 'Cinzel', serif;
}
.cert-certno-label {
    font-size: 11px;
    font-weight: bold;
    color: var(--cert-primary, #0B2D6D);
    text-transform: uppercase;
    letter-spacing: 1px;
}
.cert-certno-value {
    font-size: 13px;
    font-weight: bold;
    color: #000;
    margin-top: 2px;
    letter-spacing: 0.5px;
}

/* Signature row */
.cert-footer {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 24px;
    width: 100%;
}

/* Date block */
.cert-date-block {
    flex: 1;
    text-align: left;
    font-family: 'Cinzel', serif;
}
.cert-date-label {
    font-size: 11px;
    font-weight: bold;
    color: var(--cert-primary, #0B2D6D);
    text-transform: uppercase;
}
.cert-date-value {
    font-size: 12px;
    font-weight: bold;
    color: #000;
    margin-top: 3px;
}

/* School Stamp */
.cert-stamp-block {
    width: 70px;
    height: 70px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1.5px dashed #aaa;
    border-radius: 50%;
    position: relative;
    margin: 0 auto;
}
.cert-stamp-img {
    width: 70px;
    height: 70px;
    object-fit: contain;
    position: absolute;
    z-index: 5;
    border-radius: 50%;
}
.cert-stamp-placeholder {
    font-size: 8px;
    font-weight: bold;
    color: #999;
    text-align: center;
    line-height: 1.3;
}

/* QR Code */
.cert-qr-block {
    width: 80px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    margin: 0 auto;
}
.cert-qr-img {
    width: 65px;
    height: 65px;
    margin-bottom: 4px;
    border: 1px solid #ccc;
    padding: 2px;
    background: #fff;
}
.cert-qr-label {
    font-size: 7px;
    font-weight: bold;
    color: #000;
    font-family: 'Cinzel', serif;
    white-space: nowrap;
}

/* Signature blocks */
.cert-sig-block {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
}
.cert-sig-img {
    width: 120px;
    height: 40px;
    object-fit: contain;
    margin-bottom: 5px;
}
.cert-sig-line {
    width: 140px;
    border-top: 2px solid #222;
    margin-top: 8px;
    padding-top: 6px;
}
.cert-sig-caption {
    font-weight: bold;
    font-size: 9px;
    font-family: 'Cinzel', serif;
    color: var(--cert-primary, #0B2D6D);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    white-space: nowrap;
}
`;

export function render(root, ctx) {
    lazyListen("students");
    lazyListen("testimonials");
    lazyListen("results");

    if (!document.getElementById("cert-engine-css")) {
        const style = document.createElement("style");
        style.id = "cert-engine-css";
        style.innerHTML = CERT_CSS;
        document.head.appendChild(style);
    }

    root.innerHTML = "";
    root.appendChild(pageHead("Certificate Engine", "Design, generate, and export professional certificates and testimonials."));

    const tabsRow = el("div", { class: "row", style: "gap: 10px; margin-bottom: 20px;" });
    const btnDesigner = btn("Certificate Designer", { variant: "primary", onclick: () => showTab('designer') });
    const btnList = btn("Issued Certificates", { variant: "outline", onclick: () => showTab('list') });
    tabsRow.appendChild(btnDesigner);
    tabsRow.appendChild(btnList);
    root.appendChild(tabsRow);

    const tabDesigner = el("div");
    const tabList = el("div", { style: "display: none;" });
    root.appendChild(tabDesigner);
    root.appendChild(tabList);

    function showTab(t) {
        btnDesigner.className = t === 'designer' ? "btn primary" : "btn outline";
        btnList.className = t === 'list' ? "btn primary" : "btn outline";
        tabDesigner.style.display = t === 'designer' ? "block" : "none";
        tabList.style.display = t === 'list' ? "block" : "none";
        if (t === 'list') drawList();
    }

    // --- STATE ---
    let state = {
        studentId: "",
        session: cfg.currentSession() || "2023/2024",
        periodFrom: "September, 2021",
        periodTo: "July, 2026",
        academicPerf: "Very Good",
        conductChar: "Excellent",
        respHeld: "Class Prefect",
        remarks: "",
        bodyText: ""
    };

    const b = getBranding();
    if (!state.bodyText) state.bodyText = b.testimonialTemplate || "This is to certify that {{student_name}} was a student of {{school_name}} and completed his/her studies successfully.\n\nThroughout the period of study, the student demonstrated good character, discipline, and commitment to academic excellence.\n\nWe therefore recommend him/her for further studies and wish him/her success in future endeavors.";
    if (!state.remarks) state.remarks = "{{student_name}} is a polite, hardworking and disciplined student.\n{{He_She}} has shown excellent academic ability and active participation in both curricular and co-curricular activities.\nWe wish {{him_her}} success in all {{his_her}} future endeavours.";

    // --- DESIGNER TAB ---
    const wrapper = el("div", { class: "cert-engine-wrapper" });
    tabDesigner.appendChild(wrapper);

    const editorPane = el("div", { class: "cert-editor-pane" });
    const previewPane = el("div", { class: "cert-preview-pane" });

    wrapper.appendChild(editorPane);
    wrapper.appendChild(previewPane);

    const edCard = card("Certificate Data", [], { style: "margin-bottom: 15px;" });

    const sessList = cfg.sessions().list || [cfg.currentSession() || "2023/2024"];
    const inpSess = select(() => sessList.map(s => ({ value: s, label: s })));
    inpSess.value = state.session;

    const inpClass = select(() => [{ value: "", label: "-- Select Class --" }, ...cfg.classes().map(c => ({ value: c.id, label: c.name }))]);
    const inpStudent = select(() => [{ value: "", label: "-- Select Student --" }]);

    inpClass.onchange = () => {
        inpStudent.innerHTML = '<option value="">-- Select Student --</option>';
        if (inpClass.value) {
            const stus = db.query("students", s => s.classId === inpClass.value);
            stus.sort((a, b) => a.fullName.localeCompare(b.fullName)).forEach(s => {
                inpStudent.appendChild(el("option", { value: s.id, text: s.fullName + (s.admissionNo ? ` (${s.admissionNo})` : '') }));
            });
        }
        updatePreview();
    };

    inpStudent.onchange = () => {
        state.studentId = inpStudent.value;
        const stu = db.get("students", state.studentId);
        if (stu) {
            const he_she = (stu.gender || "").toLowerCase() === "male" ? "He" : "She";
            const him_her = (stu.gender || "").toLowerCase() === "male" ? "him" : "her";
            const his_her = (stu.gender || "").toLowerCase() === "male" ? "his" : "her";

            state.remarks = `${stu.fullName} is a polite, hardworking and disciplined student.\n${he_she} has shown excellent academic ability and active participation in both curricular and co-curricular activities.\nWe wish ${him_her} success in all ${his_her} future endeavours.`;
            inpRemarks.value = state.remarks;
        }
        updatePreview();
    };

    inpSess.onchange = () => { state.session = inpSess.value; updatePreview(); };

    edCard.appendChild(el("div", { class: "form-grid" }, [
        field("Class Filter", inpClass),
        field("Student", inpStudent, { full: true }),
        field("Session", inpSess)
    ]));

    const inpPeriodFrom = input({ value: state.periodFrom, oninput: () => { state.periodFrom = inpPeriodFrom.value; updatePreview(); } });
    const inpPeriodTo = input({ value: state.periodTo, oninput: () => { state.periodTo = inpPeriodTo.value; updatePreview(); } });

    edCard.appendChild(el("div", { class: "form-grid", style: "margin-top:10px;" }, [
        field("Period Attended (From)", inpPeriodFrom),
        field("Period Attended (To)", inpPeriodTo)
    ]));

    const perfList = ["Excellent", "Very Good", "Good", "Fair", "Needs Improvement"];
    const inpPerf = select(() => perfList.map(v => ({ value: v, label: v })));
    inpPerf.value = state.academicPerf;
    inpPerf.onchange = () => { state.academicPerf = inpPerf.value; updatePreview(); };

    const inpCond = select(() => perfList.map(v => ({ value: v, label: v })));
    inpCond.value = state.conductChar;
    inpCond.onchange = () => { state.conductChar = inpCond.value; updatePreview(); };

    const inpResp = input({ value: state.respHeld, oninput: () => { state.respHeld = inpResp.value; updatePreview(); } });

    edCard.appendChild(el("div", { class: "form-grid", style: "margin-top:10px;" }, [
        field("Academic Performance", inpPerf),
        field("Conduct & Character", inpCond),
        field("Responsibility Held", inpResp, { full: true })
    ]));

    const inpRemarks = el("textarea", { class: "inp", style: "height: 80px; width: 100%;" });
    inpRemarks.value = state.remarks;
    inpRemarks.oninput = () => { state.remarks = inpRemarks.value; updatePreview(); };
    edCard.appendChild(el("div", { style: "margin-top:10px;" }, [field("Principal's Remarks", inpRemarks)]));

    const inpBody = el("textarea", { class: "inp", style: "height: 100px; width: 100%;" });
    inpBody.value = state.bodyText;
    inpBody.oninput = () => { state.bodyText = inpBody.value; updatePreview(); };
    edCard.appendChild(el("div", { style: "margin-top:10px;" }, [field("Certificate Body Text (Supports Variables)", inpBody)]));

    editorPane.appendChild(edCard);

    const actionCard = card("Actions", [
        btn("Save & Generate", { variant: "primary", style: "width:100%; margin-bottom:10px;", onclick: saveAndGenerate }),
        btn("Export PDF", { variant: "outline", style: "width:100%; margin-bottom:10px;", onclick: exportCurrentPDF }),
        btn("Batch Export Class (PDF)", { variant: "outline", style: "width:100%; margin-bottom:10px;", onclick: exportClassPDF }),
        btn("Print All (Class)", { variant: "outline", style: "width:100%; margin-bottom:10px;", onclick: printAllClass }),
        btn("Download Image", { variant: "outline", style: "width:100%;", onclick: exportImage })
    ]);
    editorPane.appendChild(actionCard);

    function parseTemplate(text, stu) {
        if (!text) return "";
        let out = text;
        const brand = getBranding();
        const he_she = (stu?.gender || "").toLowerCase() === "male" ? "he" : "she";
        const He_She = he_she === "he" ? "He" : "She";
        const his_her = (stu?.gender || "").toLowerCase() === "male" ? "his" : "her";
        const His_Her = his_her === "his" ? "His" : "Her";
        const him_her = (stu?.gender || "").toLowerCase() === "male" ? "him" : "her";

        out = out.replace(/\{\{student_name\}\}/gi, stu?.fullName || "[Student Name]");
        out = out.replace(/\{\{admission_no\}\}/gi, stu?.admissionNo || "[Admission No]");
        out = out.replace(/\{\{session\}\}/gi, state.session);
        out = out.replace(/\{\{class\}\}/gi, cfg.className(stu?.classId) || "[Class]");
        out = out.replace(/\{\{dob\}\}/gi, stu?.dob ? fmtDate(stu.dob) : "[DOB]");
        out = out.replace(/\{\{school_name\}\}/gi, brand.schoolName);
        out = out.replace(/\{\{gender\}\}/gi, stu?.gender || "[Gender]");
        out = out.replace(/\{\{he_she\}\}/g, he_she);
        out = out.replace(/\{\{He_She\}\}/g, He_She);
        out = out.replace(/\{\{his_her\}\}/g, his_her);
        out = out.replace(/\{\{His_Her\}\}/g, His_Her);
        out = out.replace(/\{\{him_her\}\}/g, him_her);
        out = out.replace(/\{\{period\}\}/gi, `From ${state.periodFrom} to ${state.periodTo}`);

        return out.replace(/\n/g, "<br>");
    }

    async function updatePreview() {
        const brand = getBranding();
        const stu = db.get("students", state.studentId) || {};

        const logo = brand.logoBase64 || "";
        const photo = stu.passport || logo || "https://via.placeholder.com/132x170?text=No+Photo";
        const watermark = brand.watermarkLogo || brand.logoBase64 || "";
        const stamp = brand.stamp || "";
        const prinSig = brand.principalSignatureImg || "";
        const propSig = brand.proprietorSignatureImg || "";
        const classSig = brand.classTeacherSignatureImg || "";

        const pPrimary = brand.certificateThemePrimary || "#003366";
        const pSecondary = brand.certificateThemeSecondary || "#d4af37";
        const pOpacity = (brand.watermarkOpacity || "10") / 100;

        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent("https://cick.edu.ng/verify/testimonial/PREVIEW")}`;

        let html = `
        <div class="cert-page" id="cert-export-target" style="--cert-primary: ${pPrimary}; --cert-secondary: ${pSecondary};">
            <div class="cert-outer-border">
                <div class="cert-inner-border">
                    <div class="cert-corner cert-tl"></div>
                    <div class="cert-corner cert-tr"></div>
                    <div class="cert-corner cert-bl"></div>
                    <div class="cert-corner cert-br"></div>
                    
                    ${watermark ? `<img class="cert-watermark" src="${watermark}" />` : ""}

                    <div class="cert-header">
                        <div class="cert-logo">${logo ? `<img src="${logo}" />` : ""}</div>
                        <div class="cert-header-center">
                            <h1 class="cert-school-name">${brand.schoolName}</h1>
                            ${brand.arabicName ? `<div class="cert-arabic">${brand.arabicName}</div>` : ""}
                            ${brand.address ? `<div class="cert-address">📍 ${brand.address}</div>` : ""}
                            ${brand.phone ? `<div class="cert-address">📞 ${brand.phone} ${brand.email ? ' | ✉ ' + brand.email : ''}</div>` : ""}
                            ${brand.motto ? `<div class="cert-motto">"${brand.motto}"</div>` : ""}
                        </div>
                        <div class="cert-photo"><img src="${photo}" /></div>
                    </div>

                    <div class="cert-divider"><span class="cert-divider-icon">♦</span></div>
                    <div class="cert-title-container">
                        <h2 class="cert-title">Testimonial</h2>
                    </div>
                    <div class="cert-divider"><span class="cert-divider-icon">♦</span></div>

                    <div class="cert-content">
                        <div class="cert-left-panel">
                            <div class="cert-row">
                                <span class="cert-label">Name of Pupil:</span>
                                <span class="cert-value" style="font-size:18px;">${stu.fullName || ""}</span>
                            </div>
                            <div class="cert-row">
                                <span class="cert-label">Admission No.:</span>
                                <span class="cert-value">${stu.admissionNo || ""}</span>
                            </div>
                            <div class="cert-row">
                                <span class="cert-label">Date of Birth:</span>
                                <span class="cert-value">${stu.dob ? fmtDate(stu.dob) : ""}</span>
                            </div>
                            <div class="cert-row">
                                <span class="cert-label">Class Completed:</span>
                                <span class="cert-value">${cfg.className(stu.classId) || ""}</span>
                            </div>
                            <div class="cert-row">
                                <span class="cert-label">Session:</span>
                                <span class="cert-value">${state.session}</span>
                            </div>
                            <div class="cert-row">
                                <span class="cert-label">Period Attended:</span>
                                <span class="cert-value">FROM ${state.periodFrom.toUpperCase()} TO ${state.periodTo.toUpperCase()}</span>
                            </div>
                            
                            <div class="cert-body-text">
                                ${parseTemplate(state.bodyText, stu)}
                            </div>
                        </div>

                        <div class="cert-right-panel">
                            <div class="cert-box">
                                <div class="cert-box-title">Academic Performance</div>
                                <div class="cert-box-content">${state.academicPerf}</div>
                            </div>
                            <div class="cert-box">
                                <div class="cert-box-title">Conduct and Character</div>
                                <div class="cert-box-content">${state.conductChar}</div>
                            </div>
                            <div class="cert-box">
                                <div class="cert-box-title">Position of Responsibility Held</div>
                                <div class="cert-box-content">${state.respHeld || "None"}</div>
                            </div>
                            <div class="cert-box cert-remarks-card">
                                <div class="cert-box-title">Principal's Remarks</div>
                                <div class="cert-remarks-content">${parseTemplate(state.remarks, stu)}</div>
                            </div>
                        </div>
                    </div>

                    <div class="cert-footer-container">
                        <div class="cert-footer-divider">
                            <span class="cert-footer-icon">♦</span>
                        </div>

                        <div class="cert-certno">
                            <div class="cert-certno-label">Certificate No:</div>
                            <div class="cert-certno-value">HALQA/TES/${state.session || '2026'}/00001</div>
                        </div>

                        <div class="cert-footer">
                            <div class="cert-date-block">
                                <div class="cert-date-label">DATE:</div>
                                <div class="cert-date-value">${fmtDate(todayISO())}</div>
                            </div>

                            <div class="cert-stamp-block">
                                ${stamp ? `<img src="${stamp}" class="cert-stamp-img" />` : `<div class="cert-stamp-placeholder">SCHOOL<br>STAMP</div>`}
                            </div>

                            <div class="cert-qr-block">
                                <img src="${qrUrl}" class="cert-qr-img" />
                                <div class="cert-qr-label">VERIFY CERTIFICATE</div>
                            </div>

                            <div class="cert-sig-block">
                                ${prinSig ? `<img src="${prinSig}" class="cert-sig-img" />` : `<div style="height:40px;"></div>`}
                                <div class="cert-sig-line"></div>
                                <div class="cert-sig-caption">PRINCIPAL'S SIGNATURE</div>
                            </div>

                            <div class="cert-sig-block">
                                ${propSig ? `<img src="${propSig}" class="cert-sig-img" />` : `<div style="height:40px;"></div>`}
                                <div class="cert-sig-line"></div>
                                <div class="cert-sig-caption">PROPRIETOR'S SIGNATURE</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `;

        previewPane.innerHTML = html;
    }

    async function loadHtml2Pdf() {
        if (!window.html2pdf) {
            await new Promise((res, rej) => {
                const s = document.createElement("script");
                s.src = "/vendor/html2pdf.bundle.min.js";
                s.onload = res; s.onerror = rej;
                document.head.appendChild(s);
            });
        }
    }

    async function exportCurrentPDF() {
        if (!state.studentId) return toast("Select a student first.", "error");
        toast("Preparing high-resolution PDF...", "info");
        await loadHtml2Pdf();

        const target = document.getElementById("cert-export-target");
        if (!target) return;

        const stu = db.get("students", state.studentId) || {};
        const filename = `Testimonial_${stu.fullName || 'Student'}_${state.session.split('/').join('_')}.pdf`;

        await document.fonts.ready;

        const opt = {
            margin: 0,
            filename: filename,
            image: { type: 'jpeg', quality: 1.0 },
            html2canvas: {
                scale: 4,
                useCORS: true,
                logging: false,
                scrollY: 0,
                windowWidth: target.scrollWidth,
                windowHeight: target.scrollHeight
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: false }
        };

        window.html2pdf().set(opt).from(target).save().then(() => {
            toast("PDF Exported Successfully!", "success");
        }).catch(err => {
            toast("PDF Export Failed", "error");
            console.error(err);
        });
    }

    async function exportClassPDF() {
        if (!inpClass.value) return toast("Select a class first.", "error");
        printAllClass();
    }

    async function printAllClass() {
        if (!inpClass.value) return toast("Select a class first.", "error");

        const classId = inpClass.value;
        const className = cfg.className(classId) || 'Class';
        const stus = db.query("students", s => s.classId === classId).sort((a, b) => a.fullName.localeCompare(b.fullName));

        if (stus.length === 0) return toast("No students found in this class.", "error");

        toast(`Opening print window for ${stus.length} students in ${className}...`, "info");

        const brand = getBranding();
        const logo = brand.logoBase64 || "";
        const watermark = brand.watermarkLogo || brand.logoBase64 || "";
        const stamp = brand.stamp || "";
        const prinSig = brand.principalSignatureImg || "";
        const propSig = brand.proprietorSignatureImg || "";
        const pPrimary = brand.certificateThemePrimary || "#003366";
        const pSecondary = brand.certificateThemeSecondary || "#d4af37";

        let pages = "";

        for (let i = 0; i < stus.length; i++) {
            const stu = stus[i];
            const photo = stu.passport || logo || "";
            let existing = db.query("testimonials", t => t.studentId === stu.id && t.session === state.session)[0];

            const certNo = existing ? existing.certificateNumber : `HALQA/TES/${state.session ? state.session.split('/')[0] : '2026'}/XXXXX`;
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent("https://halqatuzaid.netlify.app/verify/testimonial/" + certNo)}`;

            const bText = existing ? existing.bodyText : state.bodyText;
            const rText = existing ? existing.principalRemarks : state.remarks;
            const perf = existing ? existing.academicPerformance : state.academicPerf;
            const cond = existing ? existing.conductCharacter : state.conductChar;
            const resp = existing ? existing.responsibilityHeld : (state.respHeld || "None");

            pages += `
            <div class="cert-page" style="--cert-primary: ${pPrimary}; --cert-secondary: ${pSecondary};">
                <div class="cert-outer-border">
                    <div class="cert-inner-border">
                        <div class="cert-corner cert-tl"></div>
                        <div class="cert-corner cert-tr"></div>
                        <div class="cert-corner cert-bl"></div>
                        <div class="cert-corner cert-br"></div>
                        ${watermark ? `<img class="cert-watermark" src="${watermark}" />` : ""}
                        <div class="cert-header">
                            <div class="cert-logo">${logo ? `<img src="${logo}" />` : ""}</div>
                            <div class="cert-header-center">
                                <h1 class="cert-school-name">${brand.schoolName}</h1>
                                ${brand.arabicName ? `<div class="cert-arabic">${brand.arabicName}</div>` : ""}
                                ${brand.address ? `<div class="cert-address">📍 ${brand.address}</div>` : ""}
                                ${brand.phone ? `<div class="cert-address">📞 ${brand.phone}${brand.email ? ' | ✉ ' + brand.email : ''}</div>` : ""}
                                ${brand.motto ? `<div class="cert-motto">"${brand.motto}"</div>` : ""}
                            </div>
                            <div class="cert-photo">${photo ? `<img src="${photo}" />` : `<div style="width:35mm;height:45mm;border:2px solid ${pPrimary};display:flex;align-items:center;justify-content:center;font-size:10px;color:#999;">NO PHOTO</div>`}</div>
                        </div>
                        <div class="cert-divider"><span class="cert-divider-icon">♦</span></div>
                        <div class="cert-title-container"><h2 class="cert-title">Testimonial</h2></div>
                        <div class="cert-divider"><span class="cert-divider-icon">♦</span></div>
                        <div class="cert-content">
                            <div class="cert-left-panel">
                                <div class="cert-row"><span class="cert-label">Name of Pupil:</span><span class="cert-value" style="font-size:18px;">${stu.fullName || ""}</span></div>
                                <div class="cert-row"><span class="cert-label">Admission No.:</span><span class="cert-value">${stu.admissionNo || ""}</span></div>
                                <div class="cert-row"><span class="cert-label">Date of Birth:</span><span class="cert-value">${stu.dob ? fmtDate(stu.dob) : ""}</span></div>
                                <div class="cert-row"><span class="cert-label">Class Completed:</span><span class="cert-value">${cfg.className(stu.classId) || ""}</span></div>
                                <div class="cert-row"><span class="cert-label">Session:</span><span class="cert-value">${state.session}</span></div>
                                <div class="cert-row"><span class="cert-label">Period Attended:</span><span class="cert-value">FROM ${state.periodFrom.toUpperCase()} TO ${state.periodTo.toUpperCase()}</span></div>
                                <div class="cert-body-text">${parseTemplate(bText, stu)}</div>
                            </div>
                            <div class="cert-right-panel">
                                <div class="cert-box"><div class="cert-box-title">Academic Performance</div><div class="cert-box-content">${perf}</div></div>
                                <div class="cert-box"><div class="cert-box-title">Conduct and Character</div><div class="cert-box-content">${cond}</div></div>
                                <div class="cert-box"><div class="cert-box-title">Position of Responsibility Held</div><div class="cert-box-content">${resp}</div></div>
                                <div class="cert-box cert-remarks-card"><div class="cert-box-title">Principal's Remarks</div><div class="cert-remarks-content">${parseTemplate(rText, stu)}</div></div>
                            </div>
                        </div>
                        <div class="cert-footer-container">
                            <div class="cert-footer-divider"><span class="cert-footer-icon">♦</span></div>
                            <div class="cert-certno"><div class="cert-certno-label">Certificate No:</div><div class="cert-certno-value">${certNo}</div></div>
                            <div class="cert-footer">
                                <div class="cert-date-block"><div class="cert-date-label">DATE:</div><div class="cert-date-value">${fmtDate(todayISO())}</div></div>
                                <div class="cert-stamp-block">${stamp ? `<img src="${stamp}" class="cert-stamp-img" />` : `<div class="cert-stamp-placeholder">SCHOOL<br>STAMP</div>`}</div>
                                <div class="cert-qr-block"><img src="${qrUrl}" class="cert-qr-img" /><div class="cert-qr-label">VERIFY CERTIFICATE</div></div>
                                <div class="cert-sig-block">${prinSig ? `<img src="${prinSig}" class="cert-sig-img" />` : `<div style="height:40px;"></div>`}<div class="cert-sig-line"></div><div class="cert-sig-caption">PRINCIPAL'S SIGNATURE</div></div>
                                <div class="cert-sig-block">${propSig ? `<img src="${propSig}" class="cert-sig-img" />` : `<div style="height:40px;"></div>`}<div class="cert-sig-line"></div><div class="cert-sig-caption">PROPRIETOR'S SIGNATURE</div></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
        }

        const printWin = window.open('', '_blank', 'width=900,height=700');
        if (!printWin) return toast("Please allow popups for this site to use Print All.", "error");

        printWin.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Testimonials - ${className} - ${state.session}</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Great+Vibes&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #fff; font-family: 'Times New Roman', Times, serif; }
@media print {
  @page { size: A4 portrait; margin: 0; }
  .cert-page { page-break-after: always; }
  .cert-page:last-child { page-break-after: avoid; }
}
${CERT_CSS.replace(/@import[^;]+;/g, '')}
.cert-page { width: 210mm; height: 297mm; page-break-after: always; }
.cert-page:last-child { page-break-after: avoid; }
</style>
</head>
<body>
${pages}
</body>
</html>`);

        printWin.document.close();
        printWin.onload = () => {
            setTimeout(() => {
                printWin.focus();
                printWin.print();
            }, 800);
        };
    }

    async function loadHtml2Canvas() {
        if (!window.html2canvas) {
            await new Promise((res, rej) => {
                const s = document.createElement("script");
                s.src = "/vendor/html2canvas.min.js";
                s.onload = res; s.onerror = rej;
                document.head.appendChild(s);
            });
        }
    }

    async function exportImage() {
        if (!state.studentId) return toast("Select a student first.", "error");
        toast("Preparing high-resolution image...", "info");
        await loadHtml2Canvas();

        const target = document.getElementById("cert-export-target");
        if (!target) return;

        const stu = db.get("students", state.studentId) || {};
        const filename = `Testimonial_${stu.fullName || 'Student'}_${state.session.split('/').join('_')}.jpg`;

        try {
            await document.fonts.ready;
            const canvas = await window.html2canvas(target, {
                scale: 4,
                useCORS: true,
                logging: false,
                scrollY: 0,
                windowWidth: target.scrollWidth,
                windowHeight: target.scrollHeight
            });
            const imgData = canvas.toDataURL("image/jpeg", 1.0);
            const link = document.createElement("a");
            link.download = filename;
            link.href = imgData;
            link.click();
            toast("Image Exported Successfully!", "success");
        } catch (err) {
            toast("Image Export Failed", "error");
            console.error(err);
        }
    }

    async function saveAndGenerate() {
        if (!state.studentId) return toast("Select a student first.", "error");

        const sysState = getState();
        const user = sysState.auth?.currentUser;
        if (!user) return toast("You must be logged in.", "error");

        const stu = db.get("students", state.studentId) || {};

        const year = state.session.split("/")[0] || new Date().getFullYear();
        let existing = db.query("testimonials", t => t.studentId === state.studentId && t.session === state.session)[0];

        let certNo = existing ? existing.certificateNumber : null;
        if (!certNo) {
            let existingTsts = db.list("testimonials").filter(t => t.certificateNumber && t.certificateNumber.includes(year));
            let countSuffix = existingTsts.length + 1;
            certNo = `HALQA/TES/${year}/${String(countSuffix).padStart(6, '0')}`;
        }

        const payload = {
            id: existing ? existing.id : null,
            certificateId: existing ? existing.certificateId : `CERT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            studentId: state.studentId,
            studentName: stu.fullName || "Unknown",
            admissionNo: stu.admissionNo || "N/A",
            session: state.session,
            periodFrom: state.periodFrom,
            periodTo: state.periodTo,
            academicPerformance: state.academicPerf,
            conductCharacter: state.conductChar,
            responsibilityHeld: state.respHeld,
            principalRemarks: state.remarks,
            bodyText: state.bodyText,
            issueDate: todayISO(),
            certificateNumber: certNo,
            status: "VALID",
            createdBy: user.email,
            createdAt: existing ? existing.createdAt : Date.now(),
            updatedAt: Date.now()
        };

        db.save("testimonials", payload);
        toast(`Testimonial saved! Cert No: ${certNo}`, "success");

        const ribbon = previewPane.querySelector(".cert-ribbon");
        if (ribbon) ribbon.innerText = `CERTIFICATE NO.: ${certNo}`;

        const qr = previewPane.querySelector(".cert-qr");
        if (qr) {
            const realQr = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent("https://cick.edu.ng/verify/testimonial/" + certNo)}`;
            qr.src = realQr;
        }
    }


    function drawList() {
        tabList.innerHTML = "";
        const listCard = card("Issued Certificates");
        const tsts = db.list("testimonials").sort((a, b) => b.updatedAt - a.updatedAt);

        const header = ["Cert No.", "Student", "Session", "Status", "Date", "Action"];
        const rows = tsts.map(t => {
            const stu = db.get("students", t.studentId) || {};
            return [
                t.certificateNumber,
                stu.fullName || "Unknown",
                t.session,
                t.status,
                fmtDate(t.issueDate),
                el("div", { style: "display:flex; gap:5px;" }, [
                    btn("Edit", {
                        sm: true, onclick: () => {
                            state = {
                                studentId: t.studentId, session: t.session,
                                periodFrom: t.periodFrom, periodTo: t.periodTo,
                                academicPerf: t.academicPerformance, conductChar: t.conductCharacter,
                                respHeld: t.responsibilityHeld, remarks: t.principalRemarks,
                                bodyText: t.bodyText
                            };
                            inpClass.value = stu.classId || "";
                            inpClass.onchange();
                            inpStudent.value = t.studentId;
                            inpSess.value = t.session;
                            inpPeriodFrom.value = t.periodFrom;
                            inpPeriodTo.value = t.periodTo;
                            inpPerf.value = t.academicPerformance;
                            inpCond.value = t.conductCharacter;
                            inpResp.value = t.responsibilityHeld;
                            inpRemarks.value = t.principalRemarks;
                            inpBody.value = t.bodyText;
                            updatePreview();
                            showTab('designer');
                        }
                    }),
                    btn("Export", {
                        sm: true, variant: "primary", onclick: () => {
                            state = {
                                studentId: t.studentId, session: t.session,
                                periodFrom: t.periodFrom, periodTo: t.periodTo,
                                academicPerf: t.academicPerformance, conductChar: t.conductCharacter,
                                respHeld: t.responsibilityHeld, remarks: t.principalRemarks,
                                bodyText: t.bodyText
                            };
                            inpClass.value = stu.classId || "";
                            inpClass.onchange();
                            inpStudent.value = t.studentId;
                            inpSess.value = t.session;
                            inpPeriodFrom.value = t.periodFrom;
                            inpPeriodTo.value = t.periodTo;
                            inpPerf.value = t.academicPerformance;
                            inpCond.value = t.conductCharacter;
                            inpResp.value = t.responsibilityHeld;
                            inpRemarks.value = t.principalRemarks;
                            inpBody.value = t.bodyText;
                            updatePreview();
                            showTab('designer');
                            setTimeout(exportCurrentPDF, 500);
                        }
                    }),
                    btn("JPG", {
                        sm: true, variant: "outline", onclick: () => {
                            state = {
                                studentId: t.studentId, session: t.session,
                                periodFrom: t.periodFrom, periodTo: t.periodTo,
                                academicPerf: t.academicPerformance, conductChar: t.conductCharacter,
                                respHeld: t.responsibilityHeld, remarks: t.principalRemarks,
                                bodyText: t.bodyText
                            };
                            inpClass.value = stu.classId || "";
                            inpClass.onchange();
                            inpStudent.value = t.studentId;
                            inpSess.value = t.session;
                            inpPeriodFrom.value = t.periodFrom;
                            inpPeriodTo.value = t.periodTo;
                            inpPerf.value = t.academicPerformance;
                            inpCond.value = t.conductCharacter;
                            inpResp.value = t.responsibilityHeld;
                            inpRemarks.value = t.principalRemarks;
                            inpBody.value = t.bodyText;
                            updatePreview();
                            showTab('designer');
                            setTimeout(exportImage, 500);
                        }
                    })
                ])
            ];
        });

        listCard.appendChild(table(header, rows, { empty: "No testimonials generated yet." }));
        tabList.appendChild(listCard);
    }

    setTimeout(updatePreview, 100);
}

function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const day = d.getDate();
    const suffix = ["th", "st", "nd", "rd"][(day % 10 > 3 || Math.floor(day % 100 / 10) == 1) ? 0 : day % 10];
    const month = d.toLocaleDateString("en-GB", { month: 'long' });
    const year = d.getFullYear();
    return `${day}${suffix} ${month.toUpperCase()}, ${year}`;
}
