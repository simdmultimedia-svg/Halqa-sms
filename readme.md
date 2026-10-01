# HALQA Enterprise School Management System (HALQA SMS)

A complete, offline-first school management platform for **Halqatu Zaid bin Sabit Tahfizul Qur'an waddarasatul Islamiyya Kano**.
Built with vanilla **HTML5 / CSS3 / ES6 modules** — no build step, no framework — and an optional
**Firebase** backend (Authentication + Realtime Database + Firestore) for multi-device realtime sync.

> _"Education For All"_

---

## Highlights

- **Local-first / offline-first.** Everything works with no internet using `localStorage`. When cloud
  mode is enabled and online, every change is mirrored to Firebase at the **record level** (never bulk
  collection writes) and realtime listeners merge remote changes back.
- **Multi-user-safe sequential IDs.** Admission numbers (`HALQA/2026/001`), student/staff/invoice/receipt
  numbers use Firebase **transaction counters** (`counters/{name}/value`) — never `array.length + 1`.
- **Role-Based Access Control** with 9 roles and configurable module access.
- **Five independent sections** — Pre-Basic, Basic, Secondary, Islamiyya, Tahfiz — each with their own
  services, fees, uniforms, books, classes and subjects. **Nothing is hardcoded**; everything is editable
  from Settings.
- **Branded, print-ready documents** (invoice, receipt, payslip, payment voucher, report cards, ID cards)
  with the school logo, header, QR code and color-coded payment status — all rendered offline.
- **Report cards auto-switch** between Western, Islamiyya and Tahfiz templates based on the student's section.

## Modules

Dashboard · Admission · Migration · Students · Promotion · Fees & Payments · Invoices · Receipts ·
Expenses · Attendance · Examinations/CBT · Results · Report Cards · Staff · Payslips · Salary ·
Payment Voucher · Inventory · Reports · Audit Trail · Backup & Restore · Settings.

---

## Running locally

No dependencies or build step. Serve the folder over HTTP (ES modules require `http://`, not `file://`):

```bash
cd kano-central-int-l-school-sms
python3 -m http.server 8080
# open http://localhost:8080
```

### Default logins (Local Mode)

| Role        | Email                     | Password    |
|-------------|---------------------------|-------------|
| Super Admin | `admin@halqa.local`       | `admin123`  |
| Accountant  | `accountant@halqa.local`  | `account123`|

Local Mode stores all data in the browser only. Use **Cloud (Firebase)** mode on the login screen to
sync with the shared Firebase project.

---

## Architecture

```
index.html              Login + app shell
css/styles.css          Theme (light/dark), layout, print styles
js/app.js               Bootstrap, nav, router wiring, auth state
js/config/              firebase-config.js, logo-base64.js
js/core/
  store.js              localStorage-backed collections + pub/sub
  db.js                 Public data API + offline sync queue (record-level)
  firebase.js           Firebase SDK load, listeners, sync handler, counter transactions
  auth.js               Auth (Firebase cloud / seeded local), session
  rbac.js               Roles, module access, capability checks
  idgen.js              Transaction-based sequential IDs
  config.js             Read accessors over editable settings
  seed.js               First-run default configuration (editable afterwards)
  billing.js            Invoice / payment / receipt logic
  branding.js           Single source of truth for document branding
  print.js / documents.js  Print engine + branded document templates
  ui.js / router.js / utils.js
js/modules/*.js         One file per feature module
firebase/               Security rules + indexes
firebase.json           Hosting + DB/Firestore rules wiring
```

### Data model

- **Realtime Database** (operational data): `students`, `staff`, `invoices`, `receipts`, `payments`,
  `attendance`, `staffAttendance`, `results`, `cbt`, `cbtAttempts`, `expenses`, `inventory`,
  `payslips`, `paymentVouchers`, `auditLogs`, `migrationLogs`, `promotionLogs`, `users`, `userRoles`,
  and `counters`. Each collection is a map keyed by record id (`/{collection}/{id}`).
- **Firestore** (`settings/*` documents): school profile/branding, sections, classes, services,
  section fees, uniforms, books, subjects, academic session, grading scale, promotion paths, roles.

---

## Deploying to Firebase Hosting

1. Install the CLI and log in:
   ```bash
   npm install -g firebase-tools
   firebase login
   ```
2. The repo already contains `firebase.json` and `.firebaserc` (project `kano-central-int-l-school`).
3. Deploy hosting + rules:
   ```bash
   firebase deploy --only hosting,database,firestore:rules
   ```

### Enabling cloud mode

In the Firebase console for project **kano-central-int-l-school**:
- **Authentication → Sign-in method**: enable **Email/Password**.
- Create the admin user `admin@halqa.local`. On first cloud login this email is bootstrapped to
  **Super Admin** and a matching `userRoles/{uid}` record is created. Other users default to **Staff**
  until an Admin assigns a role in **Settings → Users**.

## Security rules

- `firebase/database.rules.json` — all access requires authentication. `counters` are writable by any
  authenticated user (needed for ID transactions). **Payslips** are readable only by Admin / Accountant,
  or by the owning staff member (`payslips/{id}.uid == auth.uid`). User/role administration is limited to
  Admin / Super Admin.
- `firebase/firestore.rules` — settings are readable by all authenticated users and writable only by
  Admin / Super Admin; audit logs are append-only and admin-readable.

Roles are resolved from `userRoles/{uid}.role`, which the rules read to enforce capabilities.

## Backup, restore & reset

**Backup & Restore** exports a full JSON snapshot and restores by merging records. **Settings → System
Reset** (Super Admin only) offers: reset academic session, reset financial records, reset both, or full
factory reset — each creates a downloadable restore point first.

## Notes

- Firebase **Storage is not used**; the school logo and branding are stored as Base64 in settings.
- The QR library (`assets/qrcode.js`) is bundled locally so documents render offline.

