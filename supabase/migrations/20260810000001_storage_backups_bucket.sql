-- ============================================================================
-- CICK Enterprise — Supabase Storage: Private Backups Bucket Policy
-- Run this in the Supabase Dashboard SQL Editor (NOT via migrations CLI,
-- because storage schema is managed by Supabase internally).
-- ============================================================================

-- Create the private 'backups' bucket (50 MB limit, JSON only)
-- ON CONFLICT: safe to re-run; existing bucket is left unchanged.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'backups',
  'backups',
  false,                          -- PRIVATE: never publicly accessible
  52428800,                       -- 50 MB per file
  ARRAY['application/json', 'application/octet-stream']
)
ON CONFLICT (id) DO UPDATE
  SET public            = false,
      file_size_limit   = 52428800,
      allowed_mime_types = ARRAY['application/json', 'application/octet-stream'];

-- ===== Storage RLS Policies =====
-- Drop existing policies first (idempotent re-run)
DROP POLICY IF EXISTS "admin_can_upload_backups"     ON storage.objects;
DROP POLICY IF EXISTS "authenticated_can_download_backups" ON storage.objects;
DROP POLICY IF EXISTS "admin_can_delete_backups"     ON storage.objects;
DROP POLICY IF EXISTS "admin_can_update_backups"     ON storage.objects;

-- Admin / Super Admin: INSERT (upload new backup files)
CREATE POLICY "admin_can_upload_backups"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'backups'
    AND (
      public.has_role('admin')
      OR public.has_role('Admin')
      OR public.has_role('super admin')
      OR public.has_role('Super Admin')
    )
  );

-- ALL authenticated users: SELECT (download backup for restore)
-- The file is still private — anon users cannot access it.
CREATE POLICY "authenticated_can_download_backups"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'backups');

-- Admin / Super Admin: DELETE (cleanup old backup files)
CREATE POLICY "admin_can_delete_backups"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'backups'
    AND (
      public.has_role('admin')
      OR public.has_role('Admin')
      OR public.has_role('super admin')
      OR public.has_role('Super Admin')
    )
  );

-- Admin / Super Admin: UPDATE (replace/overwrite a file)
CREATE POLICY "admin_can_update_backups"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'backups'
    AND (
      public.has_role('admin')
      OR public.has_role('Admin')
      OR public.has_role('super admin')
      OR public.has_role('Super Admin')
    )
  );
