-- ============================================
-- FIX ADMIN ROLE TO SUPER ADMIN
-- Run this SQL in your Supabase SQL Editor
-- ============================================

-- First, check if the user exists
DO $$
DECLARE
  user_uuid UUID;
  role_uuid UUID;
BEGIN
  -- Get the user's auth_id from the users table
  SELECT auth_id INTO user_uuid
  FROM users
  WHERE email = 'admin@halqa.local';
  
  -- If user doesn't exist, try finding by any admin email
  IF user_uuid IS NULL THEN
    SELECT auth_id INTO user_uuid
    FROM users
    WHERE email LIKE '%admin%';
  END IF;
  
  -- If still null, raise an error
  IF user_uuid IS NULL THEN
    RAISE EXCEPTION 'User not found. Please check if you have created a user in Supabase Auth.';
  END IF;
  
  -- Get the Super Admin role ID
  SELECT id INTO role_uuid
  FROM roles
  WHERE name = 'Super Admin';
  
  -- Update the user's role in users table
  UPDATE users
  SET role = 'Super Admin'
  WHERE auth_id = user_uuid;
  
  -- Insert or update the role assignment
  INSERT INTO user_roles (user_id, role_id, role)
  VALUES (user_uuid, role_uuid, 'Super Admin')
  ON CONFLICT (user_id) DO UPDATE SET
    role_id = role_uuid,
    role = 'Super Admin';
    
  RAISE NOTICE 'Successfully updated user role to Super Admin for auth_id: %', user_uuid;
END $$;

-- Verify the update
SELECT 
  u.auth_id,
  u.email,
  u.role as user_role,
  ur.role_id,
  r.name as role_name
FROM users u
LEFT JOIN user_roles ur ON u.auth_id = ur.user_id
LEFT JOIN roles r ON ur.role_id = r.id
WHERE u.email LIKE '%admin%' OR u.role = 'Super Admin';