// Supabase Auth and profile resolution.
// The application role is sourced from public.users -> public.user_roles -> public.roles.

import { getState, stopListeners, SUPABASE_KEY, SUPABASE_URL } from "./supabase.js";
import { idbGet, idbSet } from "./idb.js";

let current = null;
const listeners = new Set();
export const DEFAULT_SUPER_ADMIN_EMAIL = "admin@cic-kano.com";

export async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function getCurrentUser() { return current; }
export function onAuthChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((fn) => fn(current)); }

let sessionCacheResolver = null;
let sessionCachePromise = new Promise((resolve) => { sessionCacheResolver = resolve; });
export function waitForSessionCache() { return sessionCachePromise; }

function getRole(profile) {
  // Priority: 1) users.role (direct column), 2) user_roles relationship
  return profile?.role || profile?.user_roles?.[0]?.roles?.name || null;
}

async function getProfile(client, uid, sessionEmail = "") {
  const { data, error } = await client
    .from("users")
    .select("id, auth_id, email, full_name, is_active, student_id, user_roles(roles(name))")
    .eq("auth_id", uid)
    .maybeSingle();

  if (error) throw new Error(`Could not load account profile: ${error.message}`);

  // Auto-create user profile if it doesn't exist
  if (!data) {
    console.log("[AUTH] No profile found, creating user profile automatically");
    try {
      // Determine if this should be a Super Admin (first user or admin email)
      const isAdminEmail = sessionEmail.includes('admin@') || sessionEmail === DEFAULT_SUPER_ADMIN_EMAIL;

      // Create user profile with appropriate role
      const { error: insertError } = await client
        .from("users")
        .insert({
          auth_id: uid,
          email: sessionEmail,
          full_name: sessionEmail.split('@')[0] || "User",
          is_active: true,
          role: isAdminEmail ? "Super Admin" : "Staff",
          status: "Active"
        });

      if (insertError) {
        console.error("[AUTH] Failed to create user profile:", insertError);
        return null;
      }

      // Fetch the newly created profile
      const { data: newData, error: newError } = await client
        .from("users")
        .select("id, auth_id, email, full_name, is_active, student_id, user_roles(roles(name))")
        .eq("auth_id", uid)
        .maybeSingle();

      if (newError) throw new Error(`Could not load newly created profile: ${newError.message}`);
      if (!newData) return null;

      return {
        uid,
        email: newData.email || sessionEmail,
        name: newData.full_name || "",
        role: getRole(newData) || newData.role || "Staff",
        staffId: null,
        studentId: newData.student_id || null,
        active: newData.is_active,
      };
    } catch (err) {
      console.error("[AUTH] Auto-profile creation failed:", err);
      return null;
    }
  }

  return {
    uid,
    email: data.email || sessionEmail,
    name: data.full_name || "",
    role: getRole(data) || data.role || "Staff",
    staffId: null,
    studentId: data.student_id || null,
    active: data.is_active,
  };
}

async function setCurrentFromSession(session) {
  sessionCachePromise = new Promise((resolve) => { sessionCacheResolver = resolve; });
  if (!session) {
    current = null;
    await idbSet("fastLoginUser", null);
    emit();
    sessionCacheResolver();
    return;
  }

  const st = getState();
  try {
    const profile = await getProfile(st.client, session.user.id, session.user.email || "");
    current = profile;
    await idbSet("fastLoginUser", profile);
    emit();
  } catch (error) {
    console.warn("[AUTH] Could not load Supabase profile:", error.message);
    current = null;
    await idbSet("fastLoginUser", null);
    emit();
  } finally {
    sessionCacheResolver();
  }
}

window.addEventListener("auth:change", (event) => {
  const st = getState();
  if (!event.detail?.uid || !st.client) {
    setCurrentFromSession(null);
    return;
  }
  st.client.auth.getSession().then(({ data }) => setCurrentFromSession(data.session));
});

export async function login(email, password) {
  const st = getState();
  if (st.mode !== "cloud") throw new Error("Login requires cloud mode.");
  if (!st.client) throw new Error("Supabase client not ready.");

  const { data, error } = await st.client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);

  const profile = await getProfile(st.client, data.user.id, data.user.email || email);
  if (!profile) {
    await st.client.auth.signOut();
    throw new Error("This account has no Supabase profile. Contact an administrator.");
  }
  if (!profile.active) {
    await st.client.auth.signOut();
    throw new Error("This account is disabled. Contact an administrator.");
  }
  if (!profile.role) {
    await st.client.auth.signOut();
    throw new Error("This account has no assigned role. Contact an administrator.");
  }
  return data;
}

export async function restoreSession() {
  const st = getState();
  if (st.ready && st.client) {
    const { data } = await st.client.auth.getSession();
    if (data.session) {
      await setCurrentFromSession(data.session);
      return current;
    }
  }
  current = await idbGet("fastLoginUser") || null;
  return current;
}

export async function createUserAccount({ email, password, name, role, staffId, studentId, forcePasswordChange }) {
  const st = getState();
  if (!st.client) throw new Error("Supabase client not ready.");

  // Try using Edge Function first, fall back to direct client approach
  try {
    const { data: { session }, error: sessionError } = await st.client.auth.refreshSession();
    if (sessionError || !session) throw new Error("Your session has expired. Please sign in again before creating an account.");

    const { data, error } = await st.client.functions.invoke('create-user', {
      body: { email, password, name, role, staffId, studentId }
    });

    if (error) {
      let msg = error.message;
      if (error.context && typeof error.context.json === 'function') {
        try {
          const body = await error.context.json();
          if (body?.error) msg = body.error;
        } catch (e) { }
      }
      throw new Error(msg || "Account creation request failed.");
    }
    if (data?.error) throw new Error(data.error);
    return { success: true, uid: data.uid, email: data.email };
  } catch (edgeFunctionError) {
    console.warn("[AUTH] Edge function failed, falling back to direct client:", edgeFunctionError.message);

    // Fallback: Create user directly using Supabase client
    // Note: This requires service role key which should not be exposed in client
    // For now, we'll create the auth user and profile separately
    try {
      // Create auth user (this requires admin privileges)
      // Since we can't use service role key in client, we'll use a different approach
      throw new Error("Edge function not deployed. Please deploy the create-user function to Supabase using: supabase functions deploy create-user");
    } catch (fallbackError) {
      throw new Error(`User creation failed: ${edgeFunctionError.message}. ${fallbackError.message}`);
    }
  }
}

export async function createLocalUser(options) { return createUserAccount(options); }

export async function logout() {
  const st = getState();
  if (st.client) await st.client.auth.signOut();
  await stopListeners();
  await setCurrentFromSession(null);
}

export async function checkUserRole(uid) {
  const st = getState();
  if (!st.client) return null;
  const profile = await getProfile(st.client, uid);
  return profile?.role || null;
}
