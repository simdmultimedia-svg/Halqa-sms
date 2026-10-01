// First-Time Setup Wizard for Fresh Firebase Installations
// Shows when Firestore has no Super Admins and helps initialize the database

import { btn, card, pageHead } from "../core/ui.js";
import { el, toast, confirmDialog } from "../core/utils.js";
import { db } from "../core/db.js";
import { isFreshInstallation } from "../core/adapter.js";

export async function render(root, ctx) {
  root.appendChild(pageHead(
    "Initialize CIC KANO Database",
    "Set up your fresh Firebase installation. This wizard will configure the first Super Admin account."
  ));

  const container = el("div", { style: "max-width:600px;margin:20px auto" });
  root.appendChild(container);

  // ─── Step 1: Fresh Install Detection ──────────────────────────────────────────
  async function checkFreshInstall() {
    try {
      const isFresh = await isFreshInstallation();
      return isFresh;
    } catch (e) {
      console.error("Fresh install check failed:", e);
      return false;
    }
  }

  // ─── Main Setup Flow ────────────────────────────────────────────────────────
  async function runSetup() {
    container.innerHTML = '<div class="empty"><div class="big">⏳</div>Checking database status…</div>';

    try {
      const isFresh = await checkFreshInstall();

      if (!isFresh) {
        container.innerHTML = `
          <div class="card">
            <div class="card-body">
              <p style="color:#e65100;font-weight:600">ℹ️ Database Already Initialized</p>
              <p>This CIC KANO instance already has administrators configured.</p>
              <p>If you're a new user, please contact your administrator to create your account.</p>
            </div>
          </div>
        `;
        return;
      }

      // Fresh install: show wizard
      showSetupWizard();
    } catch (e) {
      container.innerHTML = `
        <div class="card" style="border-left:4px solid #c62828">
          <div class="card-body">
            <p style="color:#c62828;font-weight:600">❌ Error Checking Database</p>
            <p>${e.message || "Unknown error"}</p>
            <div style="margin-top:12px">
              ${btn("Try Again", { onclick: runSetup })}
            </div>
          </div>
        </div>
      `;
    }
  }

  function showSetupWizard() {
    container.innerHTML = "";

    const card1 = card("Step 1: Fresh Installation Detected", [
      el("p", {
        text: "✓ No Super Admin accounts found in database",
        style: "color:#2e7d32;font-weight:600;margin-bottom:12px"
      }),
      el("p", {
        text: "This wizard will create your first Super Admin account using your current login credentials.",
        style: "margin-bottom:12px"
      }),
      el("p", {
        class: "muted",
        text: "Email: " + (ctx.user?.email || "(unknown)"),
        style: "font-size:12px"
      })
    ]);
    container.appendChild(card1);

    const card2 = card("Step 2: Collections to Initialize", [
      el("p", { text: "The following collections will be created:", style: "margin-bottom:8px" }),
      el("ul", {
        style: "margin-left:16px;font-size:13px"
      }, [
        el("li", { text: "users — User profiles with roles" }),
        el("li", { text: "userRoles — Role assignments" }),
        el("li", { text: "counters — ID generation counters" }),
        el("li", { text: "settings — School configuration" })
      ])
    ]);
    container.appendChild(card2);

    const card3 = card("Step 3: Create First Super Admin", [
      el("p", {
        text: "Your account will be created with Super Admin privileges. You can then create additional user accounts.",
        style: "margin-bottom:12px"
      }),
      el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, [
        btn("Create Super Admin", {
          variant: "success",
          onclick: () => createFirstAdmin()
        }),
        btn("Cancel", {
          onclick: () => {
            container.innerHTML = `
              <div class="card">
                <div class="card-body">
                  <p class="muted">Setup cancelled. Contact your administrator for access.</p>
                </div>
              </div>
            `;
          }
        })
      ])
    ]);
    container.appendChild(card3);
  }

  async function createFirstAdmin() {
    container.innerHTML = '<div class="empty"><div class="big">⏳</div>Creating Super Admin account…</div>';

    try {
      const user = ctx.user;
      if (!user || !user.uid) {
        throw new Error("User not authenticated");
      }

      // Create users document
      await db.save("users", {
        id: user.uid,
        uid: user.uid,
        email: user.email,
        role: "Super Admin",
        name: user.email,
        status: "Active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isSeed: true,
        autoBootstrapped: true
      }, { sync: true });

      // Create userRoles document
      await db.save("userRoles", {
        id: user.uid,
        uid: user.uid,
        email: user.email,
        role: "Super Admin",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isSeed: true,
        autoBootstrapped: true
      }, { sync: true });

      // Create counters collection with initial values
      const counters = [
        { id: "admission-" + new Date().getFullYear(), value: 0 },
        { id: "family-" + new Date().getFullYear(), value: 0 },
        { id: "studentId", value: 0 },
        { id: "staffId", value: 0 },
        { id: "invoiceNo", value: 0 },
        { id: "receiptNo", value: 0 },
        { id: "payslipNo", value: 0 },
        { id: "voucherNo", value: 0 },
        { id: "expenseNo", value: 0 }
      ];
      counters.forEach(c => db.save("counters", c, { sync: true }));

      container.innerHTML = `
        <div class="card">
          <div class="card-body">
            <p style="color:#2e7d32;font-weight:600;font-size:18px;margin-bottom:12px">✓ Setup Complete!</p>
            <p>Your Super Admin account has been created.</p>
            <ul style="margin-left:16px;margin-top:12px">
              <li>✓ users/{uid} profile created</li>
              <li>✓ userRoles/{uid} assigned</li>
              <li>✓ Counters initialized</li>
            </ul>
            <p style="margin-top:16px;color:#555;font-size:13px">
              Changes syncing to Firebase... You can now access all features.
            </p>
            <div style="margin-top:16px">
              ${btn("Close", {
                onclick: () => {
                  window.location.hash = "#/dashboard";
                }
              })}
            </div>
          </div>
        </div>
      `;

      toast("✓ Super Admin account created successfully!", "success");
      setTimeout(() => {
        window.location.hash = "#/dashboard";
      }, 2000);
    } catch (e) {
      console.error("Setup error:", e);
      container.innerHTML = `
        <div class="card" style="border-left:4px solid #c62828">
          <div class="card-body">
            <p style="color:#c62828;font-weight:600">❌ Setup Failed</p>
            <p>${e.message || "Unknown error during setup"}</p>
            <p style="font-size:12px;color:#999;margin-top:8px">${e.stack}</p>
            <div style="margin-top:12px">
              ${btn("Try Again", { onclick: () => runSetup() })}
              ${btn("Go to Dashboard", { onclick: () => window.location.hash = "#/dashboard" })}
            </div>
          </div>
        </div>
      `;
    }
  }

  // Start the flow
  runSetup();

  return () => {};
}
