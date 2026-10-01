-- ============================================================================
-- CICK Enterprise — Seed Data
-- Minimal demo records for local development and testing.
-- ============================================================================

-- 1. Roles
INSERT INTO public.roles (id, name, description)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin',      'Full system administrator'),
  ('a0000000-0000-0000-0000-000000000002', 'teacher',    'Teaching staff'),
  ('a0000000-0000-0000-0000-000000000003', 'accountant', 'Financial operations'),
  ('a0000000-0000-0000-0000-000000000004', 'parent',     'Parent / Guardian'),
  ('a0000000-0000-0000-0000-000000000005', 'student',    'Student')
ON CONFLICT (id) DO NOTHING;

-- 2. Admin User
INSERT INTO public.users (id, email, full_name, phone, is_active)
VALUES
  ('b0000000-0000-0000-0000-000000000001', 'admin@cic-kano.com', 'System Administrator', '+2340000000000', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Assign Admin Role
INSERT INTO public.user_roles (user_id, role_id)
VALUES
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001')
ON CONFLICT (user_id, role_id) DO NOTHING;

-- 4. Academic Session
INSERT INTO public.academic_sessions (id, name, start_date, end_date, is_current)
VALUES
  ('c0000000-0000-0000-0000-000000000001', '2025/2026', '2025-09-01', '2026-07-31', true)
ON CONFLICT (id) DO NOTHING;

-- 5. Term
INSERT INTO public.terms (id, session_id, name, start_date, end_date, is_current)
VALUES
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'First Term', '2025-09-01', '2025-12-20', true)
ON CONFLICT (id) DO NOTHING;

-- 6. Sample Class
INSERT INTO public.classes (id, name, level, capacity)
VALUES
  ('e0000000-0000-0000-0000-000000000001', 'JSS 1', 1, 40)
ON CONFLICT (id) DO NOTHING;

-- 7. Sample Section
INSERT INTO public.sections (id, class_id, name)
VALUES
  ('f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'A')
ON CONFLICT (id) DO NOTHING;

-- 8. School Settings
INSERT INTO public.school_settings (id, key, value)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'school_name', 'CIC Kano Enterprise'),
  ('00000000-0000-0000-0000-000000000002', 'current_session', '2025/2026'),
  ('00000000-0000-0000-0000-000000000003', 'current_term', 'First Term')
ON CONFLICT (id) DO NOTHING;
