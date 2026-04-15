const { UEGraphExecutor } = require('./js/ue_engine.js');

const goldenJson = {
    "questions": {
        "Q1_Slang": {
            "title": "Slang & Semantic Vector Match",
            "type": "logic",
            "total_marks": 2,
            "nodes": [
                { "concept": "creates food and energy", "weight": 2.0 }
            ]
        },
        "Q2_Math": {
            "title": "Math Tolerance & ECF",
            "type": "math",
            "total_marks": 5,
            "expected_answer": 9.81,
            "tolerance": 0.05,
            "target_variables": ["gravity", "g ="],
            "units": ["m/s"]
        },
        "Q3_Negation": {
            "title": "Fatal Contradiction",
            "type": "logic",
            "total_marks": 3,
            "fatal_contradictions": ["destroys leaves", "is bad for soil"],
            "nodes": [
                { "concept": "boosts plant growth", "weight": 3.0 }
            ]
        },
        "Q4_Dispersed": {
            "title": "Dispersed Logic (Coreference)",
            "type": "logic",
            "total_marks": 2,
            "nodes": [
                { "concept": "UREA makes leaves green", "weight": 2.0 }
            ]
        },
        "Q5_Topology": {
            "title": "Topology Connection",
            "type": "topology",
            "total_marks": 4,
            "topology": {
                "nodes": ["Battery", "Bulb"],
                "edges": [
                    { "source": "Battery", "target": "Bulb", "weight": 4.0, "valid_patterns": ["battery.*connect.*bulb"] }
                ]
            }
        },
        "Q6_Padding": {
            "title": "Anti-Gaming Filter",
            "type": "logic",
            "total_marks": 2,
            "nodes": [
                { "concept": "needs water", "weight": 2.0 }
            ]
        }
    }
};

async function runTest() {
    console.log("=== STARTING 6-QUESTION SANDBOX STRESS TEST ===");
    const engine = new UEGraphExecutor(goldenJson);

    const studentAnswers = {
        "FullExam": `
            1. The plant produces glucose for its meals to survive.
            2. After calculating the drop, gravity g = 9.85 m/s.
            3. NPK fertilizer actually destroys leaves completely.
            4. The farmer brought UREA yesterday. Then ile mbolea makes leaves green.
            5. You take the wire from the Battery and connect it to the Bulb.
            6. Water is wet. Plants are green. The sun is hot. Soil is dirty. The process needs water. Air is invisible.
        `
    };

    const results = await engine.execute(studentAnswers);
    console.log(JSON.stringify(results, null, 2));
}

runTest();
