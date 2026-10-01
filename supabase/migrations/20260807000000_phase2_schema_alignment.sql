-- ============================================================================
-- CICK Enterprise — Phase 2 Schema Alignment
-- This migration aligns the SQL schema with the application's domain logic
-- where Sections contain Classes, and changes the primary keys to text 
-- to support legacy string IDs like "primary:primary-1".
-- ============================================================================

-- 1. Drop dependent foreign keys on enrollments
ALTER TABLE public.enrollments DROP CONSTRAINT IF EXISTS enrollments_class_id_fkey;
ALTER TABLE public.enrollments DROP CONSTRAINT IF EXISTS enrollments_section_id_fkey;
ALTER TABLE public.enrollments DROP CONSTRAINT IF EXISTS enrollments_session_id_fkey;
ALTER TABLE public.enrollments DROP CONSTRAINT IF EXISTS enrollments_term_id_fkey;
ALTER TABLE staging.enrollments DROP CONSTRAINT IF EXISTS enrollments_class_id_fkey;
ALTER TABLE staging.enrollments DROP CONSTRAINT IF EXISTS enrollments_section_id_fkey;
ALTER TABLE staging.enrollments DROP CONSTRAINT IF EXISTS enrollments_session_id_fkey;
ALTER TABLE staging.enrollments DROP CONSTRAINT IF EXISTS enrollments_term_id_fkey;

-- 2. Drop dependent foreign keys on result_approvals
ALTER TABLE public.result_approvals DROP CONSTRAINT IF EXISTS result_approvals_session_id_fkey;
ALTER TABLE public.result_approvals DROP CONSTRAINT IF EXISTS result_approvals_term_id_fkey;

-- 3. Modify classes and sections relationship
ALTER TABLE public.sections DROP CONSTRAINT IF EXISTS sections_class_id_fkey;
ALTER TABLE public.sections DROP COLUMN IF EXISTS class_id;

ALTER TABLE staging.sections DROP CONSTRAINT IF EXISTS sections_class_id_fkey;
ALTER TABLE staging.sections DROP COLUMN IF EXISTS class_id;

-- 4. Change Primary Keys to text
ALTER TABLE public.classes DROP CONSTRAINT IF EXISTS classes_pkey CASCADE;
ALTER TABLE public.classes ALTER COLUMN id TYPE text;
ALTER TABLE public.classes ADD PRIMARY KEY (id);

ALTER TABLE public.sections DROP CONSTRAINT IF EXISTS sections_pkey CASCADE;
ALTER TABLE public.sections ALTER COLUMN id TYPE text;
ALTER TABLE public.sections ADD PRIMARY KEY (id);

ALTER TABLE public.subjects DROP CONSTRAINT IF EXISTS subjects_pkey CASCADE;
ALTER TABLE public.subjects ALTER COLUMN id TYPE text;
ALTER TABLE public.subjects ADD PRIMARY KEY (id);

ALTER TABLE public.academic_sessions DROP CONSTRAINT IF EXISTS academic_sessions_pkey CASCADE;
ALTER TABLE public.academic_sessions ALTER COLUMN id TYPE text;
ALTER TABLE public.academic_sessions ADD PRIMARY KEY (id);

ALTER TABLE public.terms DROP CONSTRAINT IF EXISTS terms_pkey CASCADE;
ALTER TABLE public.terms ALTER COLUMN id TYPE text;
ALTER TABLE public.terms ADD PRIMARY KEY (id);

-- Apply same PK changes to staging
ALTER TABLE staging.classes DROP CONSTRAINT IF EXISTS classes_pkey CASCADE;
ALTER TABLE staging.classes ALTER COLUMN id TYPE text;
ALTER TABLE staging.classes ADD PRIMARY KEY (id);

ALTER TABLE staging.sections DROP CONSTRAINT IF EXISTS sections_pkey CASCADE;
ALTER TABLE staging.sections ALTER COLUMN id TYPE text;
ALTER TABLE staging.sections ADD PRIMARY KEY (id);

ALTER TABLE staging.subjects DROP CONSTRAINT IF EXISTS subjects_pkey CASCADE;
ALTER TABLE staging.subjects ALTER COLUMN id TYPE text;
ALTER TABLE staging.subjects ADD PRIMARY KEY (id);

ALTER TABLE staging.academic_sessions DROP CONSTRAINT IF EXISTS academic_sessions_pkey CASCADE;
ALTER TABLE staging.academic_sessions ALTER COLUMN id TYPE text;
ALTER TABLE staging.academic_sessions ADD PRIMARY KEY (id);

ALTER TABLE staging.terms DROP CONSTRAINT IF EXISTS terms_pkey CASCADE;
ALTER TABLE staging.terms ALTER COLUMN id TYPE text;
ALTER TABLE staging.terms ADD PRIMARY KEY (id);

