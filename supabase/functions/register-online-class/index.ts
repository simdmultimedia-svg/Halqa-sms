import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FALLBACK_COURSES = [
  ["noorani", "Noorani Qaida"], ["tajweed", "Qur'an Reading with Tajweed"], ["hifz", "Memorizing the Qur'an (Hifz)"],
  ["islamic", "Basic Islamic Education"], ["salah", "Complete Namaz (Salah)"], ["tafseer", "Translation and Tafseer"],
];

const text = (value: unknown, limit: number) => String(value ?? "").trim().slice(0, limit);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const body = await req.json();
    // Silently accept bots without writing their data.
    if (text(body.website, 200)) return new Response(JSON.stringify({ success:true, reference:"Received" }), { headers:{ ...corsHeaders, "Content-Type":"application/json" } });
    const courseId = text(body.courseId, 80);
    const fullName = text(body.fullName, 120);
    const email = text(body.email, 160).toLowerCase();
    const phone = text(body.phone, 50);
    if (!courseId || !fullName || !phone || !/^\S+@\S+\.\S+$/.test(email)) {
      return new Response(JSON.stringify({ error:"Course, full name, valid email, and phone number are required." }), { status:400, headers:{ ...corsHeaders, "Content-Type":"application/json" } });
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data: courseSetting } = await admin.from("legacy_records").select("payload").eq("collection", "settings").eq("record_id", "onlineClasses").maybeSingle();
    const configured = Array.isArray(courseSetting?.payload?.list) ? courseSetting.payload.list : [];
    const course = [...configured, ...FALLBACK_COURSES.map(([id, title]) => ({ id, title }))].find((item) => item?.id === courseId && item?.active !== false);
    if (!course) return new Response(JSON.stringify({ error:"This online class is unavailable. Please refresh the page and try again." }), { status:400, headers:{ ...corsHeaders, "Content-Type":"application/json" } });
    const id = crypto.randomUUID();
    const reference = `OCL-${Date.now().toString(36).toUpperCase()}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase().slice(-4)}`;
    const now = Date.now();
    const payload = { id, reference, courseId, courseTitle:text(course.title, 160), fullName, email, phone, guardianName:text(body.guardianName, 120), location:text(body.location, 120), preferredSchedule:text(body.preferredSchedule, 80), notes:text(body.notes, 800), status:"Pending", submittedAt:now, updatedAt:now, source:"public-online-registration" };
    const { error } = await admin.from("legacy_records").upsert({ collection:"onlineRegistrations", record_id:id, payload, updated_at:new Date().toISOString() }, { onConflict:"collection,record_id" });
    if (error) throw error;
    return new Response(JSON.stringify({ success:true, reference }), { headers:{ ...corsHeaders, "Content-Type":"application/json" } });
  } catch (error) {
    console.error("online registration failed", error);
    return new Response(JSON.stringify({ error:error instanceof Error ? error.message : "Registration could not be submitted." }), { status:500, headers:{ ...corsHeaders, "Content-Type":"application/json" } });
  }
});
