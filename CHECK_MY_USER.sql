-- ============================================
-- CHECK YOUR USER'S ACTUAL ROLE IN DATABASE
-- Run this SQL in your Supabase SQL Editor
-- ============================================

-- Check your user's data
SELECT 
  u.auth_id,
  u.email,
  u.full_name,
  u.role as user_role_column,
  u.is_active,
  ur.role as user_roles_table_role,
  r.name as role_name_from_relationship
FROM users u
LEFT JOIN user_roles ur ON u.auth_id = ur.user_id
LEFT JOIN roles r ON ur.role_id = r.id
WHERE u.auth_id = '763cfcf6-fa74-4018-8d8b-7a74666cbafc';