import { Client } from 'pg';
import fs from 'fs';
import path from 'path';

const DB_URL = "postgres://postgres:Salisu0030%40%23@db.xletzabshnrwlzokqquk.supabase.co:5432/postgres";

async function run() {
    const client = new Client({ connectionString: DB_URL });
    try {
        await client.connect();
        console.log("Connected to Supabase.");

        const sqlFiles = [
            '20260804000001_initial_schema.sql',
            '20260804000002_staging_schema.sql'
        ];

        for (const file of sqlFiles) {
            const p = path.resolve(process.cwd(), 'supabase', 'migrations', file);
            if (fs.existsSync(p)) {
                console.log(`Executing ${file}...`);
                const sql = fs.readFileSync(p, 'utf8');
                await client.query(sql);
                console.log(`Successfully executed ${file}.`);
            } else {
                console.log(`Skipping ${file} - Not found.`);
            }
        }
    } catch (e) {
        console.error("SQL Error:", e);
    } finally {
        await client.end();
    }
}
run();
