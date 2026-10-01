-- ============================================
-- CREATE USER PROFILE FOR EXISTING AUTH USER
-- Run this SQL in your Supabase SQL Editor
-- ============================================

-- Insert user profile for the authenticated user
-- Replace '51cf35f9-6d91-442c-b661-9d7ea7409ac2' with the actual auth_id from your Supabase Auth user
-- You can find this in Supabase Dashboard → Authentication → Users

INSERT INTO users (
  auth_id,
  email,
  full_name,
  is_active,
  role,
  status
) VALUES (
  '51cf35f9-6d91-442c-b661-9d7ea7409ac2', -- Your actual auth_id from Supabase Auth
  'admin@halqa.local',
  'Super Admin',
  TRUE,
  'Super Admin',
  'Active'
) ON CONFLICT (auth_id) DO UPDATE SET
  email = EXCLUDED.email,
  full_name = EXCLUDED.full_name,
  is_active = EXCLUDED.is_active,
  role = EXCLUDED.role,
  status = EXCLUDED.status;

-- Insert corresponding role assignment
INSERT INTO user_roles (
  user_id,
  role_id,
  role
) VALUES (
  (SELECT auth_id FROM users WHERE auth_id = '51cf35f9-6d91-442c-b661-9d7ea7409ac2'),
  (SELECT id FROM roles WHERE name = 'Super Admin'),
  'Super Admin'
) ON CONFLICT (user_id) DO UPDATE SET
  role_id = EXCLUDED.role_id,
  role = EXCLUDED.role;

-- Verify the user was created
SELECT 
  u.auth_id,
  u.email,
  u.full_name,
  u.is_active,
  u.role,
  u.status,
  ur.role_id,
  r.name as role_name
FROM users u
LEFT JOIN user_roles ur ON u.auth_id = ur.user_id
LEFT JOIN roles r ON ur.role_id = r.id
WHERE u.auth_id = '51cf35f9-6d91-442c-b661-9d7ea7409ac2';