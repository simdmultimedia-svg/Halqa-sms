-- Drop the overly restrictive RLS policy that prevents normal users from reading/writing
DROP POLICY IF EXISTS "Allow Admin access to legacy_records" ON public.legacy_records;

-- Create a more permissive policy for the legacy migration period.
-- Since the frontend app filters its own collections and the old Firebase rules allowed authenticated users to read most data,
-- this mimics the necessary access to allow the frontend adapter to sync.
CREATE POLICY "Allow authenticated full access to legacy_records" 
    ON public.legacy_records 
    FOR ALL 
    TO authenticated 
    USING (true) 
    WITH CHECK (true);
