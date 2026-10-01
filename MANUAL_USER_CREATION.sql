-- ============================================
-- MANUAL USER CREATION AND ROLE ASSIGNMENT
-- Run this SQL in your Supabase SQL Editor
-- ============================================

-- Replace these values with your actual user details
DO $$
DECLARE
  new_user_id UUID := 'YOUR_USER_ID_HERE'; -- Get this from Supabase Auth → Users
  new_user_email TEXT := 'user@example.com'; -- The user's email
  desired_role TEXT := 'Staff'; -- Options: Staff, Teacher, Admin, Accountant, Super Admin
  user_name TEXT := 'User Name'; -- The user's full name
  role_uuid UUID;
BEGIN
  -- Get the role ID
  SELECT id INTO role_uuid
  FROM roles
  WHERE name = desired_role;
  
  IF role_uuid IS NULL THEN
    RAISE EXCEPTION 'Role % not found. Available roles: Staff, Teacher, Admin, Accountant, Super Admin', desired_role;
  END IF;
  
  -- Create user profile
  INSERT INTO users (auth_id, email, full_name, is_active, role, status)
  VALUES (new_user_id, new_user_email, user_name, TRUE, desired_role, 'Active')
  ON CONFLICT (auth_id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    status = EXCLUDED.status;
    
  -- Create role assignment
  INSERT INTO user_roles (user_id, role_id, role)
  VALUES (new_user_id, role_uuid, desired_role)
  ON CONFLICT (user_id) DO UPDATE SET
    role_id = role_uuid,
    role = desired_role;
    
  RAISE NOTICE 'User % created successfully with role: %', new_user_email, desired_role;
END $$;

-- Verify the user was created
SELECT 
  u.auth_id,
  u.email,
  u.full_name,
  u.role as user_role,
  ur.role_id,
  r.name as role_name
FROM users u
LEFT JOIN user_roles ur ON u.auth_id = ur.user_id
LEFT JOIN roles r ON ur.role_id = r.id
WHERE u.auth_id = 'YOUR_USER_ID_HERE';