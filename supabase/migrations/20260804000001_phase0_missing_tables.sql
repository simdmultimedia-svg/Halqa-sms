-- Phase 0: Add missing tables for data migration
create table if not exists public.payslips (
  id                  uuid primary key default gen_random_uuid(),
  staff_id            uuid not null references public.staff(id) on delete cascade,
  month               text,
  month_label         text,
  pay_date            text,
  basic               numeric default 0,
  office_allowance    numeric default 0,
  special_allowance   numeric default 0,
  bonus               numeric default 0,
  bonuses             jsonb,
  deduction           numeric default 0,
  deductions          jsonb,
  lateness_deduction  numeric default 0,
  absence_deduction   numeric default 0,
  attendance_deduction numeric default 0,
  net_pay             numeric default 0,
  working_days        integer default 0,
  late_days           integer default 0,
  days_absent         integer default 0,
  late_permission_days integer default 0,
  absent_permission_days integer default 0,
  remarks             text,
  attendance_records  jsonb,
  staff_name          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists trg_payslips_updated_at on public.payslips;
create trigger trg_payslips_updated_at before update on public.payslips for each row execute procedure public.set_updated_at();

create table if not exists public.staff_attendance (
  id                  uuid primary key default gen_random_uuid(),
  date                date not null,
  records             jsonb,
  by                  text,
  at                  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists trg_staff_attendance_updated_at on public.staff_attendance;
create trigger trg_staff_attendance_updated_at before update on public.staff_attendance for each row execute procedure public.set_updated_at();

create table if not exists public.result_approvals (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references public.academic_sessions(id) on delete cascade,
  term_id             uuid not null references public.terms(id) on delete cascade,
  class_id            text,
  subject             text,
  status              text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists trg_result_approvals_updated_at on public.result_approvals;
create trigger trg_result_approvals_updated_at before update on public.result_approvals for each row execute procedure public.set_updated_at();

alter table public.payslips enable row level security;
alter table public.staff_attendance enable row level security;
alter table public.result_approvals enable row level security;
