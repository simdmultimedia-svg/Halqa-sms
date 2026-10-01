import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL || "https://xletzabshnrwlzokqquk.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error("ERROR: SUPABASE_SERVICE_ROLE_KEY environment variable is required to bypass RLS.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function importData(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`Backup file not found at ${filePath}`);
    process.exit(1);
  }

  console.log(`Loading backup from ${filePath}...`);
  const rawData = fs.readFileSync(filePath, 'utf8');
  let data;
  try {
    data = JSON.parse(rawData);
  } catch (err) {
    console.error("Failed to parse JSON backup:", err.message);
    process.exit(1);
  }

  let totalImported = 0;
  
  // Some exports nest everything under __collections__ or data.__collections__
  const collectionsObj =
    data.__collections__ ||
    data.data?.__collections__ ||
    data.data ||
    data;
  
  for (const collection in collectionsObj) {
    // Skip Firebase config/metadata nodes if any
    if ((collection.startsWith('_') && collection !== '__collections__') || typeof collectionsObj[collection] !== 'object') continue;
    
    console.log(`Importing collection: ${collection}`);
    const records = collectionsObj[collection];
    
    const rows = [];
    for (const recordId in records) {
      if (typeof records[recordId] === 'object' && records[recordId] !== null) {
        rows.push({
          collection: collection,
          record_id: recordId,
          payload: records[recordId],
          updated_at: new Date().toISOString()
        });
      }
    }
    
    if (rows.length > 0) {
      // Chunk up inserts if large
      const chunkSize = 1000;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error } = await supabase.from('legacy_records').upsert(chunk);
        if (error) {
          console.error(`Error inserting chunk for ${collection}:`, error.message);
        } else {
          totalImported += chunk.length;
          console.log(`  Inserted ${chunk.length} records for ${collection} (Total: ${totalImported})`);
        }
      }
    }
  }

  console.log(`\nImport complete! Migrated ${totalImported} records to legacy_records.`);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log("Usage: node import_firebase_to_legacy.js <path_to_firebase_backup.json>");
  process.exit(1);
}

importData(path.resolve(args[0]));
