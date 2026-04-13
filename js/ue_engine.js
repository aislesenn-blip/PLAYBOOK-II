/**
 * THE ULTIMATE ENGINE (UE) - Deterministic Graph Execution Engine
 *
 * This engine completely bypasses LLM inference during the grading execution phase.
 * It compiles marking schemes into an Axiomatic Grading Matrix (Golden JSON) via Gemini 3.1 Pro (simulated/called),
 * and executes 100% deterministic partial marking and Error Carried Forward (ECF) logic natively.
 */

const UE_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent";

const UE_COMPILER_PROMPT = `
You are the UE Axiomatic Logic Compiler. You do not grade.
Convert the provided Marking Scheme into an Axiomatic Grading Matrix (Golden JSON).

*** RULES ***
1. Create Causal Triples for explanations (e.g., [Absence of Moisture] -> CAUSES -> [Invariabilities]).
2. Establish Core Nodes and Context Nodes for partial marking.
3. For math, provide an 'ast_formula' and 'tolerance' threshold for floating point execution.
4. Output strict JSON only.

SCHEMA:
{
  "questions": {
    "Q_ID": {
      "type": "logic|math",
      "nodes": [
         { "concept": "...", "weight": 0.5, "synonyms": ["..."] }
      ],
      "fatal_contradictions": ["..."],
      "ast_formula": "...", // Only if math
      "expected_answer": 0,
      "total_marks": 1,
      "tolerance": 0.05
    }
  }
}
`;

async function compileGoldenJSON(apiKey, markingSchemeText) {
    if (!apiKey) throw new Error("API Key required for compilation");

    const payload = {
        systemInstruction: { parts: [{ text: UE_COMPILER_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: "Compile this marking scheme: \n" + markingSchemeText }] }],
        generationConfig: {
            temperature: 0.0,
            responseMimeType: "application/json"
        }
    };

    try {
        const response = await fetch(`${UE_API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`Compilation failed: ${response.status}`);
        const data = await response.json();

        const textResponse = data.candidates[0].content.parts[0].text;
        return JSON.parse(textResponse);
    } catch (e) {
        console.error("UE Compiler Error:", e);
        throw e;
    }
}

class UEGraphExecutor {
    constructor(goldenJson) {
        this.goldenJson = goldenJson;
    }

    execute(studentAnswers) {
        let totalScore = 0;
        let breakdown = {};

        for (const [qId, studentText] of Object.entries(studentAnswers)) {
            const ruleSet = this.goldenJson.questions[qId];
            if (!ruleSet) continue;

            let qScore = 0;
            let qBreakdown = [];

            if (ruleSet.type === 'logic') {
                const { score, logs } = this._evaluateLogic(ruleSet, studentText);
                qScore = score;
                qBreakdown = logs;
            } else if (ruleSet.type === 'math') {
                const { score, logs } = this._evaluateMath(ruleSet, studentText);
                qScore = score;
                qBreakdown = logs;
            }

            totalScore += qScore;
            breakdown[qId] = { score: qScore, details: qBreakdown };
        }

        return { totalScore, breakdown };
    }

    _evaluateLogic(ruleSet, studentText) {
        let score = 0;
        let logs = [];
        const textLower = studentText.toLowerCase();

        // 1. Check Fatal Contradictions (Polarity Flips)
        if (ruleSet.fatal_contradictions) {
            for (const fatal of ruleSet.fatal_contradictions) {
                if (textLower.includes(fatal.toLowerCase())) {
                    return { score: 0, logs: [`Fatal Contradiction detected: '${fatal}'. Logical polarity flipped. 0 marks.`] };
                }
            }
        }

        // 2. Evaluate Nodes for Partial Marking
        for (const node of ruleSet.nodes) {
            let nodeHit = false;
            const termsToCheck = [node.concept, ...(node.synonyms || [])];

            for (const term of termsToCheck) {
                if (textLower.includes(term.toLowerCase())) {
                    nodeHit = true;
                    break;
                }
            }

            if (nodeHit) {
                score += node.weight;
                logs.push(`✓ Semantic Node hit: [${node.concept}] (+${node.weight} marks)`);
            } else {
                logs.push(`✗ Missed Node: [${node.concept}]`);
            }
        }

        return { score, logs };
    }

    _evaluateMath(ruleSet, studentText) {
        let score = 0;
        let logs = [];

        // Extract numbers accounting for commas (e.g. 9,333,333.33)
        const numberStrings = studentText.match(/[\d,]+(\.\d+)?/g);
        if (!numberStrings) {
            return { score: 0, logs: ["No mathematical derivation found."] };
        }

        const parsedNumbers = numberStrings.map(n => parseFloat(n.replace(/,/g, '')));
        const studentFinalAnswer = parsedNumbers[parsedNumbers.length - 1];
        const expected = ruleSet.expected_answer;

        // Check Truncation / Tolerance for Error Carried Forward (ECF)
        const diff = Math.abs(studentFinalAnswer - expected);
        const margin = expected * (ruleSet.tolerance || 0.05);

        if (diff === 0) {
            score = ruleSet.total_marks || 1;
            logs.push(`✓ Exact match. Value: ${studentFinalAnswer}`);
        } else if (diff <= margin) {
            score = Math.max(0, (ruleSet.total_marks || 1) - 0.5); // Dock half mark for precision
            logs.push(`⚠️ Precision Truncation. Value: ${studentFinalAnswer}. Expected: ${expected}. ECF Applied (-0.5 marks)`);
        } else {
            logs.push(`✗ Incorrect execution. Value: ${studentFinalAnswer}. Expected: ${expected}`);
        }

        return { score, logs };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { compileGoldenJSON, UEGraphExecutor };
} else {
    window.UEGraphExecutor = UEGraphExecutor;
    window.compileGoldenJSON = compileGoldenJSON;
}
