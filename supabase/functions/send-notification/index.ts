// supabase/functions/send-notification/index.ts
// ============================================================================
// CICK Enterprise — Edge Function: Send Notification
// ============================================================================
//
// Purpose:
//   Sends push notifications, emails, or SMS alerts to users.
//   Supports bulk notifications (e.g. fee reminders to all parents)
//   and individual alerts (e.g. exam result published).
//
// Expected Input (JSON body):
//   {
//     recipientIds: string[],
//     title: string,
//     body: string,
//     type: "push" | "email" | "sms",
//     channel?: string
//   }
//
// Expected Output:
//   { success: boolean, sent: number, failed: number }
//
// Status: PLACEHOLDER — implementation pending.
// ============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

serve(async (req) => {
  return new Response(
    JSON.stringify({ message: "send-notification: not yet implemented" }),
    { status: 501, headers: { "Content-Type": "application/json" } }
  );
});
