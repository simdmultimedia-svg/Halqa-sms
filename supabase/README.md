# CICK Enterprise — Supabase Backend

This directory contains the complete Supabase backend workspace for the **CIC Kano Enterprise School Management System**.

> **⚠️ Important:** The existing Firebase production system remains fully operational and unchanged. This Supabase workspace is developed in parallel and does **not** affect any live functionality.

---

## 📁 Folder Structure

```text
supabase/
├── config.toml                          # Supabase CLI configuration
├── migrations/
│   └── 20260804000000_initial_schema.sql # Base schema (24 tables)
├── seed.sql                             # Demo data for local development
├── functions/
│   ├── generate-report-card/            # PDF report card generation
│   ├── generate-payment-voucher/        # Payment voucher documents
│   ├── send-notification/               # Push/email/SMS alerts
│   ├── sync-offline-queue/              # Offline sync processor
│   └── README.md                        # Function documentation
├── policies/
│   ├── admin.sql                        # Admin RLS policies
│   ├── teacher.sql                      # Teacher RLS policies
│   ├── accountant.sql                   # Accountant RLS policies
│   ├── parent.sql                       # Parent RLS policies
│   └── student.sql                      # Student RLS policies
├── types/
│   └── database.ts                      # Auto-generated TypeScript types
├── scripts/
│   └── generate-types.sh                # Type generation script
├── README.md                            # This file
└── .gitignore
```

---

## 🚀 Getting Started

### Prerequisites

1. Install the **Supabase CLI**:
   ```bash
   npm install -g supabase
   ```

2. Install **Docker Desktop** (required for local Supabase):
   - [Docker Desktop](https://www.docker.com/products/docker-desktop/)

### Start Local Supabase

```bash
cd supabase
supabase start
```

This will spin up local instances of:
- **PostgreSQL** (port 54322)
- **PostgREST API** (port 54321)
- **Supabase Studio** (port 54323) — visual database manager
- **Auth** server
- **Storage** server

### Stop Local Supabase

```bash
supabase stop
```

---

## 🗄️ Running Migrations

Migrations are applied automatically when you run `supabase start`. To apply new migrations manually:

```bash
supabase db reset
```

This command will:
1. Drop and recreate the database
2. Apply all migrations in order
3. Run `seed.sql`

### Create a New Migration

```bash
supabase migration new <migration_name>
```

Example:
```bash
supabase migration new add_parent_student_link
```

---

## 🌱 Seeding Data

The `seed.sql` file contains minimal demo records:
- One admin user with admin role
- Five roles (admin, teacher, accountant, parent, student)
- One academic session (2025/2026)
- One term (First Term)
- One sample class (JSS 1) with one section

Seed data is applied automatically after migrations during `supabase db reset`.

To seed manually:
```bash
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/seed.sql
```

---

## 🔄 Resetting the Database

To completely reset and rebuild:

```bash
supabase db reset
```

This drops everything, re-runs all migrations, and applies seed data.

---

## 📝 Generating TypeScript Types

After making schema changes, regenerate the TypeScript types:

```bash
# Using the provided script:
./supabase/scripts/generate-types.sh

# Or directly:
npx supabase gen types typescript --local > supabase/types/database.ts
```

---

## 🚢 Deployment Workflow

### 1. Link to Remote Project

```bash
supabase link --project-ref <your-project-ref>
```

### 2. Push Migrations

```bash
supabase db push
```

### 3. Deploy Edge Functions

```bash
supabase functions deploy generate-report-card
supabase functions deploy generate-payment-voucher
supabase functions deploy send-notification
supabase functions deploy sync-offline-queue
```

### 4. Set Environment Variables

```bash
supabase secrets set MY_SECRET=value
```

---

## 🔐 Row Level Security (RLS)

RLS is **enabled on all tables** in the initial migration. Policy placeholder files are in `policies/`:

| File | Role | Access Level |
|---|---|---|
| `admin.sql` | Admin | Full CRUD on all tables |
| `teacher.sql` | Teacher | Read classes/students, write exam results |
| `accountant.sql` | Accountant | Manage all finance tables |
| `parent.sql` | Parent | Read own children's records |
| `student.sql` | Student | Read own records |

> **Note:** These are placeholder scaffolds. Implement and test policies thoroughly before production deployment.

---

## 📊 Database Schema

The initial migration creates **24 tables** organized into domains:

| Domain | Tables |
|---|---|
| **Users & Roles** | `users`, `roles`, `user_roles` |
| **Academic** | `academic_sessions`, `terms`, `classes`, `sections`, `subjects` |
| **People** | `students`, `staff`, `parents` |
| **Enrollment** | `enrollments`, `attendance` |
| **Exams** | `exams`, `exam_results` |
| **Finance** | `fee_structures`, `invoices`, `invoice_items`, `receipts`, `payment_vouchers`, `expenses` |
| **System** | `school_settings`, `audit_logs`, `notifications` |

All tables use:
- **UUID primary keys** (`gen_random_uuid()` via pgcrypto)
- **`created_at`** and **`updated_at`** timestamp columns
- Automatic `updated_at` trigger via `set_updated_at()` function
