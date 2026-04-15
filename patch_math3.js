const fs = require('fs');
let code = fs.readFileSync('js/ue_engine.js', 'utf8');
code = code.replace(
`        // Contextual Targets Check
        if (studentFinalAnswer === null) {
            let bestCandidate = null;
            let minDistance = Infinity;
            for (const candidate of candidates) {
                const textBefore = studentText.substring(Math.max(0, candidate.index - 50), candidate.index).toLowerCase();
                for (const target of targetVariables) {
                    const targetIdx = textBefore.lastIndexOf(target.toLowerCase());
                    if (targetIdx !== -1) {
                        const distance = candidate.index - (Math.max(0, candidate.index - 50) + targetIdx + target.length);
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
                const textBefore = studentText.substring(Math.max(0, candidate.index - 80), candidate.index).toLowerCase();
                for (const target of targetVariables) {
                    const targetIdx = textBefore.lastIndexOf(target.toLowerCase());
                    if (targetIdx !== -1) {
                        const distance = candidate.index - (Math.max(0, candidate.index - 80) + targetIdx + target.length);
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
