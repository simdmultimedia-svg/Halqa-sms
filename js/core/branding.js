import { db } from "./db.js";
import { DEFAULT_LOGO } from "../config/logo-base64.js";
import * as cfg from "./config.js";

export const DEFAULT_BRANDING = {
  schoolName: "Halqatu Zaid bin Sabit Kano",
  arabicName: "حلقة زيد بن ثابت لتحفيظ القرآن والدراسات الإسلامية كانو",
  shortName: "HALQA",
  officialName: "Halqatu Zaid bin Sabit Tahfizul Qur'an waddarasatul Islamiyya Kano",
  motto: "The Splendour of a Better Tomorrow",
  address: "Naibawa MaiKalwa Nasiriyya Quaters, Kano, Kano State, Nigeria",
  phone: "+234 8032180471",
  email: "Halqatuzaidkano@gmail.com",
  website: "",
  logoBase64: DEFAULT_LOGO,
  proprietorName: "Zahradden Suraj",
  directorName: "Zahradden Suraj",
  principalName: "",
  principalSignature: "",
  proprietorSignatureImg: "",
  vicePrincipalSignatureImg: "",
  classTeacherSignatureImg: "",
  headTeacherName: "",
  headTeacherSignature: "",
  stamp: "",
  watermarkLogo: "",
  watermarkOpacity: "10",
  certificateThemePrimary: "#003366",
  certificateThemeSecondary: "#d4af37",
  certificateThemeBg: "#ffffff",
  certificateThemeText: "#000000",
  testimonialTemplate: "This is to certify that {{student_name}} was a student of {{school_name}} and completed his/her studies successfully.\n\nThroughout the period of study, the student demonstrated good character, discipline, and commitment to academic excellence.\n\nWe therefore recommend him/her for further studies and wish him/her success in future endeavors."
};

export function getBranding() {
  const saved = db.setting("branding") || {};
  return { ...DEFAULT_BRANDING, ...saved };
}

export function saveBranding(values) {
  return db.saveSetting("branding", { ...getBranding(), ...values });
}

export function hasLogo() {
  const b = getBranding();
  return !!(b.logoBase64 && b.logoBase64.length > 50);
}

// Standard document header markup used in all printouts.
export function headerHtml({ withPassport = false, passport = "", size = "a4" } = {}) {
  const b = getBranding();
  const logo = b.logoBase64
    ? `<img class="doc-logo" src="${b.logoBase64}" alt="logo">`
    : `<div class="doc-logo placeholder">LOGO</div>`;
  const passportBox = withPassport
    ? `<div class="doc-passport">${passport ? `<img src="${passport}" alt="passport">` : "PASSPORT"}</div>`
    : "";
  const arabicNameHtml = b.arabicName ? `<div class="doc-arabic" dir="rtl" lang="ar">${b.arabicName}</div>` : "";
  return `
  <div class="doc-header ${size}">
    ${logo}
    <div class="doc-headtext">
      <h1>${b.schoolName}</h1>
      ${arabicNameHtml}
      <div class="doc-address">📍 ${b.address}</div>
      <div class="doc-motto">"${b.motto}"</div>
      <div class="doc-contact">📞 ${b.phone}${b.email ? " &bull; ✉️ " + b.email : ""}</div>
    </div>
    ${passportBox}
  </div>`;
}

// Global Proprietary Signature format
export function getProprietorSignature() {
  const b = getBranding();
  const sig = cfg.schoolSignatures();
  const phone = sig.contactPhone || b.phone || "";
  return `
    <div style="margin-top: 80px; text-align: center;">
        <p>___________________________________</p>
        <p style="font-weight: bold; margin: 5px 0;">${b.proprietorName || "Zahradden Suraj"}</p>
        <p style="margin: 0;">Proprietor/Director</p>
        <p style="margin: 0;">${phone}</p>
    </div>
  `;
}
