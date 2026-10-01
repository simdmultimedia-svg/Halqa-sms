-- ============================================================================
-- CICK Enterprise — Backup Metadata Table
-- Created: 2026-08-10
--
-- This table is the ONLY thing stored in the database for backups.
-- The actual backup JSON blob is stored in Supabase Storage (private bucket).
-- This table provides:
--   1. A lightweight pointer to the Storage object (storage_path)
--   2. Integrity data (checksum, schema_version, backup_version)
--   3. Realtime notification mechanism for cross-device sync
--   4. Tenant scoping (school_id)
-- ============================================================================

-- ============ Table ============
CREATE TABLE IF NOT EXISTS public.backup_metadata (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         text        NOT NULL DEFAULT 'default',
  created_by        uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_email  text        NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  storage_path      text        NOT NULL,
  backup_version    bigint      NOT NULL,   -- Unix ms timestamp; used for ordering/dedup
  schema_version    text        NOT NULL DEFAULT '1',
  checksum          text        NOT NULL,   -- SHA-256 hex of the raw JSON blob
  status            text        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'superseded', 'failed')),
  record_count      integer,
  file_size_bytes   integer,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE TRIGGER trg_backup_metadata_updated_at
  BEFORE UPDATE ON public.backup_metadata
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Index for fast "latest active backup" query
CREATE INDEX IF NOT EXISTS idx_backup_metadata_version
  ON public.backup_metadata (backup_version DESC)
  WHERE status = 'active';

-- ============ Row Level Security ============
ALTER TABLE public.backup_metadata ENABLE ROW LEVEL SECURITY;

-- Admin / Super Admin: can insert new backup metadata
CREATE POLICY "admin_can_insert_backup_metadata"
  ON public.backup_metadata
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role('admin')
    OR public.has_role('Admin')
    OR public.has_role('super admin')
    OR public.has_role('Super Admin')
  );

-- Admin / Super Admin: can update (e.g. mark old backups as 'superseded')
CREATE POLICY "admin_can_update_backup_metadata"
  ON public.backup_metadata
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role('admin')
    OR public.has_role('Admin')
    OR public.has_role('super admin')
    OR public.has_role('Super Admin')
  )
  WITH CHECK (
    public.has_role('admin')
    OR public.has_role('Admin')
    OR public.has_role('super admin')
    OR public.has_role('Super Admin')
  );

-- Admin / Super Admin: can delete metadata rows
CREATE POLICY "admin_can_delete_backup_metadata"
  ON public.backup_metadata
  FOR DELETE
  TO authenticated
  USING (
    public.has_role('admin')
    OR public.has_role('Admin')
    OR public.has_role('super admin')
    OR public.has_role('Super Admin')
  );

-- ALL authenticated users: can read backup metadata (needed for restore on any device)
CREATE POLICY "authenticated_can_read_backup_metadata"
  ON public.backup_metadata
  FOR SELECT
  TO authenticated
  USING (true);

-- ============ Realtime Publication ============
-- Adds backup_metadata to the Realtime publication so all devices receive INSERT events.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_publication_tables
    WHERE  pubname    = 'supabase_realtime'
      AND  schemaname = 'public'
      AND  tablename  = 'backup_metadata'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.backup_metadata;
  END IF;
END $$;
