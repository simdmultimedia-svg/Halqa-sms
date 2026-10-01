// js/modules/backup.js
import { db, FIRESTORE_COLLECTIONS } from "../core/db.js";
import { store } from "../core/store.js";
import { el, toast, download, confirmDialog, uuid } from "../core/utils.js";
import { card, pageHead, btn } from "../core/ui.js";
import { can } from "../core/rbac.js";
import { uploadBackup } from "./backupSync.js";

// ─── Snapshot helper ──────────────────────────────────────────────────────────
function snapshot() {
  const data = {};
  FIRESTORE_COLLECTIONS.forEach((c) => { data[c] = store.map(c); });
  return {
    app:           "CIC KANO-SMS",
    schemaVersion: "1",
    version:       1,
    exportedAt:    Date.now(),
    data
  };
}

// ─── SHA-256 for local file verification ─────────────────────────────────────
async function sha256(str) {
  const buf  = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,"0")).join("");
}

// ─── Page render ─────────────────────────────────────────────────────────────
export function render(root, ctx) {
  root.appendChild(pageHead(
    "Backup & Restore",
    "Download a full JSON backup, restore from a file, or upload a backup to synchronize all devices."
  ));

  // ── Download (local) ────────────────────────────────────────────────────────
  const bcard = card("Backup", [
    el("p", { class: "muted", text: "Download a complete snapshot of all local data." })
  ]);
  bcard.appendChild(
    el("div", { class: "row" }, [
      btn("Download JSON Backup", {
        variant: "primary",
        icon: "💾",
        onclick: () => {
          const snap = snapshot();
          download(
            `CIC KANO-backup-${new Date().toISOString().slice(0, 10)}.json`,
            JSON.stringify(snap, null, 2)
          );
          makeRestorePoint(ctx, "manual");
          toast("Backup downloaded.", "success");
        }
      })
    ])
  );
  root.appendChild(bcard);

  // ── Cloud Upload (Admin / Super Admin only) ─────────────────────────────────
  const uploadAllowed = can(ctx.user.role, "manageSettings");
  if (uploadAllowed) {
    const uploadCard = card("Upload Backup to Cloud", [
      el("p", {
        class: "muted",
        text: "Upload the current data snapshot to Supabase. All authorized devices will automatically receive and restore the latest backup."
      })
    ]);

    // Status area
    const statusEl = el("div", {
      id:    "backup-upload-status",
      style: "margin-top:12px;min-height:28px;font-size:.9rem;"
    });

    // Progress bar
    const progressWrap = el("div", {
      style: "display:none;margin-top:8px;background:#e2e8f0;border-radius:6px;overflow:hidden;height:8px;"
    });
    const progressBar = el("div", {
      style: "height:8px;width:0%;background:#3b82f6;transition:width .3s ease;"
    });
    progressWrap.appendChild(progressBar);

    const uploadBtn = btn("Upload Backup to Cloud", {
      variant: "secondary",
      icon: "☁️",
      id: "backup-cloud-upload-btn",
      onclick: async () => {
        const confirmed = await confirmDialog(
          "Upload current data to the cloud? This will synchronize ALL authorized devices to this backup.",
          { okText: "Upload" }
        );
        if (!confirmed) return;

        uploadBtn.disabled = true;
        uploadBtn.textContent = "Uploading…";
        progressWrap.style.display = "block";
        progressBar.style.width    = "0%";
        statusEl.textContent       = "";

        try {
          await uploadBackup(
            ctx,
            // onProgress
            (pct) => { progressBar.style.width = pct + "%"; },
            // onStatus
            (msg) => { statusEl.textContent = msg; }
          );

          progressBar.style.width = "100%";
          statusEl.innerHTML = `<span style="color:#16a34a;font-weight:600">✓ Backup uploaded successfully. Other devices will synchronize automatically.</span>`;
          toast("Backup uploaded & syncing to all devices.", "success", 6000);
        } catch (err) {
          console.error("[BACKUP] Upload error:", err);
          statusEl.innerHTML = `<span style="color:#dc2626">✗ Upload failed: ${err.message}</span>`;
          toast("Backup upload failed: " + err.message, "error", 8000);
          progressWrap.style.display = "none";
        } finally {
          uploadBtn.disabled    = false;
          uploadBtn.textContent = "Upload Backup to Cloud";
        }
      }
    });

    uploadCard.appendChild(el("div", { class: "row" }, [uploadBtn]));
    uploadCard.appendChild(progressWrap);
    uploadCard.appendChild(statusEl);
    root.appendChild(uploadCard);
  }

  // ── Restore from local file ─────────────────────────────────────────────────
  const file  = el("input", { type: "file", accept: "application/json", style: "display:none" });
  const rcard = card("Restore from File", [
    el("p", {
      class: "muted",
      text: "Restore from a locally saved backup file. Records are merged by ID. A safety snapshot is created before restoring."
    })
  ]);
  rcard.appendChild(el("div", { class: "row" }, [
    btn("Choose Backup File", { onclick: () => file.click() }),
    file
  ]));

  file.onchange = async () => {
    if (!file.files[0]) return;
    const confirmed = await confirmDialog(
      "Restore will replace existing records with matching IDs. A safety snapshot will be saved first. Continue?",
      { okText: "Restore" }
    );
    if (!confirmed) { file.value = ""; return; }

    try {
      const rawText = await file.files[0].text();
      const json    = JSON.parse(rawText);
      const data    = json.data || json;

      if (!data || typeof data !== "object") {
        toast("Invalid backup file: missing data section.", "error"); return;
      }

      // Safety snapshot before file restore
      makeRestorePoint(ctx, "pre-file-restore");

      let count = 0;
      Object.keys(data).forEach((col) => {
        const records = data[col];
        const arr = Array.isArray(records) ? records : Object.values(records || {});
        arr.forEach((rec) => {
          if (!rec || !rec.id) return;
          // Settings list handling
          if (
            col === "settings" &&
            ["classes", "sections", "subjects", "terms", "academic_sessions"].includes(rec.id)
          ) {
            const list = rec.list || [];
            list.forEach((item) => {
              if (!item.id) return;
              // sync:false, origin:"remote" — no re-upload
              db.save(rec.id, item, { sync: false, origin: "remote" });
              count++;
            });
          } else {
            // sync:false, origin:"remote" — no re-upload
            db.save(col, rec, { sync: false, origin: "remote" });
            count++;
          }
        });
      });

      toast(`Restored ${count} records from file. Reloading…`, "success");
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      toast("Invalid backup file: " + e.message, "error");
    } finally {
      file.value = "";
    }
  };

  root.appendChild(rcard);

  // ── Factory Reset (Super Admin only) ────────────────────────────────────────
  if (can(ctx.user.role, "factoryReset")) {
    const fcard = card("System Reset (Super Admin)", [
      el("p", {
        class: "muted",
        text: "A backup restore point is created automatically before any reset."
      })
    ]);
    const opts = [
      [
        "Reset Academic Session Only",
        "Removes results, assignments, lesson plans, question banks & attendance. Keeps students, staff, settings.",
        () => resetSets([
          "results","resultApprovals","assignments","lessonPlans",
          "examQuestions","attendance","staffAttendance","cbtAttempts"
        ])
      ],
      [
        "Reset Financial Records Only",
        "Removes invoices, receipts, payments, payslips, vouchers, expenses.",
        () => resetSets(["invoices","receipts","payments","payslips","vouchers","expenses"])
      ],
      [
        "Reset Academic + Financial",
        "Removes academic and financial records. Keeps students, staff, settings.",
        () => resetSets([
          "results","resultApprovals","assignments","lessonPlans","examQuestions",
          "attendance","staffAttendance","cbtAttempts",
          "invoices","receipts","payments","payslips","vouchers","expenses"
        ])
      ],
      [
        "Full Factory Reset",
        "Deletes EVERYTHING and restores default template.",
        () => fullReset()
      ]
    ];
    opts.forEach(([title, desc, fn]) =>
      fcard.appendChild(el("div", { class: "svc-row" }, [
        el("div", { class: "nm" }, [
          el("b", { text: title }),
          el("div", { class: "muted", text: desc })
        ]),
        btn("Run", { variant: "danger", sm: true, onclick: fn })
      ]))
    );
    root.appendChild(fcard);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function makeRestorePoint(ctx, kind) {
    db.save(
      "restorePoints",
      { id: uuid(), at: Date.now(), by: ctx.user.email, kind, snapshot: JSON.stringify(snapshot()) },
      { sync: false }
    );
  }

  async function resetSets(cols) {
    const confirmed = await confirmDialog(
      `This will clear: ${cols.join(", ")}. A backup is downloaded first. Continue?`,
      { danger: true, okText: "Reset" }
    );
    if (!confirmed) return;
    download(`CIC KANO-prereset-${Date.now()}.json`, JSON.stringify(snapshot(), null, 2));
    makeRestorePoint(ctx, "pre-reset");
    cols.forEach((c) => store.clear(c));
    db.save("auditLogs", {
      id: uuid(), type: "reset", uid: ctx.user.uid,
      at: Date.now(), message: `Reset: ${cols.join(", ")}`
    });
    toast("Reset complete. Reloading…", "success");
    setTimeout(() => location.reload(), 1200);
  }

  async function fullReset() {
    const confirmed = await confirmDialog(
      "FULL FACTORY RESET deletes ALL data. A backup is downloaded first. This cannot be undone. Continue?",
      { danger: true, okText: "Erase Everything" }
    );
    if (!confirmed) return;
    download(`CIC KANO-prereset-FULL-${Date.now()}.json`, JSON.stringify(snapshot(), null, 2));
    makeRestorePoint(ctx, "pre-full-reset");
    FIRESTORE_COLLECTIONS.forEach((c) => store.clear(c));
    localStorage.removeItem("CIC KANO:session");
    toast("Factory reset done. Reloading…", "success");
    setTimeout(() => location.reload(), 1200);
  }
}
