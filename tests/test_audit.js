const { UEGraphExecutor } = require('../js/ue_engine.js');

const goldenJSON = {
    "questions": {
        "Q1_A_i": {
            "title": "Field invariabilities",
            "type": "logic",
            "total_marks": 0.5,
            "causal_triple": {
                "subject": "Absence",
                "verb": "causes",
                "object": "invariability"
            },
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
        },
        "Q2_B_i": {
            "title": "Active Remote Sensing Diagram",
            "type": "topology",
            "total_marks": 5,
            "topology": {
                "nodes": ["Satellite", "Earth"],
                "edges": [
                    { "source": "Satellite", "target": "Earth", "label": "emits rays", "weight": 2.5 },
                    { "source": "Earth", "target": "Satellite", "label": "reflected back", "weight": 2.5 }
                ]
            }
        }
    }
};

const studentAnswers = {
    // Failing directionality ("Man bites dog")
    "Q1_A_i": "The invariability is the reason there is an absence of changes in soil.",
    // Tolerated math truncation (ECF)
    "Q6_B_ii": "Number of bags = 133.33 bags. Price to pay = 133.33 bags * 70,000 Tsh = 9,333,333.33 Tsh.",
    // Correct topology but terrible drawing (Represented as OCR structural text)
    "Q2_B_i": "I drew a box labeled Satellite shooting a laser down to the Earth. Another line goes from the Earth bouncing back up to the Satellite."
};

console.log("=== THE APEX L9 AUDIT TEST ===");
const executor = new UEGraphExecutor(goldenJSON);
const result = executor.execute(studentAnswers);
console.log(JSON.stringify(result, null, 2));
