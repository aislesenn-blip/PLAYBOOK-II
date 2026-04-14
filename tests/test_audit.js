const { UEGraphExecutor } = require('../js/ue_engine.js');

const goldenJSON = {
    "questions": {
        "Q1_A_i": {
            "title": "Field invariabilities",
            "type": "logic",
            "total_marks": 0.5,
            "nodes": [
                { "concept": "absence of heterogeneity", "weight": 0.25, "synonyms": ["uniformity", "does not change", "invariability"] },
                { "concept": "soil properties", "weight": 0.25, "synonyms": ["physical and chemical properties", "soil context"] }
            ],
            "fatal_contradictions": ["highly variable", "changes frequently"]
        },
        "Q6_B_ii": {
            "title": "Maize Yield Price",
            "type": "math",
            "total_marks": 8,
            "ast_formula": "(18 * 0.12) / 0.162",
            "expected_answer": 9333310,
            "tolerance": 0.05
        }
    }
};

const studentAnswers = {
    "Q1_A_i": "Conditions of crop, soil which does not change within the field.",
    "Q6_B_ii": "Number of bags = 133.33 bags. Price to pay = 133.33 bags * 70,000 Tsh = 9,333,333.33 Tsh."
};

console.log("=== THE L9 AUDIT TEST ===");
const executor = new UEGraphExecutor(goldenJSON);
const result = executor.execute(studentAnswers);
console.log(JSON.stringify(result, null, 2));
