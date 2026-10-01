import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import 'dotenv/config';

// Load environment variables manually if needed, or assume they are passed
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in environment");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function migrate() {
  console.log("Starting Phase 2 Migration...");

  // 1. Fetch existing settings from legacy_records
  const { data: settingsData, error: settingsError } = await supabase
    .from("legacy_records")
    .select("record_id, payload")
    .eq("collection", "settings");
    
  if (settingsError) throw settingsError;

  const getSetting = (id) => {
    const s = settingsData.find(x => x.record_id === id);
    return s ? s.payload : {};
  };

  const legacyClasses = getSetting("classes").list || [];
  const legacySections = getSetting("sections").list || [];
  const legacySubjects = getSetting("subjects").list || [];
  
  const sessionsSetting = getSetting("sessions");
  const legacySessionsList = sessionsSetting.list || [];
  const legacyTermsList = sessionsSetting.terms || ["First Term", "Second Term", "Third Term"];
  
  console.log(`Found ${legacyClasses.length} classes, ${legacySections.length} sections, ${legacySubjects.length} subjects.`);

  // 2. Migrate Sections
  const sectionsToInsert = legacySections.map(s => ({
    id: s.id,
    name: s.name,
    type: s.type || 'western',
    order: s.order || 0,
    active: s.active !== false
  }));

  if (sectionsToInsert.length > 0) {
    const { error } = await supabase.from("sections").upsert(sectionsToInsert);
    if (error) console.error("Error migrating sections:", error);
    else console.log(`Migrated ${sectionsToInsert.length} sections.`);
  }

  // 3. Migrate Classes
  const classesToInsert = legacyClasses.map(c => ({
    id: c.id,
    name: c.name,
    section_id: c.sectionId || c.section_id,
    order: c.order || 0,
    active: c.active !== false
  }));

  if (classesToInsert.length > 0) {
    const { error } = await supabase.from("classes").upsert(classesToInsert);
    if (error) console.error("Error migrating classes:", error);
    else console.log(`Migrated ${classesToInsert.length} classes.`);
  }

  // 4. Migrate Subjects
  const subjectsToInsert = legacySubjects.map(s => ({
    id: s.id,
    name: s.name,
    category: s.category || 'general',
    type: s.type || 'western',
    active: s.active !== false
  }));

  if (subjectsToInsert.length > 0) {
    const { error } = await supabase.from("subjects").upsert(subjectsToInsert);
    if (error) console.error("Error migrating subjects:", error);
    else console.log(`Migrated ${subjectsToInsert.length} subjects.`);
  }

  // 5. Migrate Sessions & Terms
  const sessionsToInsert = legacySessionsList.map(name => {
    // Generate an ID if needed, but since it's just strings, maybe name is ID
    return {
      id: name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      name: name,
      start_date: null,
      end_date: null,
      is_current: name === sessionsSetting.current
    };
  });

  if (sessionsToInsert.length > 0) {
    const { error: sessionError } = await supabase.from("academic_sessions").upsert(sessionsToInsert);
    if (sessionError) console.error("Error migrating sessions:", sessionError);
    else console.log(`Migrated ${sessionsToInsert.length} sessions.`);

    // Migrate terms for each session
    const termsToInsert = [];
    for (const session of sessionsToInsert) {
      for (const termName of legacyTermsList) {
        termsToInsert.push({
          id: `${session.id}-${termName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
          session_id: session.id,
          name: termName,
          start_date: null,
          end_date: null,
          is_current: session.is_current && termName === sessionsSetting.currentTerm
        });
      }
    }
    
    if (termsToInsert.length > 0) {
      const { error: termError } = await supabase.from("terms").upsert(termsToInsert);
      if (termError) console.error("Error migrating terms:", termError);
      else console.log(`Migrated ${termsToInsert.length} terms.`);
    }
  }

  console.log("Migration complete!");
}

migrate().catch(console.error);
