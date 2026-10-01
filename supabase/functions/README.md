# CICK Enterprise — Edge Functions

This directory contains Supabase Edge Functions (Deno-based serverless functions)
for the CICK Enterprise School Management System.

## Functions

| Function | Purpose | Status |
|---|---|---|
| `generate-report-card` | Generates PDF report cards for students with exam results, attendance, and remarks. | Placeholder |
| `generate-payment-voucher` | Creates printable payment voucher documents for approved expenditures. | Placeholder |
| `send-notification` | Sends push notifications, emails, or SMS alerts to users (bulk and individual). | Placeholder |
| `sync-offline-queue` | Receives batched offline operations from client devices and applies them to the database. | Placeholder |

## Development

### Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) installed
- [Deno](https://deno.land/) installed (for local testing)

### Serve locally

```bash
supabase functions serve <function-name> --env-file ./supabase/.env.local
```

### Deploy

```bash
supabase functions deploy <function-name> --project-ref <your-project-ref>
```

### Testing

```bash
curl -i --location --request POST \
  'http://127.0.0.1:54321/functions/v1/<function-name>' \
  --header 'Authorization: Bearer <anon-key>' \
  --header 'Content-Type: application/json' \
  --data '{"key": "value"}'
```
