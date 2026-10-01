# Real-Time Synchronization Setup

This guide explains how to enable real-time synchronization so that data registered on your PC appears on your phone and vice versa.

## How It Works

The application uses Supabase Realtime to synchronize data across devices:

1. **When you register a student on PC:**
   - Data is saved to Supabase database
   - Realtime push notification sent to all connected devices
   - Your phone automatically receives the update

2. **When you register a student on Phone:**
   - Data is saved to Supabase database
   - Realtime push notification sent to all connected devices
   - Your PC automatically receives the update

## Setup Steps

### Step 1: Enable Realtime on Database Tables

Run the SQL script `ENABLE_REALTIME_SYNC.sql` in Supabase SQL Editor.

This enables Realtime on:
- `users` table
- `user_roles` table
- `roles` table
- `students` table (if exists)
- `staff` table (if exists)
- `legacy_records` table

### Step 2: Deploy Updated Code

The updated code has been pushed to GitHub. Netlify will automatically deploy it.

### Step 3: Test Synchronization

1. **Open the application on your PC**
2. **Login with admin@halqa.local**
3. **Register a new student**
4. **Open the application on your phone**
5. **Login with the same credentials**
6. **The student should appear automatically**

## Verification

To verify Realtime is working:

1. **Open browser console** (F12) on both devices
2. **Look for logs like:**
   - `[REALTIME] Channel status: SUBSCRIBED`
   - `[REALTIME] Students changed: INSERT`
   - `[REALTIME] Applying normalized row to table: students`

## Troubleshooting

### Data not appearing on other device

1. **Check Realtime is enabled:**
   - Run the verification query in `ENABLE_REALTIME_SYNC.sql`
   - Ensure your tables are listed

2. **Check network connection:**
   - Both devices must be online
   - Check browser console for connection errors

3. **Check login:**
   - Both devices must be logged in
   - Use the same Supabase Auth user

4. **Manual refresh:**
   - If automatic sync fails, refresh the page
   - This triggers a full data refresh

### Console errors

If you see Realtime errors:
- Check Supabase dashboard for Realtime status
- Ensure your Supabase project has Realtime enabled
- Check that tables are published in supabase_realtime

## Technical Details

### Tables Synchronized

- **users** - User profiles and authentication
- **user_roles** - Role assignments
- **roles** - Available roles
- **students** - Student records
- **staff** - Staff records
- **legacy_records** - Legacy compatibility layer

### Sync Frequency

- **Real-time:** Changes pushed immediately via Realtime
- **Background:** Reconciliation every 2 minutes
- **Manual:** Refresh triggers full sync

### Conflict Resolution

- Uses timestamp comparison
- Remote wins if newer
- Local wins if newer or equal
- Prevents data overwrites