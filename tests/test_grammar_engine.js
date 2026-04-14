const { UEGraphExecutor } = require('../js/ue_engine.js');
const nlp = require('compromise');

const goldenJSON = {
    "questions": {
        "Q1": {
            "title": "Passive Voice Test",
            "type": "logic",
            "total_marks": 2,
            "causal_triple": {
                "subject": "rain",
                "verb": "causes",
                "object": "floods"
            },
            "nodes": [
                { "concept": "rain", "weight": 1.0 },
                { "concept": "floods", "weight": 1.0 }
            ]
        },
        "Q2": {
            "title": "Negation Trap Test",
            "type": "logic",
            "total_marks": 2,
            "nodes": [
                { "concept": "use water", "weight": 2.0 }
            ]
        }
    }
};

const studentAnswers = {
    "Q1": "The devastating floods were ultimately caused by the heavy rain.",
    "Q2": "Plants do NOT die easily because they use water to survive."
};

console.log("=== THE L9 NLP GRAMMAR ENGINE TEST ===");

const executor = new UEGraphExecutor(goldenJSON);
executor.nlp = nlp;

const result = executor.execute(studentAnswers);
console.log(JSON.stringify(result, null, 2));
