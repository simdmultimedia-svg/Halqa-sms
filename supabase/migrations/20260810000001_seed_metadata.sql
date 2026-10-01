-- supabase/migrations/20260810000001_seed_metadata.sql
-- Description: Creates the seed_metadata table and seeds Storage bucket.

-- 1. Create the seed_metadata table
CREATE TABLE IF NOT EXISTS public.seed_metadata (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    school_id text NOT NULL,
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_by_email text,
    storage_path text NOT NULL,
    seed_version bigint NOT NULL,
    schema_version text NOT NULL DEFAULT '1',
    checksum text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    record_count integer DEFAULT 0,
    file_size_bytes bigint DEFAULT 0,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Add an index for fast lookups by school_id and version
CREATE INDEX IF NOT EXISTS idx_seed_metadata_school_version 
ON public.seed_metadata(school_id, seed_version DESC);

-- 3. Enable RLS
ALTER TABLE public.seed_metadata ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies for seed_metadata
DROP POLICY IF EXISTS "Enable read access for all authenticated users" ON public.seed_metadata;
CREATE POLICY "Enable read access for all authenticated users" 
ON public.seed_metadata FOR SELECT 
TO authenticated 
USING (true);

DROP POLICY IF EXISTS "Enable insert for Super Admin and Admin" ON public.seed_metadata;
CREATE POLICY "Enable insert for Super Admin and Admin" 
ON public.seed_metadata FOR INSERT 
TO authenticated 
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.id = auth.uid() AND (users.role = 'Super Admin' OR users.role = 'Admin')
    )
);

DROP POLICY IF EXISTS "Enable update for Super Admin and Admin" ON public.seed_metadata;
CREATE POLICY "Enable update for Super Admin and Admin" 
ON public.seed_metadata FOR UPDATE
TO authenticated 
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.id = auth.uid() AND (users.role = 'Super Admin' OR users.role = 'Admin')
    )
);

-- 5. Enable Realtime for seed_metadata
-- The publication 'supabase_realtime' should already exist from previous migrations.
-- We safely add the table to it if it's not already there.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'seed_metadata'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.seed_metadata;
    END IF;
END
$$;

-- 6. Create the private `seeds` Storage bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public) 
VALUES ('seeds', 'seeds', false)
ON CONFLICT (id) DO NOTHING;

-- 7. Storage RLS Policies for `seeds` bucket
DROP POLICY IF EXISTS "Authenticated users can download seeds" ON storage.objects;
CREATE POLICY "Authenticated users can download seeds"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'seeds');

DROP POLICY IF EXISTS "Admins can upload seeds" ON storage.objects;
CREATE POLICY "Admins can upload seeds"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'seeds' AND
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.id = auth.uid() AND (users.role = 'Super Admin' OR users.role = 'Admin')
    )
);

DROP POLICY IF EXISTS "Admins can update seeds" ON storage.objects;
CREATE POLICY "Admins can update seeds"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'seeds' AND
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.id = auth.uid() AND (users.role = 'Super Admin' OR users.role = 'Admin')
    )
);

DROP POLICY IF EXISTS "Admins can delete seeds" ON storage.objects;
CREATE POLICY "Admins can delete seeds"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'seeds' AND
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.id = auth.uid() AND (users.role = 'Super Admin' OR users.role = 'Admin')
    )
);
