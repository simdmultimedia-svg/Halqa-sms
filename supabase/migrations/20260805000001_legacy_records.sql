-- ============================================================================
-- CICK Enterprise — Legacy Records Compatibility Layer
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.legacy_records (
    collection text not null,
    record_id text not null,
    payload jsonb not null,
    updated_at timestamptz not null default now(),
    PRIMARY KEY (collection, record_id)
);

-- Enable RLS
ALTER TABLE public.legacy_records ENABLE ROW LEVEL SECURITY;

-- Fix the has_role helper
CREATE OR REPLACE FUNCTION public.has_role(role_name text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT exists (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.users u ON u.id = ur.user_id
    JOIN public.roles r ON r.id = ur.role_id
    WHERE u.auth_id = auth.uid()
      AND lower(r.name) = lower(role_name)
  );
$$;

-- Allow Admin and Super Admin full access
DROP POLICY IF EXISTS "Allow Admin access to legacy_records" ON public.legacy_records;
CREATE POLICY "Allow Admin access to legacy_records" ON public.legacy_records 
    FOR ALL TO authenticated 
    USING (public.has_role('admin') OR public.has_role('Admin') OR public.has_role('super admin') OR public.has_role('Super Admin')) 
    WITH CHECK (public.has_role('admin') OR public.has_role('Admin') OR public.has_role('super admin') OR public.has_role('Super Admin'));

-- Triggers for updated_at
DROP TRIGGER IF EXISTS trg_legacy_records_updated_at ON public.legacy_records;
CREATE TRIGGER trg_legacy_records_updated_at BEFORE UPDATE ON public.legacy_records
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Add to realtime publication idempotently
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'legacy_records'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.legacy_records;
    END IF;
END $$;
