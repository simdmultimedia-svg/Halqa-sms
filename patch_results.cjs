const fs = require('fs');
let code = fs.readFileSync('js/modules/results.js', 'utf8');

const oldSaveRow = "    const saveRow = debounce((student, vals, rowEls, explicit = false) => {";
const newSaveRow = "    const saveRowLogic = (student, vals, rowEls, explicit = false) => {";

let lines = code.split('\n').map(l => l.replace('\r', ''));
let startIndex = -1;
let endIndex = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i] === oldSaveRow) startIndex = i;
  if (startIndex !== -1 && lines[i] === '    }, 800);' && i > startIndex && endIndex === -1) {
    endIndex = i;
  }
}

if (startIndex !== -1 && endIndex !== -1) {
  lines[startIndex] = newSaveRow;
  lines[endIndex] = `    };

    const rowDebouncers = {};
    const getDebouncer = (studentId) => {
      if (!rowDebouncers[studentId]) {
        rowDebouncers[studentId] = debounce((student, vals, rowEls, explicit = false) => {
          saveRowLogic(student, vals, rowEls, explicit);
        }, 800);
      }
      return rowDebouncers[studentId];
    };
    
    const saveRow = (student, vals, rowEls, explicit = false) => {
      if (explicit) {
        saveRowLogic(student, vals, rowEls, explicit);
      } else {
        getDebouncer(student.id)(student, vals, rowEls, explicit);
      }
    };`;
    
    fs.writeFileSync('js/modules/results.js', lines.join('\n'));
    console.log("Success");
} else {
    console.log("Not found. start:", startIndex, "end:", endIndex);
}
