const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const backupPath = path.resolve(__dirname, '../backups/CIC KANO-backup-2026-08-04.json');
const rootData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
const data = rootData.data || {};
const results = data.results || {};

const examIds = new Set();
Object.values(results).forEach(r => {
    examIds.add(r.exam_id || r.examId);
});
console.log('Unique exam IDs in results:', Array.from(examIds));
