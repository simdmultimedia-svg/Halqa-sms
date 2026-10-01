-- ============================================
-- CREATE SUPER ADMIN PROFILE FOR YOUR USER
-- Run this SQL in your Supabase SQL Editor
-- ============================================

DO $$
DECLARE
  auth_user_id UUID := '763cfcf6-fa74-4018-8d8b-7a74666cbafc';
  role_uuid UUID;
BEGIN
  -- Get the Super Admin role ID
  SELECT id INTO role_uuid
  FROM roles
  WHERE name = 'Super Admin';
  
  -- Create user profile with Super Admin role directly
  INSERT INTO users (auth_id, email, full_name, is_active, role, status)
  VALUES (auth_user_id, 'admin@halqa.local', 'Super Admin', TRUE, 'Super Admin', 'Active')
  ON CONFLICT (auth_id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    is_active = EXCLUDED.is_active,
    role = EXCLUDED.role,
    status = EXCLUDED.status;
    
  -- Create role assignment
  INSERT INTO user_roles (user_id, role_id, role)
  VALUES (auth_user_id, role_uuid, 'Super Admin')
  ON CONFLICT (user_id) DO UPDATE SET
    role_id = role_uuid,
    role = 'Super Admin';
    
  RAISE NOTICE 'Successfully created Super Admin profile for auth_id: %', auth_user_id;
END $$;

-- Verify the creation
SELECT 
  u.auth_id,
  u.email,
  u.role as user_role,
  ur.role_id,
  r.name as role_name
FROM users u
LEFT JOIN user_roles ur ON u.auth_id = ur.user_id
LEFT JOIN roles r ON ur.role_id = r.id
WHERE u.auth_id = '763cfcf6-fa74-4018-8d8b-7a74666cbafc';