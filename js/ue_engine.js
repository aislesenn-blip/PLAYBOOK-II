/**
 * THE ULTIMATE ENGINE (UE) - Deterministic Graph Execution Engine
 *
 * This engine completely bypasses LLM inference during the grading execution phase.
 * It compiles marking schemes into an Axiomatic Grading Matrix (Golden JSON) via Gemini 3.1 Pro,
 * and executes 100% deterministic partial marking, ECF, and Topological Graph Isomorphism natively.
 *
 * NEW: Integrated with `compromise.js` (NLP) for true structural grammar parsing
 * to eliminate hardcoded dictionaries, proximity negations, and spatial `indexOf` flaws.
 */

const UE_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent";

const UE_COMPILER_PROMPT = `
You are an L9 Software Architect functioning as the 'Axiomatic Logic Compiler'. Your task is exclusively to compile raw text Marking Schemes into an immutable, determinist 'Golden JSON' Logic Graph. You DO NOT grade.

*** RULES & ENGINEERING CONSTRAINTS ***
1. CAUSAL TRIPLES & BI-DIRECTIONAL GRAMMAR: For logic/topology depending on directionality (e.g., "A causes B", "Sun provides energy to Plants"), map this in the JSON under \`causal_patterns\`. You MUST provide regular expression patterns or N-Grams that represent BOTH Active and Passive voice for the specific language of the scheme. Do NOT rely on English "by". (e.g., for Active: "A.*causes.*B", Passive: "B.*caused.*A").
2. NEGATION TRIGGERS: Provide language-specific negative words/prefixes (e.g., "not", "never", "hakuna", "sio") under \`negation_triggers\` for each logic node. The executor will check if these words are in proximity to the synonyms.
3. CONTEXT-AWARE MATH EXTRACTION: For calculations (\`type: "math"\`), DO NOT assume the last number is the answer. You MUST provide \`target_variables\` (e.g., ["jibu", "final", "total", "="]) and \`units\` (e.g., ["kg", "m/s", "cm"]). The executor will search for numbers adjacent to these contextual anchors.
4. GRANULAR PARTIAL MARKS: Split large marking allocations into discrete 'Core Nodes' and 'Context Nodes' with distinct, fractional weightings. Provide an exhaustive list of valid language-specific synonyms.
5. TOPOLOGICAL GRAPHS (DIAGRAMS): If a diagram is specified, map it as a \`topology\` object containing \`nodes\` and directional \`edges\`. Include \`valid_patterns\` (Regex/N-Grams) representing how a student might describe the edge in words, in both active/passive forms.
6. FATAL CONTRADICTIONS: Identify specific words or phrases that flip the logical polarity of the answer. If triggered, these will deterministically force a 0 score for that specific block.

*** FEW-SHOT EXAMPLES ***

[INPUT TEXT]
Q1(A)(ii). Beneficial nutrients. (0.5 Marks). These are elements that do not meet the criteria of essentiality but play some beneficial roles in plant nutrition. Examples: Sodium, Silicon.

[OUTPUT JSON (LOGIC)]
{
  "questions": {
    "Q1_A_ii": {
      "title": "Beneficial Nutrients",
      "type": "logic",
      "total_marks": 0.5,
      "fatal_contradictions": ["is essential", "are essential", "required for growth"],
      "nodes": [
        { "concept": "not essential", "weight": 0.25, "synonyms": ["do not meet criteria of essentiality", "non-essential", "unnecessary"], "negation_triggers": ["not", "never", "sio", "ha"] },
        { "concept": "beneficial role", "weight": 0.25, "synonyms": ["beneficial", "helps plants", "improves yield", "sodium", "silicon"], "negation_triggers": ["not", "never", "sio", "ha"] }
      ],
      "causal_patterns": []
    }
  }
}

[INPUT TEXT]
Q2(B). The total mass is 50 kg. (2 marks).

[OUTPUT JSON (MATH)]
{
  "questions": {
    "Q2_B": {
      "title": "Total Mass",
      "type": "math",
      "total_marks": 2,
      "expected_answer": 50,
      "tolerance": 0.05,
      "target_variables": ["mass", "total", "jibu", "is", "="],
      "units": ["kg", "kilograms"]
    }
  }
}

[INPUT TEXT]
Q2(B)(i). Draw an Active Remote Sensing circuit. Must show a Satellite emitting rays towards the Earth. (5 Marks)

[OUTPUT JSON (TOPOLOGY)]
{
  "questions": {
    "Q2_B_i": {
      "title": "Active Remote Sensing Diagram",
      "type": "topology",
      "total_marks": 5,
      "topology": {
          "nodes": ["Satellite", "Earth"],
          "edges": [
              {
                "source": "Satellite",
                "target": "Earth",
                "weight": 5,
                "valid_patterns": [
                   "satellite.*emits.*earth",
                   "satellite.*sends.*earth",
                   "earth.*receives.*satellite",
                   "earth.*hit by.*satellite"
                ]
              }
          ]
      }
    }
  }
}

*** JSON SCHEMA CONTRACT ***
You MUST output raw JSON matching the exact schema demonstrated above. No markdown. No reasoning. Just the JSON object.
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

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(`Compilation failed: ${response.status} - ${errData?.error?.message || response.statusText}`);
        }

        const data = await response.json();
        let textResponse = data.candidates[0].content.parts[0].text;

        textResponse = textResponse.replace(/^```json\n?/i, '').replace(/\n?```$/i, '').trim();

        return JSON.parse(textResponse);
    } catch (e) {
        console.error("UE Compiler Error:", e);
        throw e;
    }
}

class UEGraphExecutor {
    constructor(goldenJson) {
        this.goldenJson = goldenJson || { questions: {} };
        // Replacing compromise.js with native Intl.Segmenter for universal language support
        this.segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
        this.wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    }

    async execute(studentAnswers) {
        let totalScore = 0;
        let breakdown = {};

        for (const [qId, studentRaw] of Object.entries(studentAnswers)) {
            let studentText = "";
            let studentTopology = null;

            if (typeof studentRaw === 'string') {
                studentText = studentRaw;
            } else if (studentRaw && studentRaw.text) {
                studentText = studentRaw.text;
                studentTopology = studentRaw.topology || null;
            }

            const ruleSet = this.goldenJson.questions[qId];

            if (!studentText || studentText.trim() === "" || studentText === "No text extracted." || !ruleSet) {
                breakdown[qId] = {
                    score: 0,
                    points_awarded: [],
                    is_entirely_blank: true,
                    answer_status: "Skipped",
                    justification: "No answer provided or unrecognized question.",
                    feedback: "No actionable feedback.",
                    title: ruleSet ? ruleSet.title : `Question ${qId}`,
                    max_marks: ruleSet ? ruleSet.total_marks : 1
                };
                continue;
            }

            let qScore = 0;
            let qBreakdown = [];
            let pointsAwarded = [];

            if (ruleSet.type === 'logic') {
                const { score, logs, points } = await this._evaluateLogic(ruleSet, studentText);
                qScore = score;
                qBreakdown = logs;
                pointsAwarded = points;
            } else if (ruleSet.type === 'math') {
                const { score, logs, points } = this._evaluateMath(ruleSet, studentText);
                qScore = score;
                qBreakdown = logs;
                pointsAwarded = points;
            } else if (ruleSet.type === 'topology') {
                const { score, logs, points } = this._evaluateTopology(ruleSet, studentText, studentTopology);
                qScore = score;
                qBreakdown = logs;
                pointsAwarded = points;
            }

            totalScore += qScore;
            breakdown[qId] = {
                score: qScore,
                points_awarded: pointsAwarded,
                is_entirely_blank: false,
                answer_status: "Answered",
                justification: qBreakdown.join("\n"),
                feedback: `Evaluated deterministically via UE Native NLP Engine. Total marks awarded: ${qScore}.`,
                title: ruleSet.title || `Question ${qId}`,
                max_marks: ruleSet.total_marks || 1
            };
        }

        return { totalScore, breakdown };
    }

    // SILICONFLOW EMBEDDING INTEGRATION (High Dimensional Vector Space)
    async _getEmbedding(text) {
        try {
            // Retrieve the API key dynamically from localStorage (cached by ai.js or db.js during session init)
            const apiKey = typeof localStorage !== "undefined" ? localStorage.getItem('PLAYBOOK_SILICONFLOW_API_KEY') : null;

            if (!apiKey) {
                return null;
            }

            const response = await fetch("https://api.siliconflow.cn/v1/embeddings", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey.trim()}`
                },
                body: JSON.stringify({
                    model: "BAAI/bge-m3", // Multilingual high-dimensional embedding model
                    input: text,
                    encoding_format: "float"
                })
            });

            if (!response.ok) {
                let errData;
                try {
                    errData = await response.json();
                } catch (e) {
                    errData = { error: { message: "Could not parse error response" } };
                }
                throw new Error(`SiliconFlow Embedding failed: ${response.status} - ${errData?.error?.message}`);
            }

            const data = await response.json();
            if (data && data.data && data.data.length > 0) {
                return data.data[0].embedding;
            }
            throw new Error("Invalid embedding response format.");

        } catch (error) {
            console.warn("Vector Model unreachable. Falling back to Fuzzy Matrix Math.", error);
            return null; // Signals the engine to fallback to Levenshtein Distance
        }
    }

    // NATIVE FUZZY STRING MATCHING (Levenshtein Distance - Fallback)
    // Solves semantic blindspots (e.g. "physically contact" vs "physical contact")
    _fuzzyMatch(studentText, term, threshold = 0.85) {
        const textWords = studentText.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
        const termWords = term.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);

        // If exact phrase is found
        if (studentText.toLowerCase().includes(term.toLowerCase())) return true;

        // Sliding window over student words matching term length
        for (let i = 0; i <= textWords.length - termWords.length; i++) {
            let windowPhrase = textWords.slice(i, i + termWords.length).join(" ");
            let targetPhrase = termWords.join(" ");

            const distance = this._levenshtein(windowPhrase, targetPhrase);
            const maxLength = Math.max(windowPhrase.length, targetPhrase.length);
            const similarity = 1 - (distance / maxLength);

            if (similarity >= threshold) return true;
        }
        return false;
    }

    _levenshtein(a, b) {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;
        const matrix = [];
        for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
        for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
                    );
                }
            }
        }
        return matrix[b.length][a.length];
    }

    async _evaluateLogic(ruleSet, studentText) {
        let score = 0;
        let logs = [];
        let points = [];

        // 1. FATAL FLAW RULE (Polarity check)
        if (ruleSet.fatal_contradictions) {
            for (const fatal of ruleSet.fatal_contradictions) {
                if (studentText.toLowerCase().includes(fatal.toLowerCase())) {
                    return { score: 0, points: [], logs: [`Fatal Contradiction detected: '${fatal}'. Logical polarity flipped. 0 marks.`] };
                }
            }
        }

        // 2. DIRECTIONAL SEMANTIC ANCHOR (Language-Agnostic Regex Patterns)
        if (ruleSet.causal_patterns && ruleSet.causal_patterns.length > 0) {
            let patternMatched = false;
            for (const pattern of ruleSet.causal_patterns) {
                const regex = new RegExp(pattern, 'i');
                if (regex.test(studentText)) {
                    patternMatched = true;
                    break;
                }
            }
            if (!patternMatched) {
                return { score: 0, points: [], logs: [`Causal/Directional error detected. Required structural pattern missing. 0 marks.`] };
            }
        }

        // 3. THE VECTOR SPACE MATH EVALUATION
        if (ruleSet.nodes) {
            // Segment student text into discrete thoughts
            const sentencesIterator = this.segmenter.segment(studentText);
            const sentences = Array.from(sentencesIterator).map(s => s.segment);

            // Generate Local Embedding Matrix for Student (Batching could be implemented later)
            const studentVectors = [];
            for (const sentence of sentences) {
                if (sentence.trim().length > 3) {
                    const vec = await this._getEmbedding(sentence);
                    if (vec) studentVectors.push({ text: sentence, vec: vec });
                }
            }

            const isVectorSpaceActive = studentVectors.length > 0;

            for (const node of ruleSet.nodes) {
                let nodeHit = false;
                let matchedTerm = null;
                let highestSimilarity = 0;

                const termsToCheck = [node.concept, ...(node.synonyms || [])];
                const negationTriggers = node.negation_triggers || ["not", "never", "sio", "ha", "hakuna"];

                if (isVectorSpaceActive) {
                    // VECTOR DOT PRODUCT GRADING
                    // Compile node concepts into vectors
                    for (const term of termsToCheck) {
                        const termVec = await this._getEmbedding(term);
                        if (!termVec) continue;

                        for (const studentSentence of studentVectors) {
                            const similarity = this._cosineSimilarity(termVec, studentSentence.vec);
                            if (similarity > highestSimilarity) {
                                highestSimilarity = similarity;
                                matchedTerm = term;
                            }

                            // High-dimensional Intent Threshold (0.78 Cosine usually implies deep semantic correlation)
                            if (similarity > 0.78) {
                                // Double check negations even in vector space for safety
                                let isMatchNegated = false;
                                const sentenceLower = studentSentence.text.toLowerCase();
                                const wordIterator = this.wordSegmenter.segment(sentenceLower);
                                const words = Array.from(wordIterator).map(w => w.segment);

                                for (const neg of negationTriggers) {
                                    if (words.some(w => w.includes(neg.toLowerCase()))) {
                                        isMatchNegated = true;
                                        break;
                                    }
                                }

                                if (!isMatchNegated) {
                                    nodeHit = true;
                                    break;
                                }
                            }
                        }
                        if (nodeHit) break;
                    }
                }

                // FALLBACK TO FUZZY MATRIX (If Vector DB offline)
                if (!nodeHit && !isVectorSpaceActive) {
                    for (const sentence of sentences) {
                        for (const term of termsToCheck) {
                            const fuzzyFound = this._fuzzyMatch(sentence, term, 0.85);

                            if (fuzzyFound) {
                                let isMatchNegated = false;
                                const sentenceLower = sentence.toLowerCase();

                                const wordIterator = this.wordSegmenter.segment(sentenceLower);
                                const words = Array.from(wordIterator).map(w => w.segment);

                                for (const neg of negationTriggers) {
                                    if (words.some(w => w.includes(neg.toLowerCase()))) {
                                        isMatchNegated = true;
                                        break;
                                    }
                                }

                                if (!isMatchNegated) {
                                    nodeHit = true;
                                    matchedTerm = term;
                                    break;
                                }
                            }
                        }
                        if (nodeHit) break;
                    }
                }

                if (nodeHit) {
                    // Prevent specific node from being rewarded twice (already handled by outer node loop)
                    score += node.weight;
                    points.push(node.weight);
                    const method = isVectorSpaceActive ? `Vector Similarity: ${(highestSimilarity * 100).toFixed(1)}%` : `Fuzzy String Match`;
                    logs.push(`✓ Semantic Node hit: [${node.concept}] via '${matchedTerm}' (${method}) (+${node.weight} marks)`);
                } else {
                    logs.push(`✗ Missed Node: [${node.concept}]`);
                }
            }
        }

        // ABSOLUTE MATH CAPPING (Solves the "24 Score Overflow" issue)
        if (ruleSet.total_marks && score > ruleSet.total_marks) {
             score = ruleSet.total_marks;
        }

        score = Math.round(score * 100) / 100;

        return { score, logs, points };
    }

    _evaluateMath(ruleSet, studentText) {
        let score = 0;
        let logs = [];
        let points = [];

        // Advanced Contextual Extraction instead of just the last number
        const numberRegex = /[\d,]+(\.\d+)?/g;
        let match;
        const candidates = [];

        while ((match = numberRegex.exec(studentText)) !== null) {
            candidates.push({
                value: parseFloat(match[0].replace(/,/g, '')),
                index: match.index,
                raw: match[0]
            });
        }

        if (candidates.length === 0) {
            return { score: 0, points: [], logs: ["No mathematical derivation found."] };
        }

        let studentFinalAnswer = null;

        // Context check using units and target variables from Golden JSON
        const targetVariables = ruleSet.target_variables || ["jibu", "final", "total", "="];
        const units = ruleSet.units || [];

        // 1. Prioritize numbers immediately followed by units
        if (units.length > 0) {
            for (const candidate of candidates) {
                const textAfter = studentText.substring(candidate.index + candidate.raw.length, candidate.index + candidate.raw.length + 15).toLowerCase();
                if (units.some(unit => textAfter.includes(unit.toLowerCase()))) {
                    studentFinalAnswer = candidate.value;
                    break;
                }
            }
        }

        // 2. Fallback to numbers near target variables
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
        }

        // 3. Fallback to the last number if no context matches
        if (studentFinalAnswer === null) {
             studentFinalAnswer = candidates[candidates.length - 1].value;
             logs.push(`⚠️ No contextual anchors found. Defaulted to the last number found: ${studentFinalAnswer}`);
        }

        const expected = ruleSet.expected_answer;
        const diff = Math.abs(studentFinalAnswer - expected);
        const margin = expected * (ruleSet.tolerance || 0.05);
        const totalMarks = ruleSet.total_marks || 1;

        if (diff === 0) {
            score = totalMarks;
            points.push(score);
            logs.push(`✓ Exact match. Value: ${studentFinalAnswer}`);
        } else if (diff <= margin) {
            score = Math.max(0, totalMarks - 0.5);
            points.push(score);
            logs.push(`⚠️ Precision Truncation. Value: ${studentFinalAnswer}. Expected: ${expected}. ECF Applied (-0.5 marks)`);
        } else {
            logs.push(`✗ Incorrect execution. Value: ${studentFinalAnswer}. Expected: ${expected}`);
        }

        return { score, logs, points };
    }

    _evaluateTopology(ruleSet, studentText, studentTopology) {
        let score = 0;
        let logs = [];
        let points = [];

        const goldenTop = ruleSet.topology;
        if (!goldenTop || !goldenTop.edges) {
            return { score: 0, points: [], logs: ["Marking scheme missing topological edges definition."] };
        }

        // Segment into sentences using native Intl.Segmenter
        const sentencesIterator = this.segmenter.segment(studentText);
        const sentences = Array.from(sentencesIterator).map(s => s.segment);

        for (const edge of goldenTop.edges) {
            const src = edge.source.toLowerCase();
            const tgt = edge.target.toLowerCase();

            let edgeMatched = false;
            let matchedPattern = "";

            if (edge.valid_patterns && edge.valid_patterns.length > 0) {
                // Use Compiler-generated Bi-directional patterns for accurate evaluation
                for (const pattern of edge.valid_patterns) {
                    const regex = new RegExp(pattern, 'i');
                    if (regex.test(studentText)) {
                        edgeMatched = true;
                        matchedPattern = pattern;
                        break;
                    }
                }
            } else {
                // Fallback if patterns are missing: Just check if both exist in the same sentence (less accurate, but safe)
                for (const sentence of sentences) {
                     const sLower = sentence.toLowerCase();
                     if (sLower.includes(src) && sLower.includes(tgt)) {
                         edgeMatched = true;
                         break;
                     }
                }
            }

            if (edgeMatched) {
                score += edge.weight;
                points.push(edge.weight);
                logs.push(`✓ Graph Edge matched: [${src}] -> [${tgt}] (+${edge.weight} marks)`);
            } else {
                const sLower = studentText.toLowerCase();
                if (sLower.includes(src) && sLower.includes(tgt)) {
                    logs.push(`✗ Inverse Topology: Connection described between [${src}] and [${tgt}] but directional pattern not matched. 0 marks.`);
                } else {
                    logs.push(`✗ Missing Topological Node: Failed to detect connection between [${src}] and [${tgt}].`);
                }
            }
        }

        return { score, logs, points };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { compileGoldenJSON, UEGraphExecutor };
} else {
    window.UEGraphExecutor = UEGraphExecutor;
    window.compileGoldenJSON = compileGoldenJSON;
}
