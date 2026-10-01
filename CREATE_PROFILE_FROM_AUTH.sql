-- ============================================
-- CREATE USER PROFILE FROM SUPABASE AUTH
-- Run this SQL in your Supabase SQL Editor
-- ============================================

-- Get your actual Auth User ID from Supabase Dashboard:
-- Authentication → Users → Click on your user → Copy the "User ID"

-- Replace YOUR_AUTH_ID_HERE with your actual User ID from Supabase Auth
-- Example: '51cf35f9-6d91-442c-b661-9d7ea7409ac2'

DO $$
DECLARE
  auth_user_id UUID := 'YOUR_AUTH_ID_HERE'; -- REPLACE THIS WITH YOUR ACTUAL AUTH ID
  role_uuid UUID;
BEGIN
  -- Get the Super Admin role ID
  SELECT id INTO role_uuid
  FROM roles
  WHERE name = 'Super Admin';
  
  -- Create user profile
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
    
  RAISE NOTICE 'Successfully created user profile for auth_id: %', auth_user_id;
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
WHERE u.auth_id = 'YOUR_AUTH_ID_HERE'; -- REPLACE THIS WITH YOUR ACTUAL AUTH ID