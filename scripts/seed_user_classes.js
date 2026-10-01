import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in environment");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const rawData = `
Pre-Basic 1A	Pre-Basic	1
Pre-Basic 1B	Pre-Basic	2
Pre-Basic 2A	Pre-Basic	3
Pre-Basic 2B	Pre-Basic	4
Pre-Basic 3	Pre-Basic	5
Basic 1	Basic	6
Basic 2	Basic	7
Basic 3	Basic	8
Basic 4	Basic	9
Basic 5	Basic	10
JSS 1	Secondary	11
JSS 2	Secondary	12
JSS 3	Secondary	13
Abubakar (RA) Class	Islamiyya	15
Umar bn Khattab (RA)	Islamiyya	16
Uthman bn Affan (RA)	Islamiyya	17
Aliyu bn Abi Dalib (RA)	Islamiyya	18
Dalhat bn Ubaidullah (RA)	Islamiyya	19
Zubayr bn Awwam (RA)	Islamiyya	20
Abdurrahman bn Awf (RA)	Islamiyya	21
Sa'ad bn Abi Waqas (RA)	Islamiyya	22
Sa'eed bn Zayd (RA)	Islamiyya	23
Abu-Ubaidah bn Al-Jarrah (RA)	Islamiyya	24
Abubakar As-Siddiq (RA)	Tahfiz	25
`;

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function seed() {
  const lines = rawData.trim().split('\n');
  const sectionsMap = new Map();
  const classesToInsert = [];
  
  let sectionOrder = 1;
  
  for (const line of lines) {
    if (!line.trim()) continue;
    const [className, sectionName, orderStr] = line.split('\t');
    
    if (!sectionsMap.has(sectionName)) {
      const sectionType = sectionName === "Islamiyya" ? "islamiyya" : (sectionName === "Tahfiz" ? "tahfiz" : "western");
      sectionsMap.set(sectionName, {
        id: slugify(sectionName),
        name: sectionName,
        type: sectionType,
        order: sectionOrder++,
        active: true
      });
    }
    
    const sectionId = sectionsMap.get(sectionName).id;
    const classId = `${sectionId}:${slugify(className)}`;
    
    classesToInsert.push({
      id: classId,
      name: className,
      section_id: sectionId,
      order: parseInt(orderStr, 10),
      active: true
    });
  }

  const sectionsToInsert = Array.from(sectionsMap.values());
  
  console.log("Inserting sections...");
  const { error: sError } = await supabase.from('sections').upsert(sectionsToInsert);
  if (sError) console.error("Sections error:", sError);
  
  console.log("Inserting classes...");
  const { error: cError } = await supabase.from('classes').upsert(classesToInsert);
  if (cError) console.error("Classes error:", cError);
  
  console.log("Seeding complete!");
}

seed().catch(console.error);
