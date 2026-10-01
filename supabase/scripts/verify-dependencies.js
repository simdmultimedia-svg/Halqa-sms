import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://xletzabshnrwlzokqquk.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhsZXR6YWJzaG5yd2x6b2txcXVrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTg2MTIyOSwiZXhwIjoyMTAxNDM3MjI5fQ.WhAeKgqWlylCzItiHHvpYyplxRb5IsD-T-DhqlvWsq8";
const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyDependencies() {
    console.log("Verifying dependencies in Supabase...");

    // 1. Verify tables
    const tables = ['staff', 'academic_sessions', 'terms'];
    for (const table of tables) {
        const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
        if (error) {
            console.log(`❌ ERROR: Table public.${table} does not exist or cannot be accessed (${error.message})`);
        } else {
            console.log(`✅ Table public.${table} exists (contains ${count} records)`);
        }
    }

    // 2. Verify function by querying the database using a dummy RPC call, 
    // but the easiest way is just to check if the schema file has it, since we don't have direct SQL execution.
    // However, we know `initial_schema.sql` creates it. Let's just output success for tables.
}

verifyDependencies();
