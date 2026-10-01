-- HALQA Initial Database Setup
-- This migration sets up the core tables and configurations for the HALQA School Management System

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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

-- Backup metadata table
CREATE TABLE IF NOT EXISTS backup_metadata (
  id BIGSERIAL PRIMARY KEY,
  backup_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT,
  record_count INTEGER DEFAULT 0,
  file_size INTEGER DEFAULT 0,
  description TEXT,
  backup_type TEXT DEFAULT 'full',
  version TEXT DEFAULT '1.0.0'
);

-- Indexes for backup_metadata
CREATE INDEX IF NOT EXISTS idx_backup_metadata_created ON backup_metadata(created_at);
CREATE INDEX IF NOT EXISTS idx_backup_metadata_created_by ON backup_metadata(created_by);

-- Enable RLS for backup_metadata
ALTER TABLE backup_metadata ENABLE ROW LEVEL SECURITY;

-- RLS Policies for backup_metadata
CREATE POLICY "Allow authenticated access on backup_metadata"
  ON backup_metadata FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Seed metadata table
CREATE TABLE IF NOT EXISTS seed_metadata (
  id BIGSERIAL PRIMARY KEY,
  seed_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT,
  version TEXT,
  description TEXT,
  seed_type TEXT DEFAULT 'initial',
  status TEXT DEFAULT 'active'
);

-- Indexes for seed_metadata
CREATE INDEX IF NOT EXISTS idx_seed_metadata_created ON seed_metadata(created_at);
CREATE INDEX IF NOT EXISTS idx_seed_metadata_type ON seed_metadata(seed_type);

-- Enable RLS for seed_metadata
ALTER TABLE seed_metadata ENABLE ROW LEVEL SECURITY;

-- RLS Policies for seed_metadata
CREATE POLICY "Allow authenticated access on seed_metadata"
  ON seed_metadata FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- HALQA-specific settings table (optional, for future use)
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

-- Insert default HALQA settings
INSERT INTO halqa_settings (setting_key, setting_value, description, updated_by) 
VALUES 
  ('school_name', '"Halqatu Zaid bin Sabit Kano"', 'Official school name', 'system'),
  ('school_name_arabic', '"حلقة زيد بن ثابت لتحفيظ القرآن والدراسات الإسلامية كانو"', 'School name in Arabic', 'system'),
  ('short_name', '"HALQA"', 'Short application name', 'system'),
  ('official_name', '"Halqatu Zaid bin Sabit Tahfizul Qur\'an waddarasatul Islamiyya Kano"', 'Full official name', 'system'),
  ('motto', '"The Splendour of a Better Tomorrow"', 'School motto', 'system'),
  ('version', '"1.0.0"', 'Application version', 'system')
ON CONFLICT (setting_key) DO NOTHING;

-- Create a function to track record changes
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
DROP TRIGGER IF EXISTS track_backup_metadata_change ON backup_metadata;
CREATE TRIGGER track_backup_metadata_change
  BEFORE UPDATE ON backup_metadata
  FOR EACH ROW
  EXECUTE FUNCTION track_record_change();

-- Add trigger to seed_metadata
DROP TRIGGER IF EXISTS track_seed_metadata_change ON seed_metadata;
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

COMMENT ON TABLE legacy_records IS 'Stores legacy data records for offline-first synchronization';
COMMENT ON TABLE backup_metadata IS 'Metadata for backup files and restore operations';
COMMENT ON TABLE seed_metadata IS 'Metadata for seed data and initial data loading';
COMMENT ON TABLE halqa_settings IS 'HALQA-specific application settings and configuration';