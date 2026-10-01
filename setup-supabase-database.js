// Test and Setup Script for HALQA Supabase Database
// Run this with: node setup-supabase-database.js

const SUPABASE_URL = 'https://hzwxnyfncpqlgbkcadkj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6d3hueWZuY3BxbGdia2NhZGtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2ODI4MTAsImV4cCI6MjEwNjI1ODgxMH0.36rU7Ua9kCUvNlI0JF1cvFOM8g0yTaMw7tMJyb4zJXQ';

console.log('🔧 HALQA Supabase Database Setup Script');
console.log('========================================\n');

// Load Supabase client for Node.js
let supabase;
try {
  const { createClient } = await import('@supabase/supabase-js');
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('✅ Supabase client loaded successfully\n');
} catch (err) {
  console.error('❌ Failed to load Supabase client:', err.message);
  console.log('⚠️  Make sure you have @supabase/supabase-js installed:');
  console.log('   npm install @supabase/supabase-js\n');
  process.exit(1);
}

async function testConnection() {
  console.log('📡 Testing Supabase connection...');
  console.log(`   URL: ${SUPABASE_URL}`);
  console.log(`   Project ID: hzwxnyfncpqlgbkcadkj\n`);

  try {
    // Test basic connection by checking legacy_records table
    const { data, error } = await supabase
      .from('legacy_records')
      .select('count')
      .limit(1);

    if (error) {
      console.error('❌ Connection failed:', error.message);
      console.error('   This might mean:');
      console.error('   1. The tables don\'t exist yet (run the SQL setup)');
      console.error('   2. RLS policies are blocking access');
      console.error('   3. Network connectivity issues');
      return false;
    }

    console.log('✅ Supabase connection successful!');
    console.log('   Tables are accessible and ready.\n');
    return true;
  } catch (err) {
    console.error('❌ Test failed:', err.message);
    return false;
  }
}

async function checkTables() {
  console.log('🔍 Checking if required tables exist...\n');

  try {
    const tables = ['legacy_records', 'backup_metadata', 'seed_metadata', 'halqa_settings'];
    const results = {};

    for (const table of tables) {
      try {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .limit(1);

        if (error) {
          results[table] = '❌ Not found or no access';
        } else {
          results[table] = '✅ Found and accessible';
        }
      } catch (err) {
        results[table] = '❌ Error checking';
      }
    }

    console.log('Table Status:');
    for (const [table, status] of Object.entries(results)) {
      console.log(`   ${table.padEnd(20)} ${status}`);
    }
    console.log();

    return results;
  } catch (err) {
    console.error('❌ Table check failed:', err.message);
    return null;
  }
}

async function testRealtime() {
  console.log('🔄 Testing Realtime subscription...\n');

  try {
    const channel = supabase
      .channel('test-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'legacy_records' }, (payload) => {
        console.log('📡 Realtime event received:', payload);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('✅ Realtime subscription successful!');
          console.log('   Realtime is working for legacy_records table.\n');
        } else if (status === 'CLOSED') {
          console.log('ℹ️  Realtime connection closed');
        } else {
          console.log(`⚠️  Realtime status: ${status}`);
        }
      });

    // Wait a moment for connection
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Clean up
    await supabase.removeChannel(channel);

    return true;
  } catch (err) {
    console.error('❌ Realtime test failed:', err.message);
    console.log('   Note: Realtime might need to be enabled in Supabase Dashboard\n');
    return false;
  }
}

async function insertTestData() {
  console.log('🧪 Testing data insertion...\n');

  try {
    // Test inserting a simple record
    const testRecord = {
      collection: 'test',
      record_id: 'test_' + Date.now(),
      payload: { message: 'HALQA test record', timestamp: new Date().toISOString() }
    };

    const { data, error } = await supabase
      .from('legacy_records')
      .insert(testRecord)
      .select();

    if (error) {
      console.error('❌ Insert test failed:', error.message);
      return false;
    }

    console.log('✅ Data insertion successful!');
    console.log('   Test record inserted with ID:', data[0].id);

    // Clean up test record
    await supabase
      .from('legacy_records')
      .delete()
      .eq('id', data[0].id);

    console.log('   Test record cleaned up.\n');
    return true;
  } catch (err) {
    console.error('❌ Insert test failed:', err.message);
    return false;
  }
}

async function main() {
  console.log('Starting HALQA Supabase setup verification...\n');

  // Step 1: Test connection
  const connectionOk = await testConnection();
  if (!connectionOk) {
    console.log('\n⚠️  Please run the SQL setup script in Supabase Dashboard first:');
    console.log('   File: supabase/migrations/20260929000000_halqa_initial_setup.sql\n');
    return;
  }

  // Step 2: Check tables
  const tableResults = await checkTables();

  // Step 3: Test data operations
  await insertTestData();

  // Step 4: Test realtime
  await testRealtime();

  console.log('========================================');
  console.log('✅ HALQA Supabase setup verification complete!');
  console.log('\nNext steps:');
  console.log('1. Enable Realtime in Supabase Dashboard for the required tables');
  console.log('2. Configure authentication in Supabase Dashboard');
  console.log('3. Test the application in cloud mode');
  console.log('4. Verify data synchronization works correctly\n');
}

// Run the main function
main().catch(console.error);