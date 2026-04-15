const fs = require('fs');
let code = fs.readFileSync('js/ue_engine.js', 'utf8');

// The logic fails to isolate 1.8% properly due to other occurrences of "%".
// A specific target "was" will pinpoint the correct area for 1.8%
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
        }`
);
fs.writeFileSync('js/ue_engine.js', code);
