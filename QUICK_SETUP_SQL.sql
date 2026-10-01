-- ============================================
-- HALQA SUPABASE DATABASE QUICK SETUP (SAFE VERSION)
-- Run this SQL in your Supabase SQL Editor
-- https://supabase.com/dashboard/project/hzwxnyfncpqlgbkcadkj/sql
-- ============================================

-- Step 1: Create Core Tables
-- ============================================

-- Legacy records table for offline-first compatibility
CREATE TABLE IF NOT EXISTS legacy_records (
  id BIGSERIAL PRIMARY KEY,
  collection TEXT NOT NULL,
  record_id TEXT NOT NULL,
  payload JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(collection, record_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_legacy_records_collection ON legacy_records(collection);
CREATE INDEX IF NOT EXISTS idx_legacy_records_updated ON legacy_records(updated_at);
CREATE INDEX IF NOT EXISTS idx_legacy_records_collection_record ON legacy_records(collection, record_id);
CREATE INDEX IF NOT EXISTS idx_legacy_records_created ON legacy_records(created_at);

-- Enable Row Level Security
ALTER TABLE legacy_records ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (safe cleanup)
DROP POLICY IF EXISTS "Allow authenticated read access on legacy_records" ON legacy_records;
DROP POLICY IF EXISTS "Allow authenticated insert on legacy_records" ON legacy_records;
DROP POLICY IF EXISTS "Allow authenticated update on legacy_records" ON legacy_records;
DROP POLICY IF EXISTS "Allow authenticated delete on legacy_records" ON legacy_records;

-- RLS Policies for legacy_records
CREATE POLICY "Allow authenticated read access on legacy_records"
  ON legacy_records FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated insert on legacy_records"
  ON legacy_records FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update on legacy_records"
  ON legacy_records FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated delete on legacy_records"
  ON legacy_records FOR DELETE
  TO authenticated
  USING (true);

-- Step 2: Create Backup Metadata Table
-- ============================================

DROP TABLE IF EXISTS backup_metadata CASCADE;

CREATE TABLE backup_metadata (
  id BIGSERIAL PRIMARY KEY,
  backup_id TEXT NOT NULL UNIQUE,
  school_id TEXT DEFAULT 'default',
  backup_version TEXT DEFAULT '1.0.0',
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT,
  record_count INTEGER DEFAULT 0,
  file_size INTEGER DEFAULT 0,
  description TEXT,
  backup_type TEXT DEFAULT 'full',
  version TEXT DEFAULT '1.0.0'
);

-- Indexes for backup_metadata
CREATE INDEX idx_backup_metadata_created ON backup_metadata(created_at);
CREATE INDEX idx_backup_metadata_created_by ON backup_metadata(created_by);
CREATE INDEX idx_backup_metadata_school_id ON backup_metadata(school_id);
CREATE INDEX idx_backup_metadata_status ON backup_metadata(status);
CREATE INDEX idx_backup_metadata_backup_version ON backup_metadata(backup_version);

-- Enable RLS for backup_metadata
ALTER TABLE backup_metadata ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (safe cleanup)
DROP POLICY IF EXISTS "Allow authenticated access on backup_metadata" ON backup_metadata;

-- RLS Policies for backup_metadata
CREATE POLICY "Allow authenticated access on backup_metadata"
  ON backup_metadata FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Step 3: Create Seed Metadata Table
-- ============================================

DROP TABLE IF EXISTS seed_metadata CASCADE;

CREATE TABLE seed_metadata (
  id BIGSERIAL PRIMARY KEY,
  seed_id TEXT NOT NULL UNIQUE,
  school_id TEXT DEFAULT 'default',
  seed_version TEXT DEFAULT '1.0.0',
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT,
  version TEXT,
  description TEXT,
  seed_type TEXT DEFAULT 'initial'
);

-- Indexes for seed_metadata
CREATE INDEX idx_seed_metadata_created ON seed_metadata(created_at);
CREATE INDEX idx_seed_metadata_type ON seed_metadata(seed_type);
CREATE INDEX idx_seed_metadata_school_id ON seed_metadata(school_id);
CREATE INDEX idx_seed_metadata_status ON seed_metadata(status);
CREATE INDEX idx_seed_metadata_seed_version ON seed_metadata(seed_version);

-- Enable RLS for seed_metadata
ALTER TABLE seed_metadata ENABLE ROW LEVEL SECURITY;

-- RLS Policies for seed_metadata
CREATE POLICY "Allow authenticated access on seed_metadata"
  ON seed_metadata FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Step 4: Create HALQA Settings Table
-- ============================================

CREATE TABLE IF NOT EXISTS halqa_settings (
  id BIGSERIAL PRIMARY KEY,
  setting_key TEXT NOT NULL UNIQUE,
  setting_value JSONB,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

-- Enable RLS for halqa_settings
ALTER TABLE halqa_settings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (safe cleanup)
DROP POLICY IF EXISTS "Allow authenticated read on halqa_settings" ON halqa_settings;
DROP POLICY IF EXISTS "Allow authenticated write on halqa_settings" ON halqa_settings;
DROP POLICY IF EXISTS "Allow authenticated update on halqa_settings" ON halqa_settings;

-- RLS Policies for halqa_settings
CREATE POLICY "Allow authenticated read on halqa_settings"
  ON halqa_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated write on halqa_settings"
  ON halqa_settings FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update on halqa_settings"
  ON halqa_settings FOR UPDATE
  TO authenticated
  USING (true);

-- Step 5: Create Users Table
-- ============================================

-- First, drop existing tables in correct order (reverse dependency)
DROP TABLE IF EXISTS user_roles CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_id UUID NOT NULL UNIQUE, -- Supabase Auth UID (UUID type) - renamed to match app expectations
  email TEXT NOT NULL UNIQUE,
  full_name TEXT, -- renamed to match app expectations
  is_active BOOLEAN DEFAULT TRUE, -- renamed to match app expectations
  role TEXT DEFAULT 'Staff',
  status TEXT DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ,
  login_disabled BOOLEAN DEFAULT FALSE,
  force_password_change BOOLEAN DEFAULT FALSE
);

-- Create indexes for performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_auth_id ON users USING btree (auth_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_status ON users(status);

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- RLS Policies for users
CREATE POLICY "Allow authenticated read on users"
  ON users FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow users to insert their own profile"
  ON users FOR INSERT
  TO authenticated
  WITH CHECK (auth_id = auth.uid());

CREATE POLICY "Allow users to update their own profile"
  ON users FOR UPDATE
  TO authenticated
  USING (auth_id = auth.uid())
  WITH CHECK (auth_id = auth.uid());

CREATE POLICY "Allow admin full access on users"
  ON users FOR ALL
  TO authenticated
  USING (
    auth_id = auth.uid() AND role = 'Super Admin'
  );

-- Add trigger to users
CREATE TRIGGER track_users_change
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION track_record_change();

COMMENT ON TABLE users IS 'User profiles and role management for HALQA application';

-- Step 6: Create Roles Table (must come before user_roles for foreign key)
-- ============================================

CREATE TABLE roles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  permissions JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_roles_name ON roles(name);

-- Enable Row Level Security
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

-- RLS Policies for roles
CREATE POLICY "Allow authenticated read on roles"
  ON roles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated to insert default roles"
  ON roles FOR INSERT
  TO authenticated
  WITH CHECK (name IN ('Super Admin', 'Admin', 'Accountant', 'Staff', 'Teacher'));

CREATE POLICY "Allow admin full access on roles"
  ON roles FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.auth_id = auth.uid() AND users.role = 'Super Admin'
    )
  );

-- Add trigger to roles
CREATE TRIGGER track_roles_change
  BEFORE UPDATE ON roles
  FOR EACH ROW
  EXECUTE FUNCTION track_record_change();

-- Insert default roles
INSERT INTO roles (name, description) 
VALUES 
  ('Super Admin', 'Full system access'),
  ('Admin', 'Administrative access'),
  ('Accountant', 'Financial access'),
  ('Staff', 'Standard staff access'),
  ('Teacher', 'Teaching staff access')
ON CONFLICT (name) DO NOTHING;

COMMENT ON TABLE roles IS 'Available roles for HALQA application';

-- Step 7: Create User Roles Table
-- ============================================

CREATE TABLE user_roles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(auth_id) ON DELETE CASCADE,
  role_id UUID REFERENCES roles(id) ON DELETE SET NULL, -- Foreign key to roles table
  role TEXT NOT NULL DEFAULT 'Staff',
  permissions JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Create indexes for performance
CREATE INDEX idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX idx_user_roles_role ON user_roles(role);

-- Enable Row Level Security
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_roles
CREATE POLICY "Allow authenticated read on user_roles"
  ON user_roles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow users to insert their own role assignment"
  ON user_roles FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Allow users to update their own role assignment"
  ON user_roles FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Allow admin full access on user_roles"
  ON user_roles FOR ALL
  TO authenticated
  USING (
    user_id IN (
      SELECT auth_id FROM users 
      WHERE role = 'Super Admin'
    )
  );

-- Add trigger to user_roles
CREATE TRIGGER track_user_roles_change
  BEFORE UPDATE ON user_roles
  FOR EACH ROW
  EXECUTE FUNCTION track_record_change();

COMMENT ON TABLE user_roles IS 'User role assignments and permissions for HALQA application';

-- Step 8: Insert Default HALQA Settings
-- ============================================

INSERT INTO halqa_settings (setting_key, setting_value, description, updated_by) 
VALUES 
  ('school_name', '"Halqatu Zaid bin Sabit Kano"', 'Official school name', 'system'),
  ('school_name_arabic', '"حلقة زيد بن ثابت لتحفيظ القرآن والدراسات الإسلامية كانو"', 'School name in Arabic', 'system'),
  ('short_name', '"HALQA"', 'Short application name', 'system'),
  ('official_name', '"Halqatu Zaid bin Sabit Tahfizul Qur''an waddarasatul Islamiyya Kano"', 'Full official name', 'system'),
  ('motto', '"The Splendour of a Better Tomorrow"', 'School motto', 'system'),
  ('version', '"1.0.0"', 'Application version', 'system')
ON CONFLICT (setting_key) DO NOTHING;

-- Step 6: Create Update Triggers
-- ============================================

-- Function to track record changes
CREATE OR REPLACE FUNCTION track_record_change()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to legacy_records
DROP TRIGGER IF EXISTS track_legacy_record_change ON legacy_records;
CREATE TRIGGER track_legacy_record_change
  BEFORE UPDATE ON legacy_records
  FOR EACH ROW
  EXECUTE FUNCTION track_record_change();

-- Add trigger to backup_metadata
CREATE TRIGGER track_backup_metadata_change
  BEFORE UPDATE ON backup_metadata
  FOR EACH ROW
  EXECUTE FUNCTION track_record_change();

-- Add trigger to seed_metadata
CREATE TRIGGER track_seed_metadata_change
  BEFORE UPDATE ON seed_metadata
  FOR EACH ROW
  EXECUTE FUNCTION track_record_change();

-- Add trigger to halqa_settings
DROP TRIGGER IF EXISTS track_halqa_settings_change ON halqa_settings;
CREATE TRIGGER track_halqa_settings_change
  BEFORE UPDATE ON halqa_settings
  FOR EACH ROW
  EXECUTE FUNCTION track_record_change();

-- Step 7: Add Table Comments
-- ============================================

COMMENT ON TABLE legacy_records IS 'Stores legacy data records for offline-first synchronization';
COMMENT ON TABLE backup_metadata IS 'Metadata for backup files and restore operations';
COMMENT ON TABLE seed_metadata IS 'Metadata for seed data and initial data loading';
COMMENT ON TABLE halqa_settings IS 'HALQA-specific application settings and configuration';

-- ============================================
-- SETUP COMPLETE
-- ============================================

-- Next Steps:
-- 1. Enable Realtime in Supabase Dashboard:
--    - Go to Database → Publications
--    - Add these tables to a publication: legacy_records, backup_metadata, seed_metadata
--    - OR go to Database → Tables and enable Realtime toggle for each table
--
-- 2. Enable Authentication in Supabase Dashboard
--
-- 3. Test the connection using: node setup-supabase-database.js
--
-- 4. Verify HALQA branding appears correctly in the application