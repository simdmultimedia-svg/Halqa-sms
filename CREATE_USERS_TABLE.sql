-- ============================================
-- ADD MISSING USERS TABLE FOR HALQA SUPABASE
-- Run this SQL in your Supabase SQL Editor
-- ============================================

-- Create users table for user management
CREATE TABLE IF NOT EXISTS users (
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
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON users USING btree (auth_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (safe cleanup)
DROP POLICY IF EXISTS "Allow authenticated read on users" ON users;
DROP POLICY IF EXISTS "Allow authenticated insert on users" ON users;
DROP POLICY IF EXISTS "Allow authenticated update on users" ON users;
DROP POLICY IF EXISTS "Allow admin full access on users" ON users;

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

-- Create function to track record changes
CREATE OR REPLACE FUNCTION track_user_record_change()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to users
DROP TRIGGER IF EXISTS track_users_change ON users;
CREATE TRIGGER track_users_change
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION track_user_record_change();

COMMENT ON TABLE users IS 'User profiles and role management for HALQA application';

-- Create roles table (must come before user_roles for foreign key)
CREATE TABLE IF NOT EXISTS roles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  permissions JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_roles_name ON roles(name);

-- Enable Row Level Security
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (safe cleanup)
DROP POLICY IF EXISTS "Allow authenticated read on roles" ON roles;
DROP POLICY IF EXISTS "Allow admin full access on roles" ON roles;

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
DROP TRIGGER IF EXISTS track_roles_change ON roles;
CREATE TRIGGER track_roles_change
  BEFORE UPDATE ON roles
  FOR EACH ROW
  EXECUTE FUNCTION track_user_record_change();

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

-- Create user_roles table
CREATE TABLE IF NOT EXISTS user_roles (
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
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);

-- Enable Row Level Security
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (safe cleanup)
DROP POLICY IF EXISTS "Allow authenticated read on user_roles" ON user_roles;
DROP POLICY IF EXISTS "Allow authenticated insert on user_roles" ON user_roles;
DROP POLICY IF EXISTS "Allow authenticated update on user_roles" ON user_roles;
DROP POLICY IF EXISTS "Allow admin full access on user_roles" ON user_roles;

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
DROP TRIGGER IF EXISTS track_user_roles_change ON user_roles;
CREATE TRIGGER track_user_roles_change
  BEFORE UPDATE ON user_roles
  FOR EACH ROW
  EXECUTE FUNCTION track_user_record_change();

COMMENT ON TABLE user_roles IS 'User role assignments and permissions for HALQA application';

-- Create roles table
CREATE TABLE IF NOT EXISTS roles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  permissions JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_roles_name ON roles(name);

-- Enable Row Level Security
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (safe cleanup)
DROP POLICY IF EXISTS "Allow authenticated read on roles" ON roles;
DROP POLICY IF EXISTS "Allow admin full access on roles" ON roles;

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
DROP TRIGGER IF EXISTS track_roles_change ON roles;
CREATE TRIGGER track_roles_change
  BEFORE UPDATE ON roles
  FOR EACH ROW
  EXECUTE FUNCTION track_user_record_change();

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

-- Note: Users will be created automatically when they first log in via Supabase Auth
-- No manual user insertion needed - the application handles user creation