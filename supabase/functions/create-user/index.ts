import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { email, password, name, role } = await req.json();
    if (!email || !password || !name || !role) {
      return new Response(JSON.stringify({ error: "Email, password, name, and role are required." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!accessToken) {
      console.warn("create-user rejected: Authorization header missing");
      return new Response(JSON.stringify({ error: "Unauthorized: sign in again and retry." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const adminClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data: { user }, error: authError } = await adminClient.auth.getUser(accessToken);
    if (authError || !user) {
      console.warn("create-user rejected: invalid session token", authError?.message ?? "no user");
      return new Response(JSON.stringify({ error: "Unauthorized: your session has expired. Sign in again and retry." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    console.info("create-user authenticated", { callerId: user.id });

    const { data: caller, error: callerError } = await adminClient
      .from("users")
      .select("id, user_roles(roles(name))")
      .eq("auth_id", user.id)
      .single();
    // PostgREST returns an object for a singular embedded relationship and an
    // array for a plural one. Normalize both response shapes before checking
    // the caller's administrator role.
    const roleLinks = Array.isArray(caller?.user_roles)
      ? caller.user_roles
      : caller?.user_roles
        ? [caller.user_roles]
        : [];
    const callerRoles = roleLinks
      .flatMap((link) => Array.isArray(link?.roles) ? link.roles : [link?.roles])
      .map((roleRecord) => roleRecord?.name?.toLowerCase())
      .filter(Boolean);
    if (callerError || !callerRoles.some((value) => value === "admin" || value === "super admin")) {
      return new Response(JSON.stringify({ error: "Forbidden. Only administrators can create accounts." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: roleRow, error: roleError } = await adminClient.from("roles").select("id").eq("name", role).single();
    if (roleError || !roleRow) {
      return new Response(JSON.stringify({ error: "The selected application role does not exist." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: authData, error: createError } = await adminClient.auth.admin.createUser({
      email: email.trim().toLowerCase(), password, email_confirm: true, user_metadata: { name },
    });
    if (createError || !authData.user) {
      return new Response(JSON.stringify({ error: createError?.message ?? "Unable to create Auth user." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: profile, error: profileError } = await adminClient.from("users")
      .insert({ auth_id: authData.user.id, email: authData.user.email, full_name: name.trim(), is_active: true })
      .select("id").single();
    const { error: linkError } = profile
      ? await adminClient.from("user_roles").insert({ user_id: profile.id, role_id: roleRow.id })
      : { error: null };

    // Also insert into legacy_records to support Phase 1 frontend cache
    const legacyUserPayload = {
      id: authData.user.id,
      uid: authData.user.id,
      email: authData.user.email,
      name: name.trim(),
      role: role.toLowerCase(),
      createdAt: Date.now(),
      isActive: true,
      auth_id: authData.user.id
    };
    const { error: legacyUserError } = await adminClient.from("legacy_records").upsert({
      collection: "users",
      record_id: authData.user.id,
      payload: legacyUserPayload,
      updated_at: new Date().toISOString()
    }, { onConflict: "collection,record_id" });

    const legacyRolePayload = {
      id: authData.user.id,
      uid: authData.user.id,
      role: role.toLowerCase()
    };
    const { error: legacyRoleError } = await adminClient.from("legacy_records").upsert({
      collection: "userRoles",
      record_id: authData.user.id,
      payload: legacyRolePayload,
      updated_at: new Date().toISOString()
    }, { onConflict: "collection,record_id" });

    if (profileError || linkError || legacyUserError || legacyRoleError) {
      await adminClient.auth.admin.deleteUser(authData.user.id);
      if (profile?.id) await adminClient.from("users").delete().eq("id", profile.id);
      
      const errMsg = profileError?.message || linkError?.message || legacyUserError?.message || legacyRoleError?.message;
      console.error("Failed to provision profile:", profileError || linkError || legacyUserError || legacyRoleError);
      
      return new Response(JSON.stringify({ error: `Failed to provision user profile. Account creation rolled back. Details: ${errMsg}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true, uid: authData.user.id, email: authData.user.email }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
