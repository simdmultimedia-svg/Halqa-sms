import { db } from "../core/db.js";
import { el, toast } from "../core/utils.js";
import { card, pageHead, field, input, btn } from "../core/ui.js";
import { getState } from "../core/adapter.js";
import { sha256 } from "../core/auth.js";
import { registerBiometric } from "../core/webauthn.js";

export async function render(root, ctx) {
  const user = ctx.user;
  root.appendChild(pageHead("My Profile", "Account profile and password."));

  const current = input({ type: "password", autocomplete: "current-password" });
  const next = input({ type: "password", autocomplete: "new-password" });
  const confirm = input({ type: "password", autocomplete: "new-password" });
  const note = user.forcePasswordChange
    ? el("p", { class: "note", style: "color:var(--warning);font-weight:700", text: "Security Recommendation: Please change your default password." })
    : el("p", { class: "muted", text: "Password changes update Firebase Authentication and your synced profile records." });

  root.appendChild(card("Account", [
    el("div", { class: "form-grid" }, [
      field("Email", el("strong", { text: user.email || "" })),
      field("Role", el("strong", { text: user.role || "" }))
    ])
  ]));

  root.appendChild(card("Change Password", [
    note,
    el("div", { class: "form-grid" }, [
      field("Current Password", current),
      field("New Password", next),
      field("Confirm New Password", confirm)
    ]),
    el("div", { class: "row", style: "margin-top:12px" }, [
      btn("Update Password", { variant: "primary", onclick: async () => {
        if (!current.value || !next.value) return toast("Enter current and new password.", "error");
        if (next.value.length < 6) return toast("New password must be at least 6 characters.", "error");
        if (next.value !== confirm.value) return toast("New passwords do not match.", "error");
        const st = getState();
        try {
          if (st.mode === "cloud" && st.ready && st.auth?.currentUser) {
            const actionName = "myprofile:update-password";
            const firebaseUser = st.auth.currentUser;
            console.log("Current Firebase User:", firebaseUser?.email);
            console.log("Action:", actionName);
            if (!firebaseUser?.email) throw new Error("No active Firebase user session.");
            if (user.email && String(firebaseUser.email).toLowerCase() !== String(user.email).toLowerCase()) {
              console.warn("[AUTH] Session email differs from Firebase Auth user; using current Firebase user for reauthentication.", {
                sessionEmail: user.email,
                firebaseEmail: firebaseUser.email
              });
            }
            const { EmailAuthProvider, reauthenticateWithCredential, updatePassword } = st.sdk.auth;
            const credential = EmailAuthProvider.credential(firebaseUser.email, current.value);
            await reauthenticateWithCredential(firebaseUser, credential);
            await updatePassword(firebaseUser, next.value);
          }
          const hash = await sha256(next.value);
          const userRec = db.get("users", user.uid) || { id: user.uid, uid: user.uid, email: user.email, role: user.role };
          userRec.passwordHash = hash;
          userRec.forcePasswordChange = false;
          userRec.updatedAt = Date.now();
          db.save("users", userRec);
          const roleRec = db.get("userRoles", user.uid) || { id: user.uid, uid: user.uid, email: user.email, role: user.role };
          roleRec.forcePasswordChange = false;
          roleRec.updatedAt = Date.now();
          db.save("userRoles", roleRec);
          user.forcePasswordChange = false;
          try {
            const raw = sessionStorage.getItem("CIC KANO:session");
            const session = raw ? JSON.parse(raw) : null;
            if (session) {
              session.forcePasswordChange = false;
              sessionStorage.setItem("CIC KANO:session", JSON.stringify(session));
            }
          } catch {}
          toast("Password updated successfully. Please continue.", "success");
          window.location.hash = "#/dashboard";
        } catch (e) {
          toast("Failed to update password: " + (e.code || e.message), "error", 8000);
        }
      } })
    ])
  ]));

  const bioStatus = localStorage.getItem("CIC KANO:bio_default") === user.email ? "Enabled" : "Not configured";
  root.appendChild(card("Biometric Login", [
    el("p", { class: "muted", text: "Use your device's fingerprint, face unlock, or PIN to sign in quickly without a password. This is tied to your current device and browser." }),
    field("Status", el("strong", { text: bioStatus })),
    el("div", { class: "row", style: "margin-top:12px; gap: 8px" }, [
      btn("Enable Biometric Login", { variant: "primary", onclick: async () => {
        const pwd = prompt("Enter your current password to enable biometric login:");
        if (!pwd) return;
        await registerBiometric(user.email, pwd);
        ctx.go("myprofile"); // reload
      }}),
      btn("Disable", { variant: "ghost", onclick: () => {
        localStorage.removeItem("CIC KANO:bio:" + user.email);
        localStorage.removeItem("CIC KANO:bio_id:" + user.email);
        if (localStorage.getItem("CIC KANO:bio_default") === user.email) {
            localStorage.removeItem("CIC KANO:bio_default");
        }
        toast("Biometric login disabled for this device.", "success");
        ctx.go("myprofile");
      }})
    ])
  ]));
}
