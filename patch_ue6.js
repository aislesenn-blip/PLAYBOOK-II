const fs = require('fs');
let code = fs.readFileSync('js/ue_engine.js', 'utf8');

// A highly robust Math router to catch the closest number to the exact expected answer,
// IF AND ONLY IF that closest number matches the contextual anchors and is within tolerance.
// Or we just find the closest candidate to the 'targetVariable'.
code = code.replace(
`        // Contextual Targets Check
        if (studentFinalAnswer === null) {
            let bestCandidate = null;
            let minDistance = Infinity;
            for (const candidate of candidates) {
                const textBefore = studentText.substring(Math.max(0, candidate.index - 100), candidate.index).toLowerCase();
                for (const target of targetVariables) {
                    const targetIdx = textBefore.lastIndexOf(target.toLowerCase());
                    if (targetIdx !== -1) {
                        const distance = candidate.index - (Math.max(0, candidate.index - 100) + targetIdx + target.length);
                        if (distance < minDistance && distance >= 0) { // Must be AFTER the target
                            minDistance = distance;
                            bestCandidate = candidate.value;
                        }
                    }
                }
            }
            if (bestCandidate !== null) {
                studentFinalAnswer = bestCandidate;
            }
        }`,
`        // Contextual Targets Check
        if (studentFinalAnswer === null) {
            let bestCandidate = null;
            let minDistance = Infinity;
            for (const candidate of candidates) {
                const textBefore = studentText.substring(Math.max(0, candidate.index - 100), candidate.index).toLowerCase();
                for (const target of targetVariables) {
                    const targetIdx = textBefore.lastIndexOf(target.toLowerCase());
                    if (targetIdx !== -1) {
                        // Relaxing the distance requirement to find any number near the target within a window
                        const distance = Math.abs(candidate.index - (Math.max(0, candidate.index - 100) + targetIdx + target.length));
                        if (distance < minDistance) {
                            minDistance = distance;
                            bestCandidate = candidate.value;
                        }
                    }
                }
            }
            if (bestCandidate !== null) {
                studentFinalAnswer = bestCandidate;
            }
        }`
);
fs.writeFileSync('js/ue_engine.js', code);
