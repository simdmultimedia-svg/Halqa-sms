# HALQA Supabase Setup Guide

## Project Configuration

**Project Details:**
- **Project URL:** https://hzwxnyfncpqlgbkcadkj.supabase.co
- **Project ID:** hzwxnyfncpqlgbkcadkj
- **Database:** PostgreSQL (Supabase hosted)

## Environment Variables

The following environment variables have been configured in `.env`:

```env
SUPABASE_URL=https://hzwxnyfncpqlgbkcadkj.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6d3hueWZuY3BxbGdia2NhZGtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2ODI4MTAsImV4cCI6MjEwNjI1ODgxMH0.36rU7Ua9kCUvNlI0JF1cvFOM8g0yTaMw7tMJyb4zJXQ
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6d3hueWZuY3BxbGdia2NhZGtqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDY4MjgxMCwiZXhwIjoyMTA2MjU4ODEwfQ.Kv2gn6aKcvKc66TcIO6-rf7gw1lw33bfmrcPQnGigxA
SUPABASE_PROJECT_ID=hzwxnyfncpqlgbkcadkj
DATABASE_URL=postgresql://postgres:Salisu0030@db.hzwxnyfncpqlgbkcadkj.supabase.co:5432/postgres
```

## Application Configuration

Updated files:
- ✅ `js/core/supabase.js` - Updated with new Supabase credentials
- ✅ `supabase/config.toml` - Updated project ID to HALQA project
- ✅ `.env` - Created with environment variables
- ✅ `package.json` - Updated repository references

## Database Setup Steps

### 1. Create Required Tables

Run the following SQL in your Supabase SQL Editor to create the basic tables:

```sql
-- Legacy records table for offline-first compatibility
CREATE TABLE IF NOT EXISTS legacy_records (
  id BIGSERIAL PRIMARY KEY,
  collection TEXT NOT NULL,
  record_id TEXT NOT NULL,
  payload JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(collection, record_id)
);

-- Enable RLS
ALTER TABLE legacy_records ENABLE ROW LEVEL SECURITY;

-- Create backup metadata table
CREATE TABLE IF NOT EXISTS backup_metadata (
  id BIGSERIAL PRIMARY KEY,
  backup_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT,
  record_count INTEGER,
  file_size INTEGER
);

-- Create seed metadata table
CREATE TABLE IF NOT EXISTS seed_metadata (
  id BIGSERIAL PRIMARY KEY,
  seed_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT,
  version TEXT,
  description TEXT
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_legacy_records_collection ON legacy_records(collection);
CREATE INDEX IF NOT EXISTS idx_legacy_records_updated ON legacy_records(updated_at);
CREATE INDEX IF NOT EXISTS idx_legacy_records_collection_record ON legacy_records(collection, record_id);
```

### 2. Set Up Row Level Security (RLS)

```sql
-- Allow authenticated users to read legacy records
CREATE POLICY "Allow authenticated read access on legacy_records"
  ON legacy_records FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to insert legacy records
CREATE POLICY "Allow authenticated insert on legacy_records"
  ON legacy_records FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to update legacy records
CREATE POLICY "Allow authenticated update on legacy_records"
  ON legacy_records FOR UPDATE
  TO authenticated
  USING (true);

-- Allow authenticated users to delete legacy records
CREATE POLICY "Allow authenticated delete on legacy_records"
  ON legacy_records FOR DELETE
  TO authenticated
  USING (true);

-- Similar policies for backup and seed metadata
CREATE POLICY "Allow authenticated access on backup_metadata"
  ON backup_metadata FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated access on seed_metadata"
  ON seed_metadata FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
```

### 3. Enable Realtime

In your Supabase dashboard:
1. Go to Database → Publications
2. Create a new publication or configure existing one
3. Add these tables to the publication:
   - `legacy_records`
   - `backup_metadata`
   - `seed_metadata`

**Alternative Method:**
- Go to Database → Tables
- Click on each table individually
- Enable Realtime toggle for each table

### 4. Set Up Authentication

1. Go to Authentication → Settings
2. Ensure email/password authentication is enabled
3. Add your HALQA domain to site URL if deploying:
   - Site URL: `https://your-halqa-domain.com`
   - Redirect URLs: Add your production URL

## Testing the Connection

### Test Basic Connection

Create a test file `test-supabase.js`:

```javascript
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://hzwxnyfncpqlgbkcadkj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6d3hueWZuY3BxbGdia2NhZGtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2ODI4MTAsImV4cCI6MjEwNjI1ODgxMH0.36rU7Ua9kCUvNlI0JF1cvFOM8g0yTaMw7tMJyb4zJXQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testConnection() {
  try {
    // Test basic connection
    const { data, error } = await supabase
      .from('legacy_records')
      .select('count')
      .limit(1);
    
    if (error) {
      console.error('Connection failed:', error);
      return false;
    }
    
    console.log('✅ Supabase connection successful!');
    console.log('Project:', SUPABASE_URL);
    return true;
  } catch (err) {
    console.error('Test failed:', err);
    return false;
  }
}

testConnection();
```

Run it with: `node test-supabase.js`

## HALQA-Specific Configurations

### Branding Integration

The Supabase integration now uses the HALQA branding:
- LocalStorage keys updated from `CIC KANO:` to `HALQA:`
- Device tracking uses HALQA identifiers
- Cloud mode switching respects HALQA configuration

### Data Migration (Optional)

If you have existing data from Firebase or another system:

1. Use the existing migration scripts in `supabase/scripts/`
2. Import your backup JSON files to the `legacy_records` table
3. Run the seed scripts to initialize master data

## Deployment Checklist

Before deploying to production:

- [ ] Verify Supabase connection works
- [ ] Test authentication flow
- [ ] Verify realtime subscriptions work
- [ ] Test offline-first functionality
- [ ] Verify data synchronization
- [ ] Check RLS policies are working correctly
- [ ] Test backup/restore functionality
- [ ] Verify HALQA branding appears correctly

## Troubleshooting

### Connection Issues

If you see connection errors:
1. Verify the Supabase URL and keys are correct
2. Check network connectivity
3. Ensure RLS policies allow your operations
4. Check Supabase dashboard for any service issues

### Authentication Issues

If authentication fails:
1. Verify email/password is enabled in Supabase
2. Check your JWT tokens are valid
3. Ensure user roles are properly set up
4. Verify RLS policies for user tables

### Realtime Issues

If realtime doesn't work:
1. Ensure Realtime is enabled for required tables
2. Check your websocket connection
3. Verify your Supabase project has Realtime enabled
4. Check browser console for websocket errors

## Support

For issues specific to:
- **Supabase:** Check https://supabase.com/docs
- **HALQA Application:** Review the application documentation
- **Database:** Use Supabase SQL Editor for direct database access