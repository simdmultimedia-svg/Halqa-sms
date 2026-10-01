import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

function stringToUuid(str) {
    if (!str) return null;
    if (str.length === 36 && str.split('-').length === 5) return str;
    const hash = crypto.createHash('md5').update(str).digest('hex');
    return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
}

const supabaseUrl = "https://xletzabshnrwlzokqquk.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhsZXR6YWJzaG5yd2x6b2txcXVrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTg2MTIyOSwiZXhwIjoyMTAxNDM3MjI5fQ.WhAeKgqWlylCzItiHHvpYyplxRb5IsD-T-DhqlvWsq8";
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log("Seeding unknown session, term, exam, subject...");
    let res = await supabase.from('academic_sessions').upsert([{ id: stringToUuid('unknown'), name: 'Unknown Session', is_current: false }]);
    console.log("Session:", res.error);

    res = await supabase.from('terms').upsert([{ id: stringToUuid('unknown'), name: 'Unknown Term', session_id: stringToUuid('unknown'), is_current: false }]);
    console.log("Term:", res.error);

    res = await supabase.from('exams').upsert([{ id: stringToUuid('unknown_exam'), name: 'Unknown Exam', term_id: stringToUuid('unknown'), session_id: stringToUuid('unknown') }]);
    console.log("Exam:", res.error);

    res = await supabase.from('subjects').upsert([{ id: stringToUuid('unknown_subject'), name: 'Unknown Subject', code: 'UNK' }]);
    console.log("Subject:", res.error);
}

run();
