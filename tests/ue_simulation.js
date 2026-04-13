const { UEGraphExecutor } = require('../js/ue_engine.js');

// We need to refine the math regex for comma-separated thousands in the engine simulation
class ImprovedUEGraphExecutor extends UEGraphExecutor {
    _evaluateMath(ruleSet, studentText) {
        let score = 0;
        let logs = [];

        // Improve naive number extraction to handle commas and the final answer correctly
        // Match numbers with optional commas and decimals
        const numberStrings = studentText.match(/[\d,]+(\.\d+)?/g);
        if (!numberStrings) {
            return { score: 0, logs: ["No mathematical derivation found."] };
        }

        // Clean commas and parse
        const parsedNumbers = numberStrings.map(n => parseFloat(n.replace(/,/g, '')));
        const studentFinalAnswer = parsedNumbers[parsedNumbers.length - 1];
        const expected = ruleSet.expected_answer;

        // Check Truncation / Tolerance
        const diff = Math.abs(studentFinalAnswer - expected);
        const margin = expected * (ruleSet.tolerance || 0.05);

        if (diff === 0) {
            score = ruleSet.total_marks || 1;
            logs.push(`✓ Exact match. Value: ${studentFinalAnswer}`);
        } else if (diff <= margin) {
            score = (ruleSet.total_marks || 1) - 0.5; // Dock half mark for precision
            logs.push(`⚠️ Precision Truncation. Value: ${studentFinalAnswer}. Expected: ${expected}. ECF Applied (-0.5 marks)`);
        } else {
            logs.push(`✗ Incorrect execution. Value: ${studentFinalAnswer}. Expected: ${expected}`);
        }

        return { score, logs };
    }
}

// Simulate the compiled Golden JSON for the Precision Agriculture Exam
const goldenJSON = {
    "questions": {
        "Q1_A_ii": {
            "type": "logic",
            "nodes": [
                { "concept": "NOT_ESSENTIAL", "weight": 0.25, "synonyms": ["do not meet criteria of essentiality"] },
                { "concept": "BENEFICIAL", "weight": 0.25, "synonyms": ["play beneficial roles"] }
            ],
            "fatal_contradictions": ["Are essential", "IS_ESSENTIAL"]
        },
        "Q3_B": {
            "type": "logic",
            "nodes": [
                { "concept": "Reduce Drudgery", "weight": 2.0, "synonyms": ["easy to manage", "manage large farms"] },
                { "concept": "Reduce Cost", "weight": 2.0, "synonyms": ["reduce cost"] },
                { "concept": "Increase Yield", "weight": 2.0, "synonyms": ["increase yield"] },
                { "concept": "Increase Efficiency", "weight": 2.0, "synonyms": ["increase efficiency"] },
                { "concept": "Environmental Protection", "weight": 2.0, "synonyms": ["optimize the use of scarce resources"] }
            ]
        },
        "Q6_B_ii": {
            "type": "math",
            "total_marks": 8,
            "expected_answer": 9333310,
            "tolerance": 0.05 // Allows ~460k deviation for truncation ECF
        }
    }
};

const studentAnswers = {
    "Q1_A_ii": "Are essential or important nutrients which are required for growth and production. Examples: Sodium (Na).",
    "Q3_B": "Easy / Reliable way to manage large farms... Reduce cost of Production over a long run... Increase yield Productivity... Increase Efficiency... Optimize the Use of scarce resources like water.",
    "Q6_B_ii": "From: 18 Mg = 16.2%, x = 12%. x = 13.33 Mg will be sold. Number of bags = 13333 kg / 100 kg = 133.33 bags. Price to pay = 133.33 bags * 70,000 Tsh = 9,333,333.33 Tsh. A buyer will pay 9,333,333.33 Tsh."
};

console.log("==========================================");
console.log("🚀 THE OMNI-GRADER: UE APEX EXECUTION");
console.log("Student ID: 2018-04-12551");
console.log("==========================================\n");

const executor = new ImprovedUEGraphExecutor(goldenJSON);
const result = executor.execute(studentAnswers);

console.log(`TOTAL SCORE: ${result.totalScore} Marks\n`);

for (const [qId, data] of Object.entries(result.breakdown)) {
    console.log(`[${qId}] Score: ${data.score}`);
    data.details.forEach(log => console.log(`  -> ${log}`));
    console.log("");
}
console.log("==========================================");
