-- A student portal account belongs to exactly one student record.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS student_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_users_student_id ON public.users(student_id);
