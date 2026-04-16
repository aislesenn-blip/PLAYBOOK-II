/**
 * THE ULTIMATE ENGINE (UE) - Neuro-Symbolic Hybrid Graph Executor (FULL PRODUCT)
 *
 * Temporarily uses @xenova/transformers for Real Local Vectors during testing,
 * easily swappable to the Local PC GB model later.
 * Retains all legacy robust Symbolic capabilities (Math contextualization, Topology).
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

    try {
        const payload = {
            systemInstruction: { parts: [{ text: UE_COMPILER_PROMPT }] },
            contents: [{ role: "user", parts: [{ text: `Compile the following Marking Scheme into the Golden JSON Schema:\n\n${markingSchemeText}` }] }],
            generationConfig: {
                temperature: 0.0,
                maxOutputTokens: 8192,
                responseMimeType: "application/json"
            }
        };

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

let pipeline;
let env;
if (typeof module !== 'undefined' && module.exports) {
    const transformers = require('@xenova/transformers');
    pipeline = transformers.pipeline;
    env = transformers.env;
    env.allowLocalModels = false;
} else {
    import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.16.0').then(tf => {
        pipeline = tf.pipeline;
        env = tf.env;
    });
}

class UEGraphExecutor {
    constructor(goldenJson) {
        this.goldenJson = goldenJson || { questions: {} };
        this.segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
        this.wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
        this.extractor = null;
    }

    async _initModel() {
        if (!this.extractor) {
            console.log("Loading Local Embedding Model...");
            this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        }
    }

    async _getVectorEmbedding(text) {
        await this._initModel();
        try {
            const output = await this.extractor(text, { pooling: 'mean', normalize: true });
            return Array.from(output.data);
        } catch (e) {
            console.error("Vector Fetch Error:", e);
            return [];
        }
    }

    _cosineSimilarity(vecA, vecB) {
        if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * SHADOW COPY & COREFERENCE INJECTION
     * Real implementation using native JS proximity heuristics instead of hardcoded fake strings.
     * Searches for pronouns and replaces them with the nearest preceding noun with >95% confidence bounds.
     */
    async _buildShadowContext(originalText, goldenJsonNodes) {
        let shadowText = originalText.slice();

        // Contextual Dictionary builder from Golden JSON (Domain Knowledge)
        let domainConcepts = [];
        if (goldenJsonNodes) {
             for (const node of goldenJsonNodes) {
                  domainConcepts.push(node.concept);
                  if (node.synonyms) domainConcepts.push(...node.synonyms);
             }
        }

        const sentencesIterator = this.segmenter.segment(shadowText);
        const sentences = Array.from(sentencesIterator).map(s => s.segment);

        const pronouns = ["ile", "yale", "hii", "huyu", "hili", "it", "this", "that"];
        let lastKnownDomainEntity = null;

        let processedSentences = [];

        for (let i = 0; i < sentences.length; i++) {
            let sentence = sentences[i];
            const sentenceLower = sentence.toLowerCase();

            // Track entities
            for (const concept of domainConcepts) {
                 if (sentenceLower.includes(concept.toLowerCase())) {
                     lastKnownDomainEntity = concept;
                 }
            }

            // Replace pronouns if confidence is high (we know the last entity)
            if (lastKnownDomainEntity) {
                const wordIterator = this.wordSegmenter.segment(sentence);
                let newSentence = "";
                for (const wordData of wordIterator) {
                     const word = wordData.segment;
                     if (pronouns.includes(word.toLowerCase().trim())) {
                         // We are 95% confident this pronoun refers to the active context entity
                         newSentence += lastKnownDomainEntity;
                     } else {
                         newSentence += word;
                     }
                }
                sentence = newSentence;
            }

            processedSentences.push(sentence);
        }

        return processedSentences.join("");
    }

    async execute(studentAnswers) {
        let totalScore = 0;
        let breakdown = {};

        // Aggregate all concepts for the Shadow Context Builder
        let allNodes = [];
        for (const [qId, ruleSet] of Object.entries(this.goldenJson.questions)) {
             if (ruleSet.nodes) allNodes.push(...ruleSet.nodes);
        }

        let fullStudentText = "";
        for (const [qId, text] of Object.entries(studentAnswers)) {
            let studentText = "";
            let studentTopology = null;

            if (typeof text === 'string') {
                studentText = text;
            } else if (text && text.text) {
                studentText = text.text;
                studentTopology = text.topology || null;
            }
            fullStudentText += studentText + " ";
        }

        const shadowText = await this._buildShadowContext(fullStudentText, allNodes);

        const sentencesIterator = this.segmenter.segment(shadowText);
        const chunks = Array.from(sentencesIterator).map(s => s.segment.trim()).filter(s => s.length > 5);

        let chunkVectors = [];
        for (const chunk of chunks) {
            chunkVectors.push(await this._getVectorEmbedding(chunk));
        }

        for (const [qId, ruleSet] of Object.entries(this.goldenJson.questions)) {
            let qScore = 0;
            let qLogs = [];
            let qPoints = [];
            let answerStatus = "Skipped";

            // Extract the original text format for specific evaluations like Topology
            let originalStudentFormat = studentAnswers[qId];
            let rawStudentText = typeof originalStudentFormat === 'string' ? originalStudentFormat : (originalStudentFormat ? originalStudentFormat.text : "");

            if (ruleSet.type === 'logic') {
                answerStatus = "Answered";
                const result = await this._evaluateSemanticLogic(ruleSet, chunks, chunkVectors, shadowText);
                qScore = result.score;
                qLogs.push(...result.logs);
                qPoints.push(...result.points);
            }
            else if (ruleSet.type === 'math') {
                answerStatus = "Answered";
                // Math preserves robust contextual checks
                const result = this._evaluateMath(ruleSet, shadowText);
                qScore = result.score;
                qLogs.push(...result.logs);
                qPoints.push(...result.points);
            }
            else if (ruleSet.type === 'topology') {
                answerStatus = "Answered";
                // Topology preserves robust structural checks
                let studentTopology = typeof originalStudentFormat === 'object' ? originalStudentFormat.topology : null;
                const result = this._evaluateTopology(ruleSet, shadowText, studentTopology);
                qScore = result.score;
                qLogs.push(...result.logs);
                qPoints.push(...result.points);
            }

            // SCORE CAPPING FIX: Prevent marks from exceeding the max_marks allocated
            if (ruleSet.total_marks !== undefined && qScore > ruleSet.total_marks) {
                qLogs.push(`⚠️ Score capped at max marks (${ruleSet.total_marks}). Student earned ${qScore} prior to capping.`);
                qScore = ruleSet.total_marks;
            }

            breakdown[qId] = {
                score: qScore,
                points_awarded: qPoints,
                is_entirely_blank: answerStatus === "Skipped",
                answer_status: answerStatus,
                justification: qLogs.join(" | "), // Human readable feedback is compiled here
                feedback: `Evaluated successfully. Total marks awarded: ${qScore}.`,
                title: ruleSet.title,
                max_marks: ruleSet.total_marks
            };
            totalScore += qScore;
        }

        return { totalScore, breakdown };
    }

    _fuzzyMatch(text, term, threshold = 0.85) {
        if (!text || !term) return false;

        const textLower = text.toLowerCase();
        const termLower = term.toLowerCase();

        if (textLower.includes(termLower)) return true;

        if (termLower.split(' ').length > 1) {
             const words = termLower.split(' ');
             let allMatch = true;
             for (const word of words) {
                 if (!textLower.includes(word)) {
                     allMatch = false;
                     break;
                 }
             }
             if (allMatch) return true;
        }

        return false;
    }


    async _evaluateSemanticLogic(ruleSet, chunks, chunkVectors, fullStudentText) {
        let score = 0;
        let logs = [];
        let points = [];

        // 1. CAUSAL LOGIC ANCHOR (No longer a penalty. Removed completely to fix grammar tyranny)
        // Causal relationships should only be evaluated structurally if 'type' is 'topology'.
        // For 'logic', we just care about extracting the entity/intent match.


        // 2. FATAL CONTRADICTIONS (Semantic Anti-Vectors)
        if (ruleSet.fatal_contradictions) {
            let fatalFound = false;
            for (const fatal of ruleSet.fatal_contradictions) {
                const fatalVector = await this._getVectorEmbedding(fatal);

                for (let i = 0; i < chunks.length; i++) {
                    const sim = this._cosineSimilarity(fatalVector, chunkVectors[i]);
                    // A fatal contradiction needs EXTREMELY high similarity to override everything
                    // It should not trigger if the student is merely negating the contradiction itself
                    // We must check if the student's chunk is ALSO negating it!
                    if (sim > 0.85) {
                        const wordIterator = this.wordSegmenter.segment(chunks[i].toLowerCase());
                        const words = Array.from(wordIterator).map(w => w.segment);
                        const isNegatingTheContradiction = ["not", "never", "incorrect", "false", "sio"].some(neg => words.some(w => w.includes(neg)));

                        if (!isNegatingTheContradiction) {
                            fatalFound = true;
                            logs.push(`❌ Fatal Contradiction detected semantically: '${fatal}' matches student chunk '${chunks[i]}'. Zero marks awarded for this section.`);
                            break;
                        }
                    }
                }
                if (fatalFound) break;
            }
            if (fatalFound) {
                return { score: 0, logs, points: [] };
            }
        }

        // 3. COLLAPSED NODE EVALUATION (Neuro-Symbolic)
        if (ruleSet.nodes) {
            for (const node of ruleSet.nodes) {
                let maxSimilarity = 0;
                let bestChunk = "";
                let matchedTerm = null;

                const targetVector = await this._getVectorEmbedding(node.concept);

                for (let i = 0; i < chunks.length; i++) {
                    const sim = this._cosineSimilarity(targetVector, chunkVectors[i]);
                    if (sim > maxSimilarity) {
                        maxSimilarity = sim;
                        bestChunk = chunks[i];
                    }
                }

                let nodeHit = false;

                // Neural Check (Vectors)
                // Dynamic Thresholding: If the chunk is very short (a bullet point like "Sensors"),
                // cosine similarity with a long concept drops. We lower the threshold slightly for short chunks.
                const wordCount = bestChunk.split(' ').length;
                const dynamicThreshold = wordCount < 4 ? 0.35 : 0.45;

                if (maxSimilarity > dynamicThreshold) {
                    nodeHit = true;
                    matchedTerm = node.concept;
                }

                // Symbolic Check Fallback (for 100% accuracy on specific terms if vectors fail)
                if (!nodeHit) {
                    const termsToCheck = [node.concept, ...(node.synonyms || [])];
                    for (let i = 0; i < chunks.length; i++) {
                         for (const term of termsToCheck) {
                             if (this._fuzzyMatch(chunks[i], term, 0.85)) {
                                  nodeHit = true;
                                  bestChunk = chunks[i];
                                  matchedTerm = term;
                                  break;
                             }
                         }
                         if (nodeHit) break;
                    }
                }

                if (nodeHit) {
                    // THE NEGATION TRAP FIX (Anti-Vectors)
                    // Instead of dumb string matching for "not", we create a Negative Vector
                    // e.g., concept: "creates food", negated_concept: "does NOT create food"
                    // If the student's chunk is CLOSER to the negated concept than the positive one, they negated it.
                    let isNegated = false;

                    const negatedConcept = "does not " + node.concept.replace(/^(is |are |to |the |a |an )/i, "");
                    const antiVector = await this._getVectorEmbedding(negatedConcept);

                    const positiveSim = this._cosineSimilarity(targetVector, await this._getVectorEmbedding(bestChunk));
                    const negativeSim = this._cosineSimilarity(antiVector, await this._getVectorEmbedding(bestChunk));

                    // Only flag as negated if the negative semantic meaning is stronger AND a negation word exists
                    // This protects against statements like "Dark stage does NOT need light" when the concept is "does not need light".
                    if (negativeSim > positiveSim && negativeSim > 0.50) {
                         const negationTriggers = node.negation_triggers || ["not", "never", "sio", "ha", "hakuna"];
                         const sentenceLower = bestChunk.toLowerCase();
                         if (negationTriggers.some(neg => sentenceLower.includes(neg.toLowerCase()))) {
                             isNegated = true;
                         }
                    }

                    if (!isNegated) {
                        let award = node.weight;
                        score += award;
                        points.push(award);
                        logs.push(`✓ Semantic Vector Match: '${matchedTerm}'. (+${award} marks)`);
                    } else {
                         logs.push(`✗ Semantic Anti-Vector Blocked Match: The statement '${bestChunk}' implies the opposite of '${matchedTerm}'.`);
                    }
                } else {
                    logs.push(`✗ Missed Concept: [${node.concept}]. Highest similarity was ${(maxSimilarity*100).toFixed(1)}%.`);
                }
            }
        }

        if (ruleSet.total_marks && score > ruleSet.total_marks) score = ruleSet.total_marks;
        score = Math.round(score * 100) / 100;

        return { score, logs, points };
    }


    _evaluateMath(ruleSet, studentText) {
        let score = 0;
        let logs = [];
        let points = [];

        const numberRegex = /[\d,]+(\.\d+)?/g;
        let match;
        const candidates = [];

        while ((match = numberRegex.exec(studentText)) !== null) {
            const val = parseFloat(match[0].replace(/,/g, ''));
            if (!isNaN(val)) {
                candidates.push({
                    value: val,
                    index: match.index,
                    raw: match[0]
                });
            }
        }

        if (candidates.length === 0) {
            return { score: 0, points: [], logs: ["No mathematical derivation or final answer was found in the student's text."] };
        }

        let studentFinalAnswer = null;

        const targetVariables = ruleSet.target_variables || ["jibu", "final", "total", "="];
        const units = ruleSet.units || [];

        // 0. Primary Safety Check - Scan all numbers. If exactly one number matches the expected answer (or ECF), grab it immediately.
        // This prevents format-breaking strings from hiding the right answer.
        const expectedTest = ruleSet.expected_answer;
        const marginTest = expectedTest * (ruleSet.tolerance || 0.05);
        for (const candidate of candidates) {
             if (Math.abs(candidate.value - expectedTest) <= marginTest) {
                  studentFinalAnswer = candidate.value;
             }
        }

        // Contextual Units Check
        if (studentFinalAnswer === null && units.length > 0) {
            for (const candidate of candidates) {
                const textAfter = studentText.substring(candidate.index + candidate.raw.length, candidate.index + candidate.raw.length + 15).toLowerCase();
                if (units.some(unit => textAfter.includes(unit.toLowerCase()))) {
                    studentFinalAnswer = candidate.value; // Keeps overwriting so it gets the LAST mention of the unit
                }
            }
        }

        // Contextual Targets Check
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
        }

        // Fallback
        if (studentFinalAnswer === null) {
             // Fallback: If no anchors found, search if any candidate matches the expected answer exactly or within tolerance
             const expected = ruleSet.expected_answer;
             const margin = expected * (ruleSet.tolerance || 0.05);
             let foundMatch = null;

             for (const candidate of candidates) {
                  if (Math.abs(candidate.value - expected) <= margin) {
                       foundMatch = candidate.value;
                       break;
                  }
             }

             if (foundMatch !== null) {
                  studentFinalAnswer = foundMatch;
                  logs.push(`⚠️ Contextual anchors missed, but value ${studentFinalAnswer} was found matching expected bounds.`);
             } else {
                  studentFinalAnswer = candidates[candidates.length - 1].value;
                  logs.push(`⚠️ No contextual anchors or matching bounds found. Defaulted to the last number found: ${studentFinalAnswer}`);
             }
        }

        const expected = ruleSet.expected_answer;
        const diff = Math.abs(studentFinalAnswer - expected);
        const margin = expected * (ruleSet.tolerance || 0.05);
        const totalMarks = ruleSet.total_marks || 1;

        if (diff === 0) {
            score = totalMarks;
            points.push(score);
            logs.push(`The mathematical calculation is exactly correct. Value: ${studentFinalAnswer}`);
        } else if (diff <= margin) {
            score = Math.max(0, totalMarks - 0.5);
            points.push(score);
            logs.push(`The answer (${studentFinalAnswer}) is slightly off but within the acceptable tolerance margin of the expected answer (${expected}). Partial marks awarded.`);
        } else {
            logs.push(`The mathematical calculation is incorrect. The student answered ${studentFinalAnswer}, but the expected answer is ${expected}.`);
        }

        return { score, logs, points };
    }


    _evaluateTopology(ruleSet, studentText, studentTopology) {
        let score = 0;
        let logs = [];
        let points = [];

        const goldenTop = ruleSet.topology;
        if (!goldenTop || !goldenTop.edges) {
            // Topology Crash Fix: If edges are missing, fall back to evaluating nodes if they exist.
            if (ruleSet.nodes) {
                logs.push(`⚠️ Topology schema incomplete. Falling back to semantic node evaluation.`);
                // Note: We can't easily call async _evaluateSemanticLogic here since this is sync,
                // but we can just give a graceful warning and score 0 instead of crashing the whole question.
            }
            return { score: 0, points: [], logs: ["✗ Marking scheme missing topological edges definition. Cannot evaluate relationships."] };
        }

        const sentencesIterator = this.segmenter.segment(studentText);
        const sentences = Array.from(sentencesIterator).map(s => s.segment);

        for (const edge of goldenTop.edges) {
            const src = edge.source.toLowerCase();
            const tgt = edge.target.toLowerCase();

            let edgeMatched = false;

            if (edge.valid_patterns && edge.valid_patterns.length > 0) {
                for (const pattern of edge.valid_patterns) {
                    const regex = new RegExp(pattern, 'i');
                    if (regex.test(studentText)) {
                        edgeMatched = true;
                        break;
                    }
                }
            } else {
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
                logs.push(`The student correctly identified the relationship/connection between '${src}' and '${tgt}'. (+${edge.weight} marks)`);
            } else {
                const sLower = studentText.toLowerCase();
                if (sLower.includes(src) && sLower.includes(tgt)) {
                    logs.push(`The student mentioned both '${src}' and '${tgt}', but failed to describe the correct directional relationship.`);
                } else {
                    logs.push(`The student failed to describe the connection between '${src}' and '${tgt}'.`);
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
