-- ============================================
-- CHECK CURRENT USERS IN DATABASE
-- Run this SQL in your Supabase SQL Editor
-- ============================================

-- Check if users table exists and has any records
SELECT 'Users table count:' as info, COUNT(*) as count FROM users;

-- Show all users if any exist
SELECT * FROM users;

-- Check if roles exist
SELECT 'Roles table count:' as info, COUNT(*) as count FROM roles;

-- Show all roles
SELECT * FROM roles;

-- Check if user_roles exist
SELECT 'User_roles table count:' as info, COUNT(*) as count FROM user_roles;

-- Show all user_roles
SELECT * FROM user_roles;