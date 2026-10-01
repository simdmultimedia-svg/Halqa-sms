// WebAuthn Biometric Login helper
import { toast } from "./utils.js";

// Utility to convert string/array buffer
function bufferEncode(value) {
    return Uint8Array.from(value, c => c.charCodeAt(0));
}
function bufferDecode(value) {
    return String.fromCharCode.apply(null, new Uint8Array(value));
}

export async function registerBiometric(email, password) {
    if (!window.PublicKeyCredential) {
        toast("Biometric login is not supported on this device/browser.", "error");
        return false;
    }
    try {
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const userId = crypto.getRandomValues(new Uint8Array(16));
        const pubKeyCredParams = [
            { type: "public-key", alg: -7 }, // ES256
            { type: "public-key", alg: -257 } // RS256
        ];
        const credential = await navigator.credentials.create({
            publicKey: {
                rp: { name: "HALQA Portal", id: window.location.hostname },
                user: { id: userId, name: email, displayName: email },
                challenge,
                pubKeyCredParams,
                authenticatorSelection: { userVerification: "preferred" },
                timeout: 60000
            }
        });
        if (credential) {
            // For a fully local app without a secure backend, we encode the password
            // Since this is a local offline-first app, we store the credential ID and the base64 auth.
            const credId = bufferDecode(credential.rawId);
            localStorage.setItem("CIC KANO:bio:" + email, btoa(password));
            localStorage.setItem("CIC KANO:bio_id:" + email, btoa(credId));
            localStorage.setItem("CIC KANO:bio_default", email);
            toast("Biometric login enabled successfully.", "success");
            return true;
        }
    } catch (err) {
        console.error("WebAuthn register error:", err);
        toast("Biometric registration failed: " + err.message, "error");
        return false;
    }
}

export async function loginWithBiometric() {
    if (!window.PublicKeyCredential) throw new Error("Biometric login is not supported.");
    const email = localStorage.getItem("CIC KANO:bio_default");
    if (!email) throw new Error("No biometric login configured. Please login with password and enable it in your profile.");

    const credIdB64 = localStorage.getItem("CIC KANO:bio_id:" + email);
    if (!credIdB64) throw new Error("Biometric credential not found.");

    const credId = bufferEncode(atob(credIdB64));
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    try {
        const assertion = await navigator.credentials.get({
            publicKey: {
                challenge,
                rpId: window.location.hostname,
                allowCredentials: [{ type: "public-key", id: credId }],
                userVerification: "preferred",
                timeout: 60000
            }
        });
        if (assertion) {
            const password = atob(localStorage.getItem("CIC KANO:bio:" + email) || "");
            if (!password) throw new Error("Corrupted local credential.");
            return { email, password };
        }
    } catch (err) {
        console.error("WebAuthn get error:", err);
        if (err.name === "NotAllowedError") {
            throw new Error("Biometric authentication cancelled or denied by user.");
        }
        throw new Error("Biometric verification failed: " + err.message);
    }
}

export async function registerKioskBiometric(email) {
    if (!window.PublicKeyCredential) {
        throw new Error("Biometric login is not supported on this device/browser.");
    }
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));
    const pubKeyCredParams = [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 }
    ];
    const credential = await navigator.credentials.create({
        publicKey: {
            rp: { name: "HALQA Kiosk", id: window.location.hostname },
            user: { id: userId, name: email, displayName: email },
            challenge,
            pubKeyCredParams,
            authenticatorSelection: { userVerification: "preferred" },
            timeout: 60000
        }
    });
    if (credential) {
        const credIdB64 = btoa(bufferDecode(credential.rawId));
        const existingRaw = localStorage.getItem("CIC KANO:kiosk_bio");
        let kioskCredentials = [];
        if (existingRaw) {
            try { kioskCredentials = JSON.parse(existingRaw); } catch (e) { }
        }
        kioskCredentials = kioskCredentials.filter(c => c.email !== email);
        kioskCredentials.push({ email, credIdB64 });
        localStorage.setItem("CIC KANO:kiosk_bio", JSON.stringify(kioskCredentials));
        return true;
    }
}

export async function scanKioskBiometric() {
    if (!window.PublicKeyCredential) throw new Error("Biometric scanning is not supported on this device.");

    const existingRaw = localStorage.getItem("CIC KANO:kiosk_bio");
    let kioskCredentials = [];
    if (existingRaw) {
        try { kioskCredentials = JSON.parse(existingRaw); } catch (e) { }
    }

    if (kioskCredentials.length === 0) {
        throw new Error("No staff fingerprints are registered on this Kiosk yet.");
    }

    const allowCredentials = kioskCredentials.map(c => ({
        type: "public-key",
        id: bufferEncode(atob(c.credIdB64))
    }));

    const challenge = crypto.getRandomValues(new Uint8Array(32));

    try {
        const assertion = await navigator.credentials.get({
            publicKey: {
                challenge,
                rpId: window.location.hostname,
                allowCredentials,
                userVerification: "preferred",
                timeout: 60000
            }
        });

        if (assertion) {
            const returnedIdB64 = btoa(bufferDecode(assertion.rawId));
            const matchedCred = kioskCredentials.find(c => c.credIdB64 === returnedIdB64);

            if (matchedCred) {
                return matchedCred.email;
            } else {
                throw new Error("Unrecognized fingerprint credential.");
            }
        }
    } catch (err) {
        if (err.name === "NotAllowedError") {
            throw new Error("Biometric authentication cancelled.");
        }
        throw new Error("Biometric verification failed: " + err.message);
    }
}
