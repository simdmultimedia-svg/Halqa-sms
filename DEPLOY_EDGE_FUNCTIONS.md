# Deploy Supabase Edge Functions

The user creation feature requires Supabase Edge Functions to be deployed. The `create-user` function needs to be deployed to enable Super Admin to create staff users.

## Prerequisites

1. Install Supabase CLI
   ```bash
   npm install -g supabase
   ```

2. Login to Supabase
   ```bash
   supabase login
   ```

3. Link to your project
   ```bash
   cd C:\Users\HP\Downloads\HALQA
   supabase link --project-ref hzwxnyfncpqlgbkcadkj
   ```

## Deploy the create-user Function

```bash
cd C:\Users\HP\Downloads\HALQA
supabase functions deploy create-user
```

## Alternative: Manual Deployment via Supabase Dashboard

1. Go to https://supabase.com/dashboard/project/hzwxnyfncpqlgbkcadkj/functions
2. Click "New Function"
3. Name it: `create-user`
4. Copy the contents of `supabase/functions/create-user/index.ts`
5. Paste it into the function editor
6. Click "Deploy"

## Temporary Workaround

Until the Edge Function is deployed, you can create users manually:

### Step 1: Create User in Supabase Auth
1. Go to Supabase Dashboard → Authentication → Users
2. Click "Add User"
3. Enter email and password
4. Copy the User ID (UUID) from the created user

### Step 2: Assign Role Using SQL
Run the script in `MANUAL_USER_CREATION.sql` and replace:
- `YOUR_USER_ID_HERE` with the User ID from step 1
- `user@example.com` with the user's email
- `User Name` with the user's full name
- `Staff` with the desired role

Available roles: Staff, Teacher, Admin, Accountant, Super Admin

## Verify Deployment

After deploying, test the function by creating a user in the application. The CORS error should be resolved.