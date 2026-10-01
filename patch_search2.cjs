const fs = require('fs');
let code = fs.readFileSync('js/modules/students.js', 'utf8');

const oldFilter = `    if (searchTerm) {
      displayStudents = students.filter(s => 
        (s.fullName || "").toLowerCase().includes(searchTerm) || 
        (s.admissionNo || "").toLowerCase().includes(searchTerm)
      );
    }`;

const newFilter = `    if (searchTerm) {
      displayStudents = students.filter(s => 
        localSel.has(s.id) || 
        (s.fullName || "").toLowerCase().includes(searchTerm) || 
        (s.admissionNo || "").toLowerCase().includes(searchTerm)
      );
    }`;

if (code.includes(oldFilter)) {
    code = code.replace(oldFilter, newFilter);
    fs.writeFileSync('js/modules/students.js', code);
    console.log("Success");
} else {
    console.log("Filter not found");
}
