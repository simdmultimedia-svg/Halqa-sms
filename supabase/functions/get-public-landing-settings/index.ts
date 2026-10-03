import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// No collection or record parameters are accepted. Anonymous visitors can
// receive only these two public content records, never private school data.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers:corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error:"Method not allowed." }), { status:405, headers:{ ...corsHeaders, "Content-Type":"application/json" } });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data, error } = await admin.from("legacy_records")
      .select("record_id, payload, updated_at")
      .eq("collection", "settings")
      .in("record_id", ["landingPage", "onlineClasses"]);
    if (error) throw error;
    const rows = new Map((data || []).map((row) => [row.record_id, row]));
    const landing = rows.get("landingPage");
    const courses = rows.get("onlineClasses");
    return new Response(JSON.stringify({
      landingPage: landing?.payload || null,
      landingUpdatedAt: landing?.updated_at || null,
      onlineClasses: courses?.payload || null,
      onlineClassesUpdatedAt: courses?.updated_at || null,
    }), { headers:{ ...corsHeaders, "Content-Type":"application/json", "Cache-Control":"no-store" } });
  } catch (error) {
    console.error("public landing settings failed", error);
    return new Response(JSON.stringify({ error:error instanceof Error ? error.message : "Could not load public settings." }), { status:500, headers:{ ...corsHeaders, "Content-Type":"application/json" } });
  }
});
