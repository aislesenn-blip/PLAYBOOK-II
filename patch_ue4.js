const fs = require('fs');
let code = fs.readFileSync('js/ue_engine.js', 'utf8');

// Patch Math Logic to find the CORRECT candidate backwards
code = code.replace(
`        const numberRegex = /[\\d,]+(\\.\\d+)?/g;
        let match;
        const candidates = [];

        while ((match = numberRegex.exec(studentText)) !== null) {
            candidates.push({
                value: parseFloat(match[0].replace(/,/g, '')),
                index: match.index,
                raw: match[0]
            });
        }`,
`        const numberRegex = /[\\d,]+(\\.\\d+)?/g;
        let match;
        const candidates = [];

        while ((match = numberRegex.exec(studentText)) !== null) {
            const val = parseFloat(match[0].replace(/,/g, ''));
            if (!isNaN(val)) {
                candidates.push({
                    value: val,
                    index: match.index,
                    raw: match[0]
                });
            }
        }`
);
fs.writeFileSync('js/ue_engine.js', code);
