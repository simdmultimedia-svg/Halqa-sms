# 🚀 HALQA Supabase Setup Instructions

## 📋 What I've Done For You

I've created all the necessary files to set up your HALQA project on Supabase:

### ✅ Files Created:
1. **`QUICK_SETUP_SQL.sql`** - Complete SQL script to run in Supabase
2. **`supabase/migrations/20260929000000_halqa_initial_setup.sql`** - Migration file
3. **`setup-supabase-database.js`** - Test script to verify connection
4. **`SUPABASE_SETUP.md`** - Complete documentation
5. **`.env`** - Environment variables with your credentials
6. **Updated configuration files** - Supabase client and CLI config

## 🔧 What You Need To Do (3 Simple Steps)

### Step 1: Run the SQL Script in Supabase Dashboard

1. Go to your Supabase Dashboard: https://supabase.com/dashboard/project/hzwxnyfncpqlgbkcadkj
2. Click on **SQL Editor** in the left sidebar
3. Copy the contents of `QUICK_SETUP_SQL.sql` 
4. Paste it into the SQL Editor
5. Click **Run** (or press Ctrl+Enter)

This will create:
- ✅ `legacy_records` table (for data sync)
- ✅ `backup_metadata` table (for backups)
- ✅ `seed_metadata` table (for initial data)
- ✅ `halqa_settings` table (for HALQA configuration)
- ✅ All required indexes and RLS policies
- ✅ Default HALQA settings with Arabic name

### Step 2: Enable Realtime in Supabase Dashboard

1. In Supabase Dashboard, go to **Database** → **Publications**
2. Click **New Publication** or look for Realtime settings
3. Select these tables to enable Realtime:
   - ✅ `legacy_records`
   - ✅ `backup_metadata`
   - ✅ `seed_metadata`
4. Click **Save**

**Alternative Method:**
- Go to **Database** → **Tables**
- Click on each table and look for **Realtime** toggle
- Enable Realtime for: `legacy_records`, `backup_metadata`, `seed_metadata`

### Step 3: Enable Authentication

1. In Supabase Dashboard, go to **Authentication** → **Settings**
2. Ensure **Email/Password** is enabled
3. (Optional) Add your domain to **Site URL** if deploying

## 🧪 Test the Connection

After completing the steps above, test the connection:

```bash
# In your project directory
node setup-supabase-database.js
```

This will verify:
- ✅ Supabase connection works
- ✅ All tables are accessible
- ✅ Data insertion works
- ✅ Realtime subscription works

## 🎯 Ready to Use

Once you complete these 3 steps, your HALQA application will be ready to use Supabase in cloud mode!

### What Will Work:
- ✅ Cloud mode authentication
- ✅ Real-time data synchronization
- ✅ Offline-first functionality
- ✅ Backup and restore features
- ✅ HALQA branding throughout

### Local Mode Still Works:
- ✅ The application will still work in local mode even without Supabase
- ✅ Users can switch between local and cloud modes on the login screen

## 📝 Quick Reference

**Your Supabase Details:**
- **Project URL:** https://hzwxnyfncpqlgbkcadkj.supabase.co
- **Project ID:** hzwxnyfncpqlgbkcadkj
- **Database:** PostgreSQL

**Files Updated:**
- `js/core/supabase.js` - New credentials
- `supabase/config.toml` - New project ID
- `.env` - Environment variables
- `package.json` - HALQA branding

## 🔐 Security Notes

- ⚠️ **Never commit `.env` file to GitHub** (it's already in `.gitignore`)
- ⚠️ **Service role key** is for admin operations only
- ⚠️ **Anon key** is safe for client-side use
- ✅ **RLS policies** protect your data properly

## 🆘 Troubleshooting

If you encounter issues:

1. **Connection fails:**
   - Verify the SQL script ran successfully
   - Check RLS policies are enabled
   - Ensure your network can reach Supabase

2. **Realtime doesn't work:**
   - Ensure Realtime is enabled in Supabase Dashboard
   - Check browser console for websocket errors
   - Verify the tables are selected for Realtime

3. **Authentication fails:**
   - Ensure email/password is enabled in Supabase
   - Check your JWT tokens are valid
   - Verify user roles are properly configured

---

**Need Help?** Check `SUPABASE_SETUP.md` for detailed documentation!