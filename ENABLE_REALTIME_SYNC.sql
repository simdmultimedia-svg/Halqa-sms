-- ============================================
-- ENABLE REALTIME SYNCHRONIZATION FOR APP TABLES
-- Run this SQL in your Supabase SQL Editor
-- ============================================

-- Enable Realtime on users table (if not already enabled)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'users'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE users;
    RAISE NOTICE 'Added users to realtime publication';
  ELSE
    RAISE NOTICE 'users already in realtime publication';
  END IF;
END $$;

-- Enable Realtime on user_roles table (if not already enabled)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'user_roles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE user_roles;
    RAISE NOTICE 'Added user_roles to realtime publication';
  ELSE
    RAISE NOTICE 'user_roles already in realtime publication';
  END IF;
END $$;

-- Enable Realtime on roles table (if not already enabled)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'roles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE roles;
    RAISE NOTICE 'Added roles to realtime publication';
  ELSE
    RAISE NOTICE 'roles already in realtime publication';
  END IF;
END $$;

-- Enable Realtime on students table (if it exists and not already enabled)
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'students') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND tablename = 'students'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE students;
      RAISE NOTICE 'Added students to realtime publication';
    ELSE
      RAISE NOTICE 'students already in realtime publication';
    END IF;
  ELSE
    RAISE NOTICE 'students table does not exist';
  END IF;
END $$;

-- Enable Realtime on staff table (if it exists and not already enabled)
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'staff') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND tablename = 'staff'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE staff;
      RAISE NOTICE 'Added staff to realtime publication';
    ELSE
      RAISE NOTICE 'staff already in realtime publication';
    END IF;
  ELSE
    RAISE NOTICE 'staff table does not exist';
  END IF;
END $$;

-- Enable Realtime on backup_metadata table (if not already enabled)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'backup_metadata'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE backup_metadata;
    RAISE NOTICE 'Added backup_metadata to realtime publication';
  ELSE
    RAISE NOTICE 'backup_metadata already in realtime publication';
  END IF;
END $$;

-- Enable Realtime on seed_metadata table (if not already enabled)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'seed_metadata'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE seed_metadata;
    RAISE NOTICE 'Added seed_metadata to realtime publication';
  ELSE
    RAISE NOTICE 'seed_metadata already in realtime publication';
  END IF;
END $$;

-- Verify Realtime is enabled
SELECT 
  schemaname,
  tablename
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime'
ORDER BY schemaname, tablename;