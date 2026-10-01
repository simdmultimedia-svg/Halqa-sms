// js/core/adapter.js
// Database Adapter to allow side-by-side execution of Firebase and Supabase.

// By default, continue using Firebase until Supabase is stabilized.
window.ACTIVE_BACKEND = localStorage.getItem("CIC_ACTIVE_BACKEND") || "supabase";

let activeMod = null;

async function loadBackend() {
    if (activeMod) return activeMod;
    if (window.ACTIVE_BACKEND === "supabase") {
        activeMod = await import("./supabase.js");
    } else {
        activeMod = await import("./firebase.js");
    }
    return activeMod;
}

export async function initCloud() {
    const mod = await loadBackend();
    return mod.initCloud();
}

export async function bootstrapMasterData() {
    const mod = await loadBackend();
    if (mod.bootstrapMasterData) return mod.bootstrapMasterData();
    return true; // Fallback for firebase or if not implemented
}

export async function bootstrapUserData() {
    const mod = await loadBackend();
    if (mod.bootstrapUserData) return mod.bootstrapUserData();
    return true; // Fallback
}

export async function refreshCloudData(opts) {
    const mod = await loadBackend();
    return mod.refreshCloudData(opts);
}

export async function directSaveSetting(name, payload) {
    const mod = await loadBackend();
    if (mod.directSaveSetting) return mod.directSaveSetting(name, payload);
    return false;
}

export async function startListeners() {
    const mod = await loadBackend();
    return mod.startListeners();
}

export async function stopListeners() {
    if (!activeMod) return;
    return activeMod.stopListeners();
}

export function getState() {
    if (!activeMod) {
        return { mode: "local", ready: false, authReady: false, cloudStatus: "initializing" };
    }
    return activeMod.getState();
}

export function setMode(mode) {
    if (activeMod && activeMod.setMode) {
        return activeMod.setMode(mode);
    }
}

export function logFirebaseDiagnostics(event) {
    if (activeMod && activeMod.logFirebaseDiagnostics) {
        return activeMod.logFirebaseDiagnostics(event);
    }
}

export function lazyListen(col) {
    if (activeMod && activeMod.lazyListen) {
        return activeMod.lazyListen(col);
    }
}

export function getSyncLog() {
    if (activeMod && activeMod.getSyncLog) {
        return activeMod.getSyncLog();
    }
    return [];
}

export function isFreshInstallation() {
    if (activeMod && activeMod.isFreshInstallation) {
        return activeMod.isFreshInstallation();
    }
    return Promise.resolve(false);
}

export async function waitForAuthReady(timeoutMs) {
    const mod = await loadBackend();
    if (mod.waitForAuthReady) {
        return mod.waitForAuthReady(timeoutMs);
    }
    
    // For Supabase, the initial auth state is resolved during initCloud or login
    if (mod.getState().authReady) return Promise.resolve(true);
    
    // Wait for the auth:change event to fire
    return new Promise((resolve) => {
        let isResolved = false;
        const timeout = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                resolve(mod.getState().authReady);
            }
        }, timeoutMs || 10000);
        
        const listener = () => {
            if (mod.getState().authReady && !isResolved) {
                isResolved = true;
                clearTimeout(timeout);
                window.removeEventListener("auth:change", listener);
                resolve(true);
            }
        };
        window.addEventListener("auth:change", listener);
    });
}

// Function to switch backend
export function switchBackend(backend) {
    if (backend === "supabase" || backend === "firebase") {
        localStorage.setItem("CIC_ACTIVE_BACKEND", backend);
        window.ACTIVE_BACKEND = backend;
        window.location.reload();
    }
}
