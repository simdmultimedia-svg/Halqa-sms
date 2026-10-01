import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const supabaseUrl = "https://xletzabshnrwlzokqquk.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhsZXR6YWJzaG5yd2x6b2txcXVrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTg2MTIyOSwiZXhwIjoyMTAxNDM3MjI5fQ.WhAeKgqWlylCzItiHHvpYyplxRb5IsD-T-DhqlvWsq8";

const supabase = createClient(supabaseUrl, supabaseKey);

const backupPath = path.resolve(process.cwd(), 'supabase', 'backups', 'CIC KANO-backup-2026-08-04.json');

function stringToUuid(str) {
    if (!str) return null;
    if (str.length === 36 && str.split('-').length === 5) return str;
    const hash = crypto.createHash('md5').update(str).digest('hex');
    return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
}

function toSnakeCase(str) {
    if (str.startsWith('_')) {
        return '_' + str.slice(1).replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    }
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function convertKeysToSnakeCase(obj) {
    if (Array.isArray(obj)) {
        return obj.map(v => convertKeysToSnakeCase(v));
    } else if (obj !== null && typeof obj === 'object') {
        const newObj = {};
        for (const key of Object.keys(obj)) {
            let newKey = toSnakeCase(key);
            let val = obj[key];
            
            if (typeof val === 'string' && /^\d{13}$/.test(val)) {
                val = new Date(Number(val)).toISOString();
            } else if (typeof val === 'number' && val > 1000000000000 && val < 3000000000000) {
                val = new Date(val).toISOString();
            } else if (val && typeof val === 'object' && val._seconds !== undefined) {
                val = new Date(val._seconds * 1000).toISOString();
            }

            newObj[newKey] = convertKeysToSnakeCase(val);
        }
        return newObj;
    }
    return obj;
}

function transformRow(tableName, row) {
    if (tableName === 'user_roles') tableName = 'user_roles';
    if (tableName === 'staff_attendance') tableName = 'staff_attendance';
    if (tableName === 'family_invoices') tableName = 'family_invoices';
    if (tableName === 'result_approvals') tableName = 'result_approvals';
    if (tableName === 'settings') tableName = 'school_settings';
    if (tableName === 'results') tableName = 'exam_results';
    
    let chunkIndex = 0;
    if (tableName === 'students' || tableName === 'staff') {
        if (!row.first_name) {
            const parts = (row.full_name || 'Unknown User').split(' ');
            row.first_name = parts[0];
            row.last_name = parts.slice(1).join(' ') || 'Unknown';
        }
        if (row.gender) {
            const g = row.gender.toLowerCase();
            if (g.startsWith('f')) row.gender = 'female';
            else if (g.startsWith('m')) row.gender = 'male';
            else row.gender = null;
        } else {
            row.gender = null;
        }
    }
    
    if (tableName === 'invoices') {
        if (!row.session_id && row.session) row.session_id = stringToUuid(row.session);
        if (!row.term_id && row.term) row.term_id = stringToUuid(row.term);
        if (!row.class_id && row.class) row.class_id = stringToUuid(row.class);
        if (row.status) {
            let s = row.status.toLowerCase();
            if (s.includes('paid')) row.status = 'paid';
            else if (s.includes('overdue')) row.status = 'overdue';
            else row.status = 'pending';
        } else {
            row.status = 'pending';
        }
    }

    if (tableName === 'receipts') {
        if (row.invoice_id) row.invoice_id = stringToUuid(row.invoice_id);
        else row.invoice_id = stringToUuid('unknown_invoice');
    }

    if (tableName === 'audit_logs') {
        if (!row.action) row.action = row.type || 'unknown_action';
        if (!row.table_name) row.table_name = row.collection || 'unknown';
    }

    if (tableName === 'users') {
        if (!row.full_name) row.full_name = row.display_name || row.email || 'Unknown User';
        if (!row.created_at) row.created_at = new Date().toISOString();
    }

    if (tableName === 'user_roles') {
        if (!row.user_id) row.user_id = row.id || stringToUuid('unknown');
        if (!row.role_id) row.role_id = stringToUuid(row.role || 'user');
        if (!row.created_at) row.created_at = new Date().toISOString();
    }

    if (tableName === 'users' || tableName === 'user_roles') {
        if (row.id) row.id = stringToUuid(row.id);
        if (row.auth_id) row.auth_id = stringToUuid(row.auth_id);
        if (row.user_id) row.user_id = stringToUuid(row.user_id);
    }
    
    if (tableName === 'exam_results') {
        if (row.id) row.id = stringToUuid(row.id);
        if (row.exam_id) row.exam_id = stringToUuid(row.exam_id);
        else row.exam_id = stringToUuid('unknown_exam');
        if (row.student_id) row.student_id = stringToUuid(row.student_id);
        
        // subject -> subject_id mapping
        if (row.subject && !row.subject_id) {
            row.subject_id = stringToUuid(row.subject);
        } else if (!row.subject_id) {
            row.subject_id = stringToUuid('unknown_subject');
        }
    }
    
    if (tableName === 'school_settings') {
        if (row.id) {
            row.key = row.id;
            row.id = stringToUuid(row.id);
        }
    }
    
    if (tableName === 'payslips') {
        if (row.staff_id) row.staff_id = stringToUuid(row.staff_id);
        if (row.id) row.id = stringToUuid(row.id);
    }

    if (tableName === 'result_approvals') {
        if (row.session) row.session_id = stringToUuid(row.session);
        if (row.term) row.term_id = stringToUuid(row.term);
        if (row.id) row.id = stringToUuid(row.id);
    }
    
    if (tableName === 'staff_attendance') {
        if (row.id) row.id = stringToUuid(row.id);
    }

    // Attempt to automatically convert any fields ending in _id or just 'id' that aren't UUIDs
    for (const key in row) {
        if ((key.endsWith('_id') || key === 'id') && typeof row[key] === 'string' && row[key].length < 36) {
            row[key] = stringToUuid(row[key]);
        }
    }
    
    if (row.created_by) row.created_by = stringToUuid(row.created_by);
    
    return row;
}

async function run() {
    console.log("Starting JSON -> Supabase Migration...");

    if (!fs.existsSync(backupPath)) {
        console.error(`ERROR: JSON backup not found at ${backupPath}`);
        process.exit(1);
    }

    let backupData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

    let collectionsRoot = backupData;
    if (backupData.data && typeof backupData.data === 'object' && !backupData.data.id) {
        collectionsRoot = backupData.data;
    } else if (backupData.__collections__) {
        collectionsRoot = backupData.__collections__;
    }

    // Pre-seed dependencies (Sessions, Terms, Roles)
    const uniqueSessions = new Set();
    const uniqueTerms = new Map();
    const uniqueRoles = new Set();
    Object.values(collectionsRoot).forEach(col => {
        const rows = Array.isArray(col) ? col : Object.values(col);
        rows.forEach(r => {
            if (r.session) uniqueSessions.add(r.session);
            if (r.term && r.session) uniqueTerms.set(r.term, { name: r.term, session_id: stringToUuid(r.session) });
            if (r.role) uniqueRoles.add(r.role);
        });
    });

    console.log(`Pre-seeding ${uniqueSessions.size} sessions, ${uniqueTerms.size} terms, and ${uniqueRoles.size} roles...`);
    const sessionChunks = Array.from(uniqueSessions).map(s => ({ id: stringToUuid(s), name: s, is_current: false }));
    if (sessionChunks.length > 0) {
        const { error } = await supabase.from('academic_sessions').upsert(sessionChunks);
        if (error) console.error("Error seeding sessions:", error);
    }

    const termChunks = Array.from(uniqueTerms.values()).map(t => ({ id: stringToUuid(t.name), name: t.name, session_id: t.session_id, is_current: false }));
    if (termChunks.length > 0) {
        const { error } = await supabase.from('terms').upsert(termChunks);
        if (error) console.error("Error seeding terms:", error);
    }

    const roleChunks = Array.from(uniqueRoles).map(r => ({ id: stringToUuid(r), name: r }));
    if (roleChunks.length > 0) {
        const { error } = await supabase.from('roles').upsert(roleChunks);
        if (error) console.error("Error seeding roles:", error);
    }

    // Pre-seed unknown exam and subject to satisfy FK constraints for results
    await supabase.from('exams').upsert([{ id: stringToUuid('unknown_exam'), name: 'Unknown Exam', term_id: stringToUuid('unknown'), session_id: stringToUuid('unknown') }]);
    await supabase.from('subjects').upsert([{ id: stringToUuid('unknown_subject'), name: 'Unknown Subject', code: 'UNK' }]);

    const validColumns = {};
    const sqlFiles = ['20260804000000_initial_schema.sql', '20260804000002_staging_schema.sql', '20260804000001_phase0_missing_tables.sql'];
    for (const file of sqlFiles) {
        const p = path.resolve(process.cwd(), 'supabase', 'migrations', file);
        if (fs.existsSync(p)) {
            const sql = fs.readFileSync(p, 'utf8');
            const tableRegex = /create table\s+if not exists\s+public\.([a-z0-9_]+)\s*\(([\s\S]*?)\);/gi;
            let match;
            while ((match = tableRegex.exec(sql)) !== null) {
                const tableName = match[1];
                const colsBlock = match[2];
                const lines = colsBlock.split('\n');
                const cols = new Set();
                for (const line of lines) {
                    if (line.toLowerCase().includes('generated always')) continue;
                    const colMatch = /^\s*([a-z0-9_]+)\s+[a-z]+/i.exec(line);
                    if (colMatch) {
                        const colName = colMatch[1];
                        if (colName !== 'primary' && colName !== 'foreign' && colName !== 'unique' && colName !== 'check') {
                            cols.add(colName);
                        }
                    }
                }
                validColumns[tableName] = cols;
            }
        }
    }

    const collections = Object.keys(collectionsRoot);
    const reports = [];

    // Ensure parents are processed before children to satisfy FK constraints!
    // order: users -> userRoles -> students -> invoices -> receipts
    collections.sort((a, b) => {
        const weight = { 'users': 1, 'userRoles': 2, 'students': 3, 'invoices': 4, 'receipts': 5 };
        const wa = weight[a] || 10;
        const wb = weight[b] || 10;
        return wa - wb;
    });

    for (const colName of collections) {
        let tableName = toSnakeCase(colName);
        if (tableName === 'settings') tableName = 'school_settings';
        if (tableName === 'results') tableName = 'exam_results';
        const report = {
            collection: colName,
            table: tableName,
            firebaseCount: 0,
            supabaseCount: 0,
            missing: 0,
            failed: 0,
            status: 'OK'
        };

        const colData = collectionsRoot[colName];
        let rawRows = [];

        if (Array.isArray(colData)) {
            rawRows.push(...colData);
        } else if (typeof colData === 'object' && colData !== null) {
            for (const [key, value] of Object.entries(colData)) {
                if (typeof value === 'object') {
                    if (!value.id) value.id = key;
                    rawRows.push(value);
                }
            }
        }

        let rows = rawRows;

        // Clean Data Constraints
        if (tableName === 'exam_results') {
            const uniqueMap = new Map();
            const students = collectionsRoot['students'] || {};
            
            rows.forEach(r => {
                const studentIdStr = r.student_id || r.studentId;
                const foundStudent = Object.values(students).find(s => s.id === studentIdStr || (s.id && s.id.toString() === studentIdStr?.toString()));
                
                if (foundStudent) {
                    const key = `${r.exam_id || r.examId}_${r.student_id || r.studentId}_${r.subject || r.subject_id || r.subjectId}`;
                    uniqueMap.set(key, r); // Keep the last one encountered (effectively deduplicating)
                }
            });
            rows = Array.from(uniqueMap.values());
            console.log(`[Validation] Deduped and filtered orphaned exam_results from ${rawRows.length} to ${rows.length}`);
        }
        
        if (tableName === 'receipts') {
            const invoices = collectionsRoot['invoices'] || {};
            rows = rows.filter(r => {
                let invId = r.invoiceId || r.invoice_id;
                const found = Object.values(invoices).find(i => i.id === invId || (i.id && i.id.toString() === invId.toString()));
                return found != null;
            });
            console.log(`[Validation] Filtered orphaned receipts from ${rawRows.length} to ${rows.length}`);
        }

        report.firebaseCount = rows.length;
        if (rows.length === 0) {
            reports.push(report);
            continue;
        }

        const allowedCols = validColumns[tableName];
        rows = rows.map(r => {
            const snaked = convertKeysToSnakeCase(r);
            const transformed = transformRow(tableName, snaked);
            if (!allowedCols) return transformed; 
            const filtered = {};
            for (const k of Object.keys(transformed)) {
                if (allowedCols.has(k)) {
                    filtered[k] = transformed[k];
                }
            }
            return filtered;
        });

        console.log(`Migrating ${colName} -> ${tableName} (${rows.length} records)`);

        const CHUNK_SIZE = 500;
        
        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
            const chunk = rows.slice(i, i + CHUNK_SIZE);
            const { error } = await supabase.from(tableName).upsert(chunk);
            
            if (error) {
                console.error(`ERROR inserting chunk to ${tableName}:`, error.message);
                if (tableName === 'exam_results') console.error('Sample failing row:', chunk[0]);
                report.failed += chunk.length;
                if (error.message.includes('Could not find the table')) {
                    report.status = 'Table Missing';
                } else if (error.message.includes('foreign key constraint')) {
                    report.status = 'FK Constraint';
                } else if (error.message.includes('not-null constraint')) {
                    report.status = 'NULL Constraint';
                } else {
                    report.status = 'Upsert Error';
                }
            }
        }

        const { count, error } = await supabase.from(tableName).select('*', { count: 'exact', head: true });
        if (!error) {
            report.supabaseCount = count || 0;
            report.missing = report.firebaseCount - report.supabaseCount;
        } else {
            report.missing = report.firebaseCount; 
        }

        reports.push(report);
    }

    let md = "# JSON Data Migration Report\n\n";
    md += "| Collection | JSON Count | Supabase Count | Missing | Failed | Status |\n";
    md += "| --- | --- | --- | --- | --- | --- |\n";
    reports.forEach(r => {
        md += `| ${r.collection} | ${r.firebaseCount} | ${r.supabaseCount} | ${r.missing} | ${r.failed} | ${r.status} |\n`;
    });

    const reportPath = 'C:\\Users\\HP\\.gemini\\antigravity\\brain\\a511bf5d-6aa1-47ff-bdc7-236ad295c9e0\\migration_report.md';
    fs.writeFileSync(reportPath, md);
    console.log(`\nMigration complete! Report generated at: ${reportPath}`);
}

run();
