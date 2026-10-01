const DP_SERVICE_URL = 'http://127.0.0.1:8080';

// Check if running on localhost to avoid CORS errors in production
const isLocalhost = window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '';

function mapError(errText) {
    const text = (errText || "").toLowerCase();
    if (text.includes("failed to fetch") || text.includes("networkerror")) return "Local Service Not Running";
    if (text.includes("timeout")) return "Capture Timeout";
    if (text.includes("quality")) return "Poor Quality";
    if (text.includes("reader")) return "Reader Disconnected";
    if (text.includes("driver") || text.includes("dll")) return "Driver Missing";
    if (text.includes("sdk")) return "SDK Missing";
    return errText || "Unknown Error";
}

export async function fingerprintServiceAvailable() {
    // Skip fingerprint service check in production to avoid CORS errors
    if (!isLocalhost) return false;

    try {
        const r = await fetch(DP_SERVICE_URL + "/status", { method: "GET" });
        if (!r.ok) return false;
        const data = await r.json();
        return data.status === "running";
    } catch {
        return false;
    }
}

export async function getFingerprintDiagnostics() {
    // Skip fingerprint service check in production to avoid CORS errors
    if (!isLocalhost) return { status: "stopped", error: "Not available in production" };

    try {
        const r = await fetch(DP_SERVICE_URL + "/status", { method: "GET" });
        if (!r.ok) throw new Error("Service returned " + r.status);
        return await r.json();
    } catch (err) {
        return { status: "stopped", error: mapError(err.message) };
    }
}

export async function getConnectedReaders() {
    try {
        const r = await fetch(DP_SERVICE_URL + "/readers", { method: "GET" });
        return await r.json();
    } catch (err) {
        return { success: false, error: mapError(err.message) };
    }
}

export async function captureFingerprint() {
    try {
        const r = await fetch(DP_SERVICE_URL + "/capture", { method: "POST" });
        const data = await r.json();
        if (!data.success) data.error = mapError(data.error);
        return data;
    } catch (err) {
        return { success: false, error: mapError(err.message) };
    }
}

export async function enrollFingerprint() {
    try {
        const r = await fetch(DP_SERVICE_URL + "/enroll", { method: "POST" });
        const data = await r.json();
        if (!data.success) data.error = mapError(data.error);
        return data;
    } catch (err) {
        return { success: false, error: mapError(err.message) };
    }
}

export async function verifyFingerprint(scannedFmdBase64, storedFmdBase64) {
    try {
        const r = await fetch(DP_SERVICE_URL + "/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                scannedFmd: scannedFmdBase64,
                storedFmd: storedFmdBase64
            })
        });
        const data = await r.json();
        if (!data.success) data.error = mapError(data.error);
        return data;
    } catch (err) {
        return { success: false, error: mapError(err.message) };
    }
}

export async function identifyFingerprint(scannedFmdBase64, allFmdsArray) {
    try {
        const r = await fetch(DP_SERVICE_URL + "/identify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                scannedFmd: scannedFmdBase64,
                allFmds: allFmdsArray.join(',')
            })
        });
        const data = await r.json();
        if (!data.success) data.error = mapError(data.error);
        return data;
    } catch (err) {
        return { success: false, error: mapError(err.message) };
    }
}

export async function cancelFingerprintCapture() {
    try {
        const r = await fetch(DP_SERVICE_URL + "/cancel", { method: "POST" });
        return await r.json();
    } catch (err) {
        return { success: false, error: mapError(err.message) };
    }
}
