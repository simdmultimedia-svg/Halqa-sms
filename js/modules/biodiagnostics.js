import { el, toast, fmtDate, fmtTime } from "../core/utils.js";
import { card, pageHead, btn, table } from "../core/ui.js";
import { getFingerprintDiagnostics, getConnectedReaders, captureFingerprint, cancelFingerprintCapture } from "../core/fingerprint.js";

export function render(root, ctx) {
    root.appendChild(pageHead("Biometrics Diagnostics", "Check the status of the DigitalPersona U.are.U hardware and local Windows service."));

    const host = el("div");
    root.appendChild(host);

    const refreshBtn = btn("Refresh Diagnostics", { variant: "secondary", onclick: draw });
    root.appendChild(el("div", { style: "margin-bottom: 20px;" }, [refreshBtn]));

    async function draw() {
        host.innerHTML = "Loading diagnostics...";

        const status = await getFingerprintDiagnostics();
        const readers = await getConnectedReaders();

        host.innerHTML = "";

        // Service Status Card
        const isRunning = status.status === "running";
        const serviceStatusHtml = `
            <div style="margin-bottom: 10px;">
                <strong>Service Status:</strong> 
                <span class="badge ${isRunning ? 'badge-success' : 'badge-danger'}">
                    ${isRunning ? 'Running' : 'Stopped / Not Found'}
                </span>
            </div>
            ${isRunning ? `
                <div style="margin-bottom: 10px;"><strong>SDK Version:</strong> ${status.sdk_version || 'Unknown'}</div>
                <div style="margin-bottom: 10px;"><strong>Reader Connected:</strong> ${status.reader_ready ? 'Yes' : 'No'}</div>
                <div style="margin-bottom: 10px;"><strong>Active Reader Name:</strong> ${status.reader_name || 'None'}</div>
                <div style="margin-bottom: 10px;"><strong>Active Reader Serial:</strong> ${status.reader_serial || 'None'}</div>
            ` : `
                <div style="color: var(--danger); margin-top: 10px;">
                    <strong>Error:</strong> ${status.error || 'Failed to connect to http://127.0.0.1:8080'}
                </div>
            `}
        `;

        host.appendChild(card("Windows Fingerprint Service", [
            el("div", { html: serviceStatusHtml })
        ]));

        // Readers Card
        if (isRunning && readers.success && readers.readers) {
            host.appendChild(card("Connected USB Devices", [
                table([
                    { label: "Device Name", key: "name" },
                    { label: "Serial Number", key: "serial" }
                ], readers.readers, { empty: "No readers detected." })
            ]));
        }

        // Test Capture Card
        if (isRunning && status.reader_ready) {
            const captureLog = el("div", { style: "margin-top: 10px; font-family: monospace; background: #f4f4f5; padding: 10px; border-radius: 4px;" });
            
            const testBtn = btn("Test Capture", { variant: "primary", onclick: async () => {
                testBtn.disabled = true;
                testBtn.textContent = "Waiting for finger...";
                captureLog.innerHTML = "Hardware ready. Please place finger on scanner...";
                
                const start = performance.now();
                const res = await captureFingerprint();
                const elapsed = Math.round(performance.now() - start);

                testBtn.disabled = false;
                testBtn.textContent = "Test Capture";

                if (res.success) {
                    captureLog.innerHTML = `
                        <div style="color: green; font-weight: bold;">Capture Successful!</div>
                        <div><strong>Quality Score:</strong> ${res.quality || 'N/A'} (Lower is better, 0 is best)</div>
                        <div><strong>Time Elapsed:</strong> ${elapsed}ms</div>
                        <div style="word-break: break-all; margin-top: 10px; font-size: 10px;"><strong>Template Base64 (Truncated):</strong> ${res.template.substring(0, 100)}...</div>
                    `;
                } else {
                    captureLog.innerHTML = `
                        <div style="color: red; font-weight: bold;">Capture Failed</div>
                        <div><strong>Reason:</strong> ${res.error}</div>
                        <div><strong>Time Elapsed:</strong> ${elapsed}ms</div>
                    `;
                }
            }});

            const cancelBtn = btn("Cancel Capture", { variant: "ghost", style: "margin-left: 10px;", onclick: async () => {
                await cancelFingerprintCapture();
                captureLog.innerHTML = "Capture cancelled.";
                testBtn.disabled = false;
                testBtn.textContent = "Test Capture";
            }});

            host.appendChild(card("Diagnostics Tool", [
                el("div", { style: "margin-bottom: 10px;" }, [testBtn, cancelBtn]),
                captureLog
            ]));
        }
    }

    draw();
}
