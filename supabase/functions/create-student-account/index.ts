import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const clean = (value: unknown, limit: number) => String(value ?? "").trim().slice(0, limit);
const emailKey = (value: unknown) => clean(value, 160).toLowerCase();
const phoneKey = (value: unknown) => clean(value, 50).replace(/\D/g, "");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers:{ ...corsHeaders, "Content-Type":"application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers:corsHeaders });
  if (req.method !== "POST") return json({ error:"Method not allowed." }, 405);
  try {
    const body = await req.json();
    const mode = clean(body.mode, 20);
    const identifier = clean(body.identifier, 120);
    const email = emailKey(body.email);
    const password = String(body.password ?? "");
    if (!["school", "online"].includes(mode) || !identifier || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
      return json({ error:"Enter valid account details. Passwords must have at least 8 characters." }, 400);
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data: exists, error: existsError } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    if (existsError) throw existsError;
    if (exists) return json({ error:"An account already exists for this email. Use Student Login instead." }, 409);

    let name = "";
    let studentId: string | null = null;
    let onlineRegistration: Record<string, unknown> | null = null;
    let onlineRecordId = "";
    if (mode === "school") {
      const submittedPhone = phoneKey(body.registeredPhone);
      if (!submittedPhone) return json({ error:"Enter the registered parent or guardian phone number." }, 400);
      const { data: records, error } = await admin.from("legacy_records").select("record_id, payload").eq("collection", "students").limit(1000);
      if (error) throw error;
      const student = (records || []).find((item) => {
        const record = item.payload as Record<string, unknown>;
        return [item.record_id, record?.id, record?.studentId, record?.admissionNo].some((value) => clean(value, 120).toLowerCase() === identifier.toLowerCase());
      });
      if (!student) return json({ error:"We could not find that school student record." }, 404);
      const record = student.payload as Record<string, unknown>;
      const validPhones = [record.parentPhone, record.phone, record.guardianPhone, record.emergencyPhone].map(phoneKey).filter(Boolean);
      if (!validPhones.includes(submittedPhone)) return json({ error:"The phone number does not match the school record. Contact the school office for assistance." }, 403);
      name = clean(record.fullName || record.name, 160);
      studentId = clean(record.id || record.studentId || student.record_id, 120) || null;
    } else {
      const { data: records, error } = await admin.from("legacy_records").select("record_id, payload").eq("collection", "onlineRegistrations").limit(1000);
      if (error) throw error;
      const match = (records || []).find((item) => {
        const record = item.payload as Record<string, unknown>;
        return clean(record.reference, 120).toLowerCase() === identifier.toLowerCase() && emailKey(record.email) === email;
      });
      if (!match) return json({ error:"No online registration matches that reference and email." }, 404);
      const record = match.payload as Record<string, unknown>;
      if (!["Approved", "Enrolled"].includes(clean(record.status, 30))) return json({ error:"Your online-class registration must be approved before an account can be created." }, 403);
      if (record.accountUid) return json({ error:"An account has already been created for this online-class registration." }, 409);
      name = clean(record.fullName, 160);
      onlineRegistration = record;
      onlineRecordId = match.record_id;
    }
    if (!name) return json({ error:"The learner record is incomplete. Contact the school office." }, 400);

    const { data: roleRow, error: roleError } = await admin.from("roles").select("id").eq("name", "Student").single();
    if (roleError || !roleRow) return json({ error:"The Student role is not configured. Contact the administrator." }, 500);
    const { data: authData, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm:true, user_metadata:{ name, role:"Student", student_id:studentId, online_learner:mode === "online" } });
    if (createError || !authData.user) return json({ error:createError?.message || "Could not create the login account." }, 400);
    const uid = authData.user.id;
    const { data: profile, error: profileError } = await admin.from("users").insert({ auth_id:uid, email, full_name:name, is_active:true, student_id:studentId }).select("id").single();
    const { error: linkError } = profile ? await admin.from("user_roles").insert({ user_id:profile.id, role_id:roleRow.id }) : { error:null };
    const userPayload = { id:uid, uid, email, name, role:"student", studentId, onlineRegistrationId:onlineRecordId || null, onlineLearner:mode === "online", createdAt:Date.now(), isActive:true, auth_id:uid };
    const rolePayload = { id:uid, uid, email, role:"student", studentId, onlineRegistrationId:onlineRecordId || null };
    const { error: legacyUserError } = await admin.from("legacy_records").upsert({ collection:"users", record_id:uid, payload:userPayload, updated_at:new Date().toISOString() }, { onConflict:"collection,record_id" });
    const { error: legacyRoleError } = await admin.from("legacy_records").upsert({ collection:"userRoles", record_id:uid, payload:rolePayload, updated_at:new Date().toISOString() }, { onConflict:"collection,record_id" });
    if (profileError || linkError || legacyUserError || legacyRoleError) {
      await admin.auth.admin.deleteUser(uid);
      if (profile?.id) await admin.from("users").delete().eq("id", profile.id);
      throw profileError || linkError || legacyUserError || legacyRoleError;
    }
    if (onlineRegistration) {
      const updatedRegistration = { ...onlineRegistration, accountUid:uid, accountEmail:email, accountCreatedAt:Date.now(), updatedAt:Date.now() };
      const { error } = await admin.from("legacy_records").upsert({ collection:"onlineRegistrations", record_id:onlineRecordId, payload:updatedRegistration, updated_at:new Date().toISOString() }, { onConflict:"collection,record_id" });
      if (error) console.error("Account created but registration marker failed", error);
    }
    return json({ success:true, email });
  } catch (error) {
    console.error("student account creation failed", error);
    return json({ error:error instanceof Error ? error.message : "Account creation could not be completed." }, 500);
  }
});
