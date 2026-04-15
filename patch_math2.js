const fs = require('fs');
let code = fs.readFileSync('js/ue_engine.js', 'utf8');
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
                    studentFinalAnswer = candidate.value;
                }
            }
        }`
);
fs.writeFileSync('js/ue_engine.js', code);
