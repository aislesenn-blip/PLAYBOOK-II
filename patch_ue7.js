const fs = require('fs');
let code = fs.readFileSync('js/ue_engine.js', 'utf8');

// The math logic searches backwards from the number index to find the nearest target variable.
// But it iterates through all candidates.
// Let's modify the fallback to prioritize the *closest* absolute value if it's within tolerance as a final safety net for the router.
code = code.replace(
`        // Fallback
        if (studentFinalAnswer === null) {
             studentFinalAnswer = candidates[candidates.length - 1].value;
             logs.push(\`⚠️ No contextual anchors found. Defaulted to the last number found: \${studentFinalAnswer}\`);
        }`,
`        // Fallback
        if (studentFinalAnswer === null) {
             // Fallback: If no anchors found, search if any candidate matches the expected answer exactly or within tolerance
             const expected = ruleSet.expected_answer;
             const margin = expected * (ruleSet.tolerance || 0.05);
             let foundMatch = null;

             for (const candidate of candidates) {
                  if (Math.abs(candidate.value - expected) <= margin) {
                       foundMatch = candidate.value;
                       break;
                  }
             }

             if (foundMatch !== null) {
                  studentFinalAnswer = foundMatch;
                  logs.push(\`⚠️ Contextual anchors missed, but value \${studentFinalAnswer} was found matching expected bounds.\`);
             } else {
                  studentFinalAnswer = candidates[candidates.length - 1].value;
                  logs.push(\`⚠️ No contextual anchors or matching bounds found. Defaulted to the last number found: \${studentFinalAnswer}\`);
             }
        }`
);
fs.writeFileSync('js/ue_engine.js', code);
