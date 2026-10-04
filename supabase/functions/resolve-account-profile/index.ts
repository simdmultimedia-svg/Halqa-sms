import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers:{ ...corsHeaders, "Content-Type":"application/json" } });

// The caller's bearer token is verified before this function returns their own
// profile. Service-role access is used only to make role resolution atomic.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers:corsHeaders });
  if (req.method !== "POST") return reply({ error:"Method not allowed." }, 405);
  try {
    const auth = req.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return reply({ error:"Unauthorized." }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data:{ user }, error:userError } = await admin.auth.getUser(token);
    if (userError || !user) return reply({ error:"Unauthorized." }, 401);
    const { data: profile, error:profileError } = await admin.from("users")
      .select("id, auth_id, email, full_name, is_active, student_id, user_roles(roles(name))")
      .eq("auth_id", user.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile) return reply({ error:"Account profile not found." }, 404);
    const relation = Array.isArray(profile.user_roles) ? profile.user_roles : profile.user_roles ? [profile.user_roles] : [];
    let role = relation.flatMap((link) => Array.isArray(link?.roles) ? link.roles : [link?.roles]).map((item) => item?.name).find(Boolean) || null;
    if (!role) {
      const { data: legacy } = await admin.from("legacy_records").select("payload").eq("collection", "userRoles").eq("record_id", user.id).maybeSingle();
      role = legacy?.payload?.role || null;
    }
    if (!role) return reply({ error:"Account role not found." }, 404);
    return reply({ profile:{ uid:user.id, email:profile.email || user.email || "", name:profile.full_name || "", role, staffId:null, studentId:profile.student_id || null, active:profile.is_active } });
  } catch (error) {
    console.error("account profile resolution failed", error);
    return reply({ error:error instanceof Error ? error.message : "Profile lookup failed." }, 500);
  }
});
