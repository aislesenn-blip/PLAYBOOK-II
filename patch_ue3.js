const fs = require('fs');
let code = fs.readFileSync('js/ue_engine.js', 'utf8');

// Patch Math Logic to find the CORRECT candidate backwards
code = code.replace(
`        // Contextual Units Check
        if (units.length > 0) {
            for (const candidate of candidates) {
                const textAfter = studentText.substring(candidate.index + candidate.raw.length, candidate.index + candidate.raw.length + 15).toLowerCase();
                if (units.some(unit => textAfter.includes(unit.toLowerCase()))) {
                    studentFinalAnswer = candidate.value;
                    break;
                }
            }
        }`,
`        // Contextual Units Check
        if (units.length > 0) {
            for (const candidate of candidates) {
                const textAfter = studentText.substring(candidate.index + candidate.raw.length, candidate.index + candidate.raw.length + 15).toLowerCase();
                if (units.some(unit => textAfter.includes(unit.toLowerCase()))) {
                    studentFinalAnswer = candidate.value; // Keeps overwriting so it gets the LAST mention of the unit
                }
            }
        }`
);
fs.writeFileSync('js/ue_engine.js', code);
