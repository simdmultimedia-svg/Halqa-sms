# Deploy Supabase Edge Function - Simple Guide

This guide will help you deploy the `create-user` Edge Function so you can create users directly from the application.

## Option 1: Manual Deployment via Supabase Dashboard (Easiest)

### Step 1: Go to Supabase Functions
1. Open: https://supabase.com/dashboard/project/hzwxnyfncpqlgbkcadkj/functions
2. Click "New Function"

### Step 2: Create the Function
1. **Function Name:** `create-user`
2. **Verify:** The name must be exactly `create-user` (lowercase, hyphen)

### Step 3: Copy the Function Code
1. Open the file: `supabase/functions/create-user/index.ts`
2. Copy all the code from that file

### Step 4: Paste and Deploy
1. Paste the code into the Supabase function editor
2. Click "Deploy"

### Step 5: Verify Deployment
- Go to the application
- Navigate to User Management
- Try creating a staff user
- The CORS error should be resolved

## Option 2: Using Supabase CLI (Advanced)

If you prefer using command line:

```bash
# Install Supabase CLI
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
cd C:\Users\HP\Downloads\HALQA
supabase link --project-ref hzwxnyfncpqlgbkcadkj

# Deploy the function
supabase functions deploy create-user
```

## After Deployment

Once the Edge Function is deployed:

1. **Go to the application** → User Management
2. **Create a staff user** directly from the app
3. **No more CORS errors**
4. **No more manual Supabase dashboard work**

## Verification

To verify the function is deployed:
1. Go to: https://supabase.com/dashboard/project/hzwxnyfncpqlgbkcadkj/functions
2. You should see `create-user` in the list
3. Status should be "Active"

## Troubleshooting

If you still get CORS errors after deployment:
1. Wait 2-3 minutes for the function to fully deploy
2. Clear your browser cache
3. Try creating a user again

If the function fails to deploy:
1. Check that you copied the entire code from `index.ts`
2. Ensure the function name is exactly `create-user`
3. Check Supabase dashboard for any deployment errors