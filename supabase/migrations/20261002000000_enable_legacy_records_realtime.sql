-- Ensure every device receives changes saved through the offline-first
-- legacy_records compatibility layer. REPLICA IDENTITY FULL preserves enough
-- data for delete events to remove the matching local record.
ALTER TABLE public.legacy_records REPLICA IDENTITY FULL;

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
