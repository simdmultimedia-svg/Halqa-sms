import { db } from "./db.js";
import { getCurrentUser } from "./auth.js";

/**
 * Dispatch an SMS to the Netlify Backend and log to smsLogs collection.
 * @param {string} to - The recipient's phone number
 * @param {string} message - The SMS body
 * @returns {Promise<boolean>} True if successful
 */
export async function sendSms(to, message) {
  try {
    const cfg = db.setting("smsGateway") || {};
    
    const phone = String(to).replace(/\D/g, "");
    if (!phone) {
      console.warn("[SMS] No valid phone number provided.");
      return false;
    }

    const payload = {
      to: phone,
      message: message,
      senderId: cfg.senderId || "CIC KANO",
      apiKey: cfg.apiKey
    };
    
    const response = await fetch("/.netlify/functions/sendsms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    const isSuccess = response.ok && (data.message === "Successfully Sent" || data.code === "ok" || data.status === "ok" || (data.message && data.message.includes("sent")));
    
    await db.push("smsLogs", {
      phone: phone,
      message: message,
      status: isSuccess ? "Success" : "Failed",
      response: JSON.stringify(data),
      date: new Date().toISOString(),
      sentBy: getCurrentUser()?.email || "System"
    });

    if (isSuccess) {
      return true;
    } else {
      console.warn("[SMS] Termii Gateway Error:", data);
      return false;
    }
  } catch (err) {
    console.error("[SMS] Network/Backend Error:", err);
    try {
      await db.push("smsLogs", {
        phone: to,
        message: message,
        status: "Failed",
        response: err.message,
        date: new Date().toISOString(),
        sentBy: getCurrentUser()?.email || "System"
      });
    } catch (e) { console.warn("[AUDIT]", e); }
    return false;
  }
}