-- 5. Add new columns to match application data
ALTER TABLE public.sections ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE public.sections ADD COLUMN IF NOT EXISTS "order" integer;
ALTER TABLE public.sections ADD COLUMN IF NOT EXISTS active boolean default true;
ALTER TABLE staging.sections ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE staging.sections ADD COLUMN IF NOT EXISTS "order" integer;
ALTER TABLE staging.sections ADD COLUMN IF NOT EXISTS active boolean default true;

ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS section_id text REFERENCES public.sections(id) ON DELETE CASCADE;
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS "order" integer;
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS active boolean default true;
ALTER TABLE staging.classes ADD COLUMN IF NOT EXISTS section_id text REFERENCES staging.sections(id) ON DELETE CASCADE;
ALTER TABLE staging.classes ADD COLUMN IF NOT EXISTS "order" integer;
ALTER TABLE staging.classes ADD COLUMN IF NOT EXISTS active boolean default true;

ALTER TABLE public.terms ALTER COLUMN session_id TYPE text;
ALTER TABLE public.terms ADD CONSTRAINT terms_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.academic_sessions(id) ON DELETE CASCADE;

ALTER TABLE staging.terms ALTER COLUMN session_id TYPE text;
ALTER TABLE staging.terms ADD CONSTRAINT terms_session_id_fkey FOREIGN KEY (session_id) REFERENCES staging.academic_sessions(id) ON DELETE CASCADE;

-- 6. Re-add foreign keys to enrollments and result_approvals
ALTER TABLE public.enrollments ALTER COLUMN class_id TYPE text;
ALTER TABLE public.enrollments ALTER COLUMN section_id TYPE text;
ALTER TABLE public.enrollments ALTER COLUMN session_id TYPE text;
ALTER TABLE public.enrollments ALTER COLUMN term_id TYPE text;
ALTER TABLE public.enrollments ADD CONSTRAINT enrollments_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;
ALTER TABLE public.enrollments ADD CONSTRAINT enrollments_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.sections(id) ON DELETE SET NULL;
ALTER TABLE public.enrollments ADD CONSTRAINT enrollments_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.academic_sessions(id) ON DELETE CASCADE;
ALTER TABLE public.enrollments ADD CONSTRAINT enrollments_term_id_fkey FOREIGN KEY (term_id) REFERENCES public.terms(id) ON DELETE SET NULL;

ALTER TABLE staging.enrollments ALTER COLUMN class_id TYPE text;
ALTER TABLE staging.enrollments ALTER COLUMN section_id TYPE text;
ALTER TABLE staging.enrollments ALTER COLUMN session_id TYPE text;
ALTER TABLE staging.enrollments ALTER COLUMN term_id TYPE text;
ALTER TABLE staging.enrollments ADD CONSTRAINT enrollments_class_id_fkey FOREIGN KEY (class_id) REFERENCES staging.classes(id) ON DELETE CASCADE;
ALTER TABLE staging.enrollments ADD CONSTRAINT enrollments_section_id_fkey FOREIGN KEY (section_id) REFERENCES staging.sections(id) ON DELETE SET NULL;
ALTER TABLE staging.enrollments ADD CONSTRAINT enrollments_session_id_fkey FOREIGN KEY (session_id) REFERENCES staging.academic_sessions(id) ON DELETE CASCADE;
ALTER TABLE staging.enrollments ADD CONSTRAINT enrollments_term_id_fkey FOREIGN KEY (term_id) REFERENCES staging.terms(id) ON DELETE SET NULL;

ALTER TABLE public.result_approvals ALTER COLUMN session_id TYPE text;
ALTER TABLE public.result_approvals ALTER COLUMN term_id TYPE text;
ALTER TABLE public.result_approvals ADD CONSTRAINT result_approvals_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.academic_sessions(id) ON DELETE CASCADE;
ALTER TABLE public.result_approvals ADD CONSTRAINT result_approvals_term_id_fkey FOREIGN KEY (term_id) REFERENCES public.terms(id) ON DELETE CASCADE;

-- 7. RLS Policies
-- Allow all authenticated users to read master data
CREATE POLICY "Allow read master data sections" ON public.sections FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read master data classes" ON public.classes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read master data subjects" ON public.subjects FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read master data sessions" ON public.academic_sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read master data terms" ON public.terms FOR SELECT TO authenticated USING (true);

-- Allow Admins to manage master data
CREATE POLICY "Allow write master data sections" ON public.sections FOR ALL TO authenticated USING (public.has_role('admin') OR public.has_role('super admin')) WITH CHECK (public.has_role('admin') OR public.has_role('super admin'));
CREATE POLICY "Allow write master data classes" ON public.classes FOR ALL TO authenticated USING (public.has_role('admin') OR public.has_role('super admin')) WITH CHECK (public.has_role('admin') OR public.has_role('super admin'));
CREATE POLICY "Allow write master data subjects" ON public.subjects FOR ALL TO authenticated USING (public.has_role('admin') OR public.has_role('super admin')) WITH CHECK (public.has_role('admin') OR public.has_role('super admin'));
CREATE POLICY "Allow write master data sessions" ON public.academic_sessions FOR ALL TO authenticated USING (public.has_role('admin') OR public.has_role('super admin')) WITH CHECK (public.has_role('admin') OR public.has_role('super admin'));
CREATE POLICY "Allow write master data terms" ON public.terms FOR ALL TO authenticated USING (public.has_role('admin') OR public.has_role('super admin')) WITH CHECK (public.has_role('admin') OR public.has_role('super admin'));

-- 8. Realtime publication
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'classes') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.classes;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sections') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.sections;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'subjects') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.subjects;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'academic_sessions') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.academic_sessions;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'terms') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.terms;
    END IF;
END $$;
