# CRITICAL PERMISSION FIX & USER MANAGEMENT PLAN

This document outlines the architectural changes necessary to repair the `PERMISSION_DENIED` issue on the `payslips` collection, establish foolproof role resolution, and build the comprehensive Admin User Management dashboard.

## Goal Description

The application suffers from an overly broad sync engine that eagerly subscribes to collections (like `/payslips`) regardless of a user's role. This contradicts Firebase rules and causes `PERMISSION_DENIED` errors. Furthermore, administrators need a full-featured dashboard to manage user accounts (create, edit, disable, reset password, delete) directly from the application.

## User Review Required

> [!WARNING]
> **Hard Delete Execution (Super Admin)**: For Super Admins, a "Hard Delete" will completely wipe the user from `users`, `userRoles`, and potentially their Firebase Auth identity. However, Firebase Client SDKs cannot delete *another* user's authentication account directly (only their own). To execute a true Hard Delete on Auth, we would need a Cloud Function. As a client-only workaround, Hard Delete will permanently remove all their database records, effectively destroying their identity. Is this acceptable?
>
> **Payslip Listeners**: I will enforce that Staff/Teachers can only listen to `payslips` using `orderByChild("staffId")` equal to their `staffId`. I assume that every Staff/Teacher role is assigned a `staffId` in their `userRoles` or `users` profile.

## Open Questions

> [!IMPORTANT]
> 1. **Password Resets**: Do you want the "Reset Password" button to set the user's password to a generic default (e.g., `changeme123`), or should it generate a random password and display it to the Admin?

## Proposed Changes

---

### 1. Fix Sync Listeners (Payslips & Roles)

#### [MODIFY] `js/core/firebase.js`
- **Role Resolution Pre-Check**: Ensure `userRoles/{uid}` is explicitly fetched *before* calling `flushQueue()` or `startListeners()` if the role is missing from local cache. This prevents Admins from defaulting to `"user"`.
- **Restrict Root Listeners**: Exclude `payslips` from the default `RTDB_COLLECTIONS` listener for anyone who is not an Admin/Super Admin/Accountant.
### Authentication Core (`js/core/auth.js`)

We will rewrite `auth.js` to interface with the Supabase client initialized in `js/core/supabase.js`.

#### [MODIFY] `auth.js`
- **Imports:** Switch from `firebase.js` to `supabase.js` (e.g., `getState`, `stopListeners`, `setMode`).
- **`login`:** Call `st.client.auth.signInWithPassword({ email, password })`.
- **`logout`:** Call `st.client.auth.signOut()`.
- **`createUserAccount`:** 
  - Create a temporary Supabase client to call `signUp` so the Admin isn't logged out.
  - After successful `signUp`, insert records directly into `public.users` and `public.user_roles` via the primary Supabase client.
  - Implement rollback (delete user) using a Supabase Edge Function or RPC if the insert fails (since client cannot delete users directly in Supabase without Admin API, we will either need a service key or we handle it gracefully).
- **Session Cache & Role Resolution (`window.addEventListener("auth:change")` & `restoreSession`)**:
  - Replace Firestore `getDoc` calls with Supabase `st.client.from('user_roles').select('role').eq('id', uid).single()`.
  - Maintain the exact same `fastLoginUser` IndexedDB caching behavior to preserve offline support and fast session restore.

### Supabase Adapter (`js/core/supabase.js`)

#### [MODIFY] `supabase.js`
- Ensure the `onAuthStateChange` listener correctly dispatches the `auth:change` custom event (which `auth.js` listens to). Currently it just sets `state.authReady`. We need to emit a custom event with `uid` just like Firebase did.

## Verification Plan

### Automated Tests
- Run `npm run test` or check Playwright tests if available for auth flows.

### Manual Verification
- **Login:** Log in as `admin@cic-kano.com` and verify the Dashboard loads.
- **Session Restore:** Refresh the page and ensure the user remains logged in instantly.
- **Account Creation:** Attempt to create a new Staff account and verify it appears in `users` and `user_roles`.
- **Logout:** Log out and verify redirection to the login screen.
