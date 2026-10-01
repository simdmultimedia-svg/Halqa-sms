-- ============================================================================
-- CICK Enterprise — Initial Schema Migration
-- Generated: 2026-08-04
--
-- This migration creates the complete base schema for the CICK Enterprise
-- School Management System on PostgreSQL / Supabase.
--
-- Conventions:
--   • UUID primary keys (gen_random_uuid via pgcrypto)
--   • created_at / updated_at timestamps on every table
--   • snake_case naming throughout
-- ============================================================================

-- ===================  Extensions  ===================
create extension if not exists "pgcrypto";

-- ===================  Helper: auto-update updated_at  ===================
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================================
-- 1. USERS & ROLES
-- ============================================================================

-- Roles --
create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_roles_updated_at before update on public.roles
  for each row execute function public.set_updated_at();

-- Users --
create table if not exists public.users (
  id          uuid primary key default gen_random_uuid(),
  auth_id     uuid unique,                       -- links to supabase auth.users
  email       text unique,
  full_name   text not null,
  phone       text,
  avatar_url  text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_users_updated_at before update on public.users
  for each row execute function public.set_updated_at();

-- User ↔ Role junction --
create table if not exists public.user_roles (
  user_id  uuid not null references public.users(id) on delete cascade,
  role_id  uuid not null references public.roles(id) on delete cascade,
  primary key (user_id, role_id),
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 2. ACADEMIC STRUCTURE
-- ============================================================================

-- Academic Sessions --
create table if not exists public.academic_sessions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,             -- e.g. '2025/2026'
  start_date  date,
  end_date    date,
  is_current  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_academic_sessions_updated_at before update on public.academic_sessions
  for each row execute function public.set_updated_at();

-- Terms --
create table if not exists public.terms (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.academic_sessions(id) on delete cascade,
  name        text not null,                    -- e.g. 'First Term'
  start_date  date,
  end_date    date,
  is_current  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_terms_updated_at before update on public.terms
  for each row execute function public.set_updated_at();

-- Classes --
create table if not exists public.classes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  level       integer,
  capacity    integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_classes_updated_at before update on public.classes
  for each row execute function public.set_updated_at();

-- Sections --
create table if not exists public.sections (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes(id) on delete cascade,
  name        text not null,                    -- e.g. 'A', 'B'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_sections_updated_at before update on public.sections
  for each row execute function public.set_updated_at();

-- Subjects --
create table if not exists public.subjects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_subjects_updated_at before update on public.subjects
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 3. PEOPLE
-- ============================================================================

-- Students --
create table if not exists public.students (
  id              uuid primary key default gen_random_uuid(),
  admission_no    text unique,
  first_name      text not null,
  last_name       text not null,
  middle_name     text,
  gender          text check (gender in ('male', 'female')),
  date_of_birth   date,
  address         text,
  photo_url       text,
  blood_group     text,
  genotype        text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_students_updated_at before update on public.students
  for each row execute function public.set_updated_at();

-- Staff --
create table if not exists public.staff (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.users(id) on delete set null,
  staff_id_no     text unique,
  first_name      text not null,
  last_name       text not null,
  department      text,
  designation     text,
  phone           text,
  email           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_staff_updated_at before update on public.staff
  for each row execute function public.set_updated_at();

-- Parents --
create table if not exists public.parents (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.users(id) on delete set null,
  full_name       text not null,
  phone           text,
  email           text,
  address         text,
  occupation      text,
  relationship    text,                          -- father, mother, guardian
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_parents_updated_at before update on public.parents
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 4. ENROLLMENT & ATTENDANCE
-- ============================================================================

-- Enrollments --
create table if not exists public.enrollments (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students(id) on delete cascade,
  class_id    uuid not null references public.classes(id) on delete cascade,
  section_id  uuid references public.sections(id) on delete set null,
  session_id  uuid not null references public.academic_sessions(id) on delete cascade,
  term_id     uuid references public.terms(id) on delete set null,
  status      text not null default 'active' check (status in ('active','transferred','graduated','withdrawn')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (student_id, session_id, term_id)
);
create trigger trg_enrollments_updated_at before update on public.enrollments
  for each row execute function public.set_updated_at();

-- Attendance --
create table if not exists public.attendance (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students(id) on delete cascade,
  class_id    uuid not null references public.classes(id) on delete cascade,
  date        date not null,
  status      text not null check (status in ('present','absent','late','excused')),
  remark      text,
  recorded_by uuid references public.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_attendance_updated_at before update on public.attendance
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 5. EXAMS & RESULTS
-- ============================================================================

-- Exams --
create table if not exists public.exams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                    -- e.g. 'First CA', 'Final Exam'
  session_id  uuid not null references public.academic_sessions(id) on delete cascade,
  term_id     uuid not null references public.terms(id) on delete cascade,
  max_score   numeric(5,2) not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_exams_updated_at before update on public.exams
  for each row execute function public.set_updated_at();

-- Exam Results --
create table if not exists public.exam_results (
  id          uuid primary key default gen_random_uuid(),
  exam_id     uuid not null references public.exams(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  subject_id  uuid not null references public.subjects(id) on delete cascade,
  score       numeric(5,2),
  grade       text,
  remark      text,
  recorded_by uuid references public.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (exam_id, student_id, subject_id)
);
create trigger trg_exam_results_updated_at before update on public.exam_results
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 6. FINANCE
-- ============================================================================

-- Fee Structures --
create table if not exists public.fee_structures (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  class_id    uuid references public.classes(id) on delete set null,
  session_id  uuid references public.academic_sessions(id) on delete set null,
  term_id     uuid references public.terms(id) on delete set null,
  amount      numeric(12,2) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_fee_structures_updated_at before update on public.fee_structures
  for each row execute function public.set_updated_at();

-- Invoices --
create table if not exists public.invoices (
  id          uuid primary key default gen_random_uuid(),
  invoice_no  text unique,
  student_id  uuid not null references public.students(id) on delete cascade,
  session_id  uuid not null references public.academic_sessions(id),
  term_id     uuid references public.terms(id),
  total       numeric(12,2) not null default 0,
  paid        numeric(12,2) not null default 0,
  balance     numeric(12,2) generated always as (total - paid) stored,
  status      text not null default 'unpaid' check (status in ('unpaid','partial','paid','void')),
  due_date    date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_invoices_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();

-- Invoice Items --
create table if not exists public.invoice_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  description text not null,
  amount      numeric(12,2) not null default 0,
  created_at  timestamptz not null default now()
);

-- Receipts --
create table if not exists public.receipts (
  id          uuid primary key default gen_random_uuid(),
  receipt_no  text unique,
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  amount      numeric(12,2) not null,
  payment_method text,                           -- cash, transfer, pos
  paid_by     text,
  received_by uuid references public.users(id),
  date        date not null default current_date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_receipts_updated_at before update on public.receipts
  for each row execute function public.set_updated_at();

-- Payment Vouchers --
create table if not exists public.payment_vouchers (
  id          uuid primary key default gen_random_uuid(),
  voucher_no  text unique,
  payee       text not null,
  description text,
  amount      numeric(12,2) not null,
  approved_by uuid references public.users(id),
  status      text not null default 'pending' check (status in ('pending','approved','rejected','paid')),
  date        date not null default current_date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_payment_vouchers_updated_at before update on public.payment_vouchers
  for each row execute function public.set_updated_at();

-- Expenses --
create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  category    text,
  description text not null,
  amount      numeric(12,2) not null,
  voucher_id  uuid references public.payment_vouchers(id) on delete set null,
  date        date not null default current_date,
  recorded_by uuid references public.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_expenses_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 7. SYSTEM
-- ============================================================================

-- School Settings (key/value store) --
create table if not exists public.school_settings (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  value       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_school_settings_updated_at before update on public.school_settings
  for each row execute function public.set_updated_at();

-- Audit Logs --
create table if not exists public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.users(id) on delete set null,
  action      text not null,                     -- CREATE, UPDATE, DELETE
  table_name  text not null,
  record_id   uuid,
  old_data    jsonb,
  new_data    jsonb,
  ip_address  inet,
  created_at  timestamptz not null default now()
);
-- No updated_at — audit logs are immutable

-- Notifications --
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.users(id) on delete cascade,
  title       text not null,
  body        text,
  type        text,                              -- info, warning, success, error
  is_read     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_notifications_updated_at before update on public.notifications
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Row Level Security: Enable on all tables (policies created separately)
-- ============================================================================
alter table public.roles             enable row level security;
alter table public.users             enable row level security;
alter table public.user_roles        enable row level security;
alter table public.academic_sessions enable row level security;
alter table public.terms             enable row level security;
alter table public.classes           enable row level security;
alter table public.sections          enable row level security;
alter table public.subjects          enable row level security;
alter table public.students          enable row level security;
alter table public.staff             enable row level security;
alter table public.parents           enable row level security;
alter table public.enrollments       enable row level security;
alter table public.attendance        enable row level security;
alter table public.exams             enable row level security;
alter table public.exam_results      enable row level security;
alter table public.fee_structures    enable row level security;
alter table public.invoices          enable row level security;
alter table public.invoice_items     enable row level security;
alter table public.receipts          enable row level security;
alter table public.payment_vouchers  enable row level security;
alter table public.expenses          enable row level security;
alter table public.school_settings   enable row level security;
alter table public.audit_logs        enable row level security;
alter table public.notifications     enable row level security;

-- ============================================================================
-- Indexes for common queries
-- ============================================================================
create index if not exists idx_students_admission_no on public.students(admission_no);
create index if not exists idx_enrollments_student   on public.enrollments(student_id);
create index if not exists idx_enrollments_session   on public.enrollments(session_id);
create index if not exists idx_exam_results_student  on public.exam_results(student_id);
create index if not exists idx_exam_results_exam     on public.exam_results(exam_id);
create index if not exists idx_invoices_student      on public.invoices(student_id);
create index if not exists idx_attendance_student    on public.attendance(student_id);
create index if not exists idx_attendance_date       on public.attendance(date);
create index if not exists idx_audit_logs_user       on public.audit_logs(user_id);
create index if not exists idx_audit_logs_table      on public.audit_logs(table_name);
create index if not exists idx_notifications_user    on public.notifications(user_id);
