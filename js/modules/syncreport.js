// Firebase Security & Sync Audit Report Module
// Accessible from the Settings section or directly via #/syncreport
// Generates and displays the full audit report, exportable as a text file.
import { btn, card, pageHead } from "../core/ui.js";
import { el, toast } from "../core/utils.js";
import { runSecurityAudit, formatAuditReport } from "../core/syncaudit.js";
import { getState, getSyncLog, refreshCloudData } from "../core/adapter.js";
import { db, flushQueue } from "../core/db.js";

export async function render(root, ctx) {
  root.appendChild(pageHead(
    "Sync Center",
    "Monitor automatic Firebase synchronization, pending queue health, and recent sync events."
  ));

  // Status bar
  const statusDiv = el("div", { class: "card", style: "margin-bottom:12px" });
  root.appendChild(statusDiv);

  // Log viewer
  const logCard = card("📋 Live Sync Log", []);
  root.appendChild(logCard);
  const logBody = logCard.querySelector(".card-body") || logCard;

  // Report output
  const reportCard = card("📊 Audit Report", []);
  root.appendChild(reportCard);
  const reportBody = reportCard.querySelector(".card-body") || reportCard;

  // Toolbar
  const toolbar = el("div", { style: "display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap" });
  root.appendChild(toolbar);

  // ── Run audit ──────────────────────────────────────────────────────────────
  async function runAudit() {
    reportBody.innerHTML = '<div class="empty"><div class="big">⏳</div>Running audit…</div>';
    try {
      const report = await runSecurityAudit();
      const text   = formatAuditReport(report);

      // Render structured output
      reportBody.innerHTML = "";

      // Summary chips
      const chips = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px" });
      const chip = (label, value, color) => {
        chips.appendChild(el("div", {
          style: `background:${color};color:#fff;border-radius:6px;padding:4px 12px;font-size:13px;font-weight:600`
        }, [el("span", { text: `${label}: ${value}` })]));
      };
      chip("Mode",          report.mode,                        report.mode === "cloud" ? "#1565c0" : "#555");
      chip("Cloud Ready",   report.cloudReady  ? "Yes" : "No", report.cloudReady  ? "#2e7d32" : "#c62828");
      chip("Auth Ready",    report.authReady   ? "Yes" : "No", report.authReady   ? "#2e7d32" : "#c62828");
      chip("Queue Pending", report.pendingQueueSize,             report.pendingQueueSize > 0 ? "#e65100" : "#2e7d32");
      chip("Sync OK",       report.syncSuccesses,                "#2e7d32");
      chip("Denied",        report.permissionDenied.length,      report.permissionDenied.length > 0 ? "#c62828" : "#2e7d32");
      chip("Failures",      report.syncFailures.length,          report.syncFailures.length > 0 ? "#c62828" : "#2e7d32");
      reportBody.appendChild(chips);

      // Pre-formatted text report
      const pre = el("pre", {
        style: "background:#1a1a2e;color:#e0e0e0;padding:16px;border-radius:8px;font-size:12px;line-height:1.7;overflow:auto;max-height:500px;white-space:pre-wrap"
      });
      pre.textContent = text;
      reportBody.appendChild(pre);

      // Export button
      reportBody.appendChild(el("div", { style: "margin-top:12px" }, [
        btn("📥 Download Report (.txt)", {
          onclick: () => {
            const blob = new Blob([text], { type: "text/plain" });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement("a");
            a.href = url; a.download = "CIC KANO-sync-audit-" + new Date().toISOString().slice(0,10) + ".txt";
            a.click(); URL.revokeObjectURL(url);
          }
        })
      ]));

      toast("Audit complete", "success");
    } catch (e) {
      reportBody.innerHTML = `<p class="muted">Audit failed: ${e.message}</p>`;
      console.error(e);
    }
  }

  // ── Live sync log ──────────────────────────────────────────────────────────
  function renderLog() {
    const entries = getSyncLog().slice(0, 100);
    logBody.innerHTML = "";
    if (!entries.length) {
      logBody.appendChild(el("p", { class: "muted", text: "No sync events recorded yet in this session." }));
      return;
    }
    const table = el("table", { style: "width:100%;border-collapse:collapse;font-size:12px" });
    const thead = el("thead");
    thead.innerHTML = "<tr><th>Time</th><th>DB</th><th>Path</th><th>Op</th><th>Status</th><th>Error</th></tr>";
    table.appendChild(thead);
    const tbody = el("tbody");
    entries.forEach((e) => {
      const color = e.status === "ok" ? "#e8f5e9" : e.status === "denied" ? "#ffebee" : "#fff8e1";
      const icon  = e.status === "ok" ? "✓" : e.status === "denied" ? "✗ DENIED" : "⚠ FAIL";
      const tr = el("tr", { style: `background:${color};border-bottom:1px solid #eee` });
      tr.innerHTML = `
        <td style="padding:3px 6px;white-space:nowrap">${new Date(e.ts).toLocaleTimeString()}</td>
        <td style="padding:3px 6px">${e.db || ""}</td>
        <td style="padding:3px 6px;font-family:monospace">${e.path || e.col || ""}</td>
        <td style="padding:3px 6px">${e.op || ""}</td>
        <td style="padding:3px 6px;font-weight:600">${icon}</td>
        <td style="padding:3px 6px;color:#c62828;font-size:11px">${e.errorCode ? e.errorCode + ": " + (e.errorMsg || "").slice(0,60) : ""}</td>
      `;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    logBody.appendChild(table);
  }

  // ── Status bar ─────────────────────────────────────────────────────────────
  function renderStatus() {
    const stats = db.getSyncStats();
    const st = getState();
    const cloudStudents = Number(stats.cloudCounts?.students || 0);
    const localStudents = Number(stats.localCounts?.students || 0);
    const cloudStatus = st.mode !== "cloud"
      ? "Local Mode"
      : !navigator.onLine
        ? "Offline"
        : st.ready && st.authReady
          ? "Connected"
          : st.ready
            ? "Waiting for Auth"
            : "Not Connected";

    const perf = window.CICKANOPerf || {};
    const swStatus = ("serviceWorker" in navigator && navigator.serviceWorker.controller) ? "Active" : "Not Active";
    const ver = window.APP_VERSION || "1.0.0";

    statusDiv.innerHTML = "";
    statusDiv.appendChild(el("div", {
      style: "display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:12px;background:#e8f4f8;border-radius:6px;margin-bottom:12px;border:1px solid #b3e5fc;"
    }, [
      el("span", { style: "font-weight:600;color:#01579b", text: "⚡ Performance Dashboard" }),
      el("span", { style: "font-weight:600", text: "App Version:" }),
      el("span", { style: "font-weight:700", text: ver }),
      el("span", { style: "font-weight:600", text: "Service Worker:" }),
      el("span", { style: `color:${swStatus === "Active" ? "#2e7d32" : "#e65100"};font-weight:700`, text: swStatus }),
      el("span", { style: "font-weight:600", text: "Auth Time:" }),
      el("span", { style: "font-weight:700", text: perf.authTime + " ms" }),
      el("span", { style: "font-weight:600", text: "Dashboard Render:" }),
      el("span", { style: "font-weight:700", text: perf.dashboardTime + " ms" }),
      el("span", { style: "font-weight:600", text: "Full Load Time:" }),
      el("span", { style: "font-weight:700", text: perf.collectionLoad + " ms" })
    ]));

    statusDiv.appendChild(el("div", {
      style: "display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:12px;"
    }, [
      el("span", { style: "font-weight:600", text: "Cloud Status:" }),
      el("span", {
        style: `color:${cloudStatus === "Connected" ? "#2e7d32" : "#e65100"};font-weight:700`,
        text: cloudStatus
      }),

      el("span", { style: "font-weight:600", text: "📊 Local Records:" }),
      el("span", { style: "font-weight:700", text: stats.totalLocal.toLocaleString() }),

      el("span", { style: "font-weight:600", text: "Cloud Students:" }),
      el("span", { style: "font-weight:700", text: cloudStudents.toLocaleString() }),

      el("span", { style: "font-weight:600", text: "Local Students:" }),
      el("span", {
        style: `color:${cloudStudents && cloudStudents !== localStudents ? "#e65100" : "#2e7d32"};font-weight:700`,
        text: localStudents.toLocaleString()
      }),
      
      el("span", { style: "font-weight:600", text: "🔄 Pending Sync:" }),
      el("span", {
        style: `color:${stats.pending > 0 ? "#e65100" : "#2e7d32"};font-weight:700`,
        text: stats.pending.toLocaleString()
      }),

      el("span", { style: "font-weight:600", text: "Successful Syncs:" }),
      el("span", {
        style: "color:#2e7d32;font-weight:700",
        text: stats.successful.toLocaleString()
      }),

      el("span", { style: "font-weight:600", text: "❌ Failed Ops:" }),
      el("span", {
        style: `color:${stats.failed > 0 ? "#c62828" : "#2e7d32"};font-weight:700`,
        text: stats.failed.toLocaleString()
      }),
      
      el("span", { style: "font-weight:600", text: "⏱ Last Sync:" }),
      el("span", { style: "color:#555", text: stats.lastSync })
    ]));
  }

  // ── Toolbar buttons ─────────────────────────────────────────────────────────
  toolbar.appendChild(btn("▶ Run Full Audit", { variant: "success", onclick: runAudit }));
  toolbar.appendChild(btn("🔄 Refresh Log",   { onclick: () => { renderLog(); renderStatus(); } }));
  toolbar.appendChild(btn("Flush Pending Queue", { variant: "primary", onclick: async () => {
    await flushQueue();
    renderLog();
    renderStatus();
    toast("Automatic sync queue checked.", "success");
  } }));
  toolbar.appendChild(btn("Refresh Latest Data", { variant: "success", onclick: async () => {
    toast("Syncing latest data...", "success");
    await refreshCloudData({ startRealtime: true });
    renderLog();
    renderStatus();
    toast("Data synchronized successfully.", "success");
  } }));
  if (ctx.user.role === "Super Admin" || ctx.user.role === "Admin") {
    toolbar.appendChild(btn("☁️ Force Push All Data", { variant: "primary", onclick: async () => {
      const { confirmDialog } = await import("../core/utils.js");
      const ok = await confirmDialog("WARNING: Rebuild Firebase From Local Data. This will scan all local records and force a cloud sync. Proceed?", { title: "Force Push Data", okText: "Yes, Rebuild Cloud" });
      if (ok) {
        const count = db.forcePushAllData();
        toast(`Enqueued ${count} records for forced cloud synchronization.`, "success");
        renderStatus();
      }
    }}));
  }

  // Initial render
  renderStatus();
  renderLog();
  runAudit();

  // Live updates
  const onSyncLog = () => { renderLog(); renderStatus(); };
  window.addEventListener("sync:log",   onSyncLog);
  window.addEventListener("sync:queue", onSyncLog);

  return () => {
    window.removeEventListener("sync:log",   onSyncLog);
    window.removeEventListener("sync:queue", onSyncLog);
  };
}


