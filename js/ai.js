// js/ai.js
// Playbook Central Intelligence Engine (Client-Side Distributed Processing)

const API_URL = "https://openrouter.ai/api/v1/chat/completions";

const PASS1_SYSTEM_PROMPT = `
You are the Master Segmenter for an Examination Board. Your job is to extract the student's identity and transcribe their answers from the provided exam document, mapping each answer to its corresponding question from the marking scheme.

*** MANDATE ***
You must analyze the student's exam and segment their answers based on the provided marking scheme. You will return a JSON object with the student's identity and an array of their transcribed answers.

*** INSTRUCTIONS ***
1. Identify the student's name and registration number.
2. For EVERY question listed in the marking scheme, check if the student attempted it.
3. If they attempted it, transcribe their exact text/math/steps as accurately as possible. For diagrams, describe the diagram's labels and structural logic in text.
4. If they skipped the question, set 'answer_status' to 'Skipped'.
5. Identify the maximum number of items the student is explicitly asked to provide (e.g., 'Name 5 sensors' = 5). Store this as 'expected_number_of_items'. Do NOT count the total number of possible valid options listed in the rubric. If the rubric lists 17 options but the question asks for 5 (or max marks is 5), the expected number is 5.
6. ONLY output valid JSON using the exact schema below. No markdown formatting.

*** SCHEMA ***
{
  "studentName": "Extracted Name or 'Unknown'",
  "registrationNumber": "Extracted ID or 'Unknown'",
  "questions": [
    {
      "questionId": "1a",
      "section": "Section name if applicable, else 'General'",
      "max_marks": 5,
      "expected_number_of_items": 4,
      "answer_status": "Answered | Skipped",
      "student_answer_transcription": "The student wrote: '...'"
    }
  ]
}
`;

const PASS2_SYSTEM_PROMPT = `
You are the Chief Evaluator for an Examination Board. You are tasked with grading exactly ONE question for ONE student.

*** THE 4 TIERS OF EVALUATION (GRADING CONSTRAINTS) ***
Tier 1: Semantic Equivalence: Evaluate based on meaning, not exact keyword matching.
Tier 2: Proportional Math: Assign partial credit correctly based on the provided scheme.
Tier 3: The Fatal Flaw Rule: Fundamental violations of scientific/logical facts mean zero marks for that specific concept.
Tier 4: Diagram Amnesty: Evaluate text descriptions of diagrams based on labels/structural logic over artistic quality.

*** HARDENED GRADING RULES ***
1. ANTI-FABRICATION RULE: NEVER fabricate or hallucinate student errors. If a student's calculation or step perfectly matches the rubric, you MUST award the full marks for that scoring unit. Do not invent missing steps to justify a lower score.
2. BLANK ANSWER HANDLING: If the student's answer is completely blank or missing, you MUST still output valid JSON containing the step-by-step thinking explaining that the answer is missing. Immediately output a score of 0 with the reasoning 'No answer provided'. Do not attempt to evaluate and do not crash.

*** ANTI-HALLUCINATION GUARDRAIL (DECOUPLED ARITHMETIC) ***
Do NOT perform arithmetic or calculate a final score. You must strictly output the raw count of correct scoring items the student provided. The system will handle the mathematical division and scaling automatically. Do not mention formulas in your justification.
CRITICAL: The number you output for total_correct_points_found MUST perfectly match the number of correct items you mention in your feedback text. Do not output 1 if you textually state the student found 3.
If the student's answer is blank, output 'is_entirely_blank': true.

*** THE "MICRO-LESSON" FEEDBACK PROTOCOL ***
Your "constructive_feedback" MUST be short and directly actionable. Use this exact formula: [Acknowledge what they got right] + [State the EXACT missing scientific fact from the rubric] + [Actionable micro-lesson].

*** SCHEMA ***
You MUST output ONLY valid JSON using the schema below. No markdown formatting.

{
  "justification": "The rubric requires X and the student provided X but missed Y. The student successfully hit 3 scoring units.",
  "total_correct_points_found": 3,
  "is_entirely_blank": false,
  "constructive_feedback": "You correctly identified X. However, you missed Y. Always remember to check Z."
}
`;

// Helper: Parse exam instructions for section-specific rules
function parseSectionRules(examInstructions) {
    const rules = {};
    if (!examInstructions || typeof examInstructions !== 'string') return rules;

    // Match formats like "Section B: answer 2" or "Section B: Answer 2 of 3"
    const format1 = /Section\s+([A-Z0-9]+)[\s:,-]+(?:answer|choose|pick|attempt|do)[\sA-Za-z]*(\d+)/gi;

    // Match formats like "Answer only 2 questions in Section B"
    const format2 = /(?:answer|choose|pick|attempt|do)[\sA-Za-z]*(\d+)[\sA-Za-z]*(?:in|from|of)\s+Section\s+([A-Z0-9]+)/gi;

    // Match global formats like "Answer 2 questions" or "Attempt 3" that apply to the whole exam
    const formatGlobal = /(?:answer|choose|pick|attempt|do)[\sA-Za-z]*(\d+)(?![\sA-Za-z]*(?:in|from|of)\s+Section)/gi;

    let match;
    while ((match = format1.exec(examInstructions)) !== null) {
        rules[match[1].toUpperCase()] = parseInt(match[2], 10);
    }

    while ((match = format2.exec(examInstructions)) !== null) {
        rules[match[2].toUpperCase()] = parseInt(match[1], 10);
    }

    // Process global rules
    while ((match = formatGlobal.exec(examInstructions)) !== null) {
        // If a global rule is found, we assign it to the 'GENERAL' section
        // to match how general questions without sections are handled.
        // We only set it if not already set, or take the strictest (lowest number).
        const limit = parseInt(match[1], 10);
        if (!rules["GENERAL"] || limit < rules["GENERAL"]) {
            rules["GENERAL"] = limit;
        }
    }

    return rules;
}

// Helper: Dumb Aggregator (Reduce Phase)
function calculateDeterministicScores(extractedData, examInstructions, maxScoreParam = 100) {
    if (!extractedData || !extractedData.questions) return extractedData;

    extractedData.questions.forEach(q => {
        if (q.answer_status === "Skipped" || q.is_entirely_blank) {
            q.marks_awarded = 0;
            q.score = 0;
        } else {
            const maxMarksRaw = q.max_marks !== undefined ? q.max_marks : (q.max !== undefined ? q.max : (q.maxScore !== undefined ? q.maxScore : 1));
            const maxMarks = parseFloat(maxMarksRaw) || 1;
            q.max_marks = maxMarks;

            const expectedItems = parseFloat(q.expected_number_of_items) || maxMarks;
            let correctPoints = parseFloat(q.total_correct_points_found) || 0;

            let aiScore = Math.min(correctPoints / expectedItems, 1.0) * maxMarks;

            // Hard Ceiling Enforcement
            q.score = aiScore;
            q.marks_awarded = Math.min(Math.round(aiScore * 100) / 100, maxMarks);
        }
    });

    // --- GREEDY BEST-SCORE ALGORITHM (Section Logic) ---
    const sectionRules = parseSectionRules(examInstructions);

    // Group questions by section
    const sections = {};
    extractedData.questions.forEach(q => {
        // Extract section from "Section A", "A", etc. Default to "GENERAL"
        let secName = "GENERAL";
        if (q.section) {
            // Remove the word "Section" if present to grab the actual identifier
            const normalized = q.section.replace(/section/i, '').trim();
            const secMatch = normalized.match(/([A-Z0-9]+)/i);
            if (secMatch) secName = secMatch[1].toUpperCase();
        }
        if (!sections[secName]) sections[secName] = [];
        sections[secName].push(q);
    });

    let totalScore = 0;

    // Apply rules per section
    for (const [secName, qs] of Object.entries(sections)) {
        let attemptedQs = qs.filter(q => q.answer_status !== "Skipped" && q.marks_awarded > 0);

        if (sectionRules[secName] && attemptedQs.length > sectionRules[secName]) {
            // Student over-answered in this specific section. Sort by marks_awarded descending.
            attemptedQs.sort((a, b) => b.marks_awarded - a.marks_awarded);

            const allowedAnswers = sectionRules[secName];
            const droppedQuestions = attemptedQs.slice(allowedAnswers);

            // Reset marks for dropped questions
            droppedQuestions.forEach(q => {
                q.marks_awarded = 0;
                if (q.constructive_feedback) {
                    q.constructive_feedback = "(Dropped: " + q.constructive_feedback + ")";
                } else {
                    q.constructive_feedback = "(Dropped)";
                }
            });
        }

        // Sum up this section
        totalScore += qs.reduce((sum, q) => sum + (q.marks_awarded || 0), 0);
    }

    extractedData.totalScore = totalScore;
    extractedData.maxScore = maxScoreParam; // Ensure max score is passed through

    return extractedData;
}

async function getSecureKey() {
    try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) throw new Error("No active session.");

        const userProfile = await window.PlaybookDB.getUserById(session.user.id);
        const secret = await window.PlaybookDB.getInstitutionSecret(userProfile.institution_id);

        if (!secret || !secret.openrouter_api_key) {
            throw new Error("No OpenRouter API key found in the secure vault. Ask an Admin to configure it.");
        }
        return secret.openrouter_api_key;
    } catch (e) {
        throw new Error(`Authorization failed: ${e.message}`);
    }
}

// Helper function for exponential backoff delay
const delay = ms => new Promise(res => setTimeout(res, ms));

// Helper to parse LLM JSON output robustly
function parseLLMJSON(content) {
    if (!content || content.trim() === '') {
        return { is_entirely_blank: true, justification: "No step-by-step thinking provided", total_correct_points_found: 0 };
    }

    if (content.startsWith('```json')) content = content.replace(/^```json\n|\n```$/g, '');
    else if (content.startsWith('```')) content = content.replace(/^```\n|\n```$/g, '');

    content = content.replace(/(?<!\\)\\(?!["\\/n])/g, '\\\\');

    try {
        return JSON.parse(content);
    } catch (e) {
        console.warn("JSON parse failed, attempting automatic fallback repair for truncated JSON:", e.message);
        let repairedContent = content;
        let stack = [];
        let inString = false;
        let escapeNext = false;

        for (let i = 0; i < repairedContent.length; i++) {
            const char = repairedContent[i];
            if (escapeNext) {
                escapeNext = false;
                continue;
            }
            if (char === '\\') {
                escapeNext = true;
                continue;
            }
            if (char === '"') {
                inString = !inString;
                continue;
            }
            if (!inString) {
                if (char === '{') stack.push('}');
                else if (char === '[') stack.push(']');
                else if (char === '}' || char === ']') stack.pop();
            }
        }

        let dropIndex = repairedContent.length;
        let insideStr = inString;

        // Scan backwards to drop anything up to the last structural boundary
        for (let i = repairedContent.length - 1; i >= 0; i--) {
            const char = repairedContent[i];
            if (char === '"' && (i === 0 || repairedContent[i-1] !== '\\')) {
                insideStr = !insideStr;
                continue;
            }
            if (!insideStr) {
                if (char === ',') {
                    dropIndex = i;
                    break;
                }
                if (char === '{' || char === '[' || char === '}' || char === ']') {
                    dropIndex = i + 1;
                    break;
                }
            }
        }

        repairedContent = repairedContent.substring(0, dropIndex);

        // A very truncated JSON might end up just being `{` or `[{`.
        // Let's strip out trailing characters that are strictly invalid unquoted keys before closing.
        // E.g., if we dropped a comma, we might end up with `{"score": 5, "justif` where "justif" isn't closed.
        // Wait, the backward scan drops the comma, leaving `{"score": 5`. That's clean.
        // What if it ends up with `{"justification": `? The colon is not structural in the scan above,
        // so it might leave `{"justification":`.
        // Let's add colon to the safe boundaries to scan past, NO, a trailing colon is invalid JSON.
        // We need to drop the whole key if there is no value.
        // A better approach for severely truncated JSON ending in `{"key": ` or `{"key"`:
        // Let's just aggressively drop everything after the last valid value separator (comma, brace, bracket).
        // Actually, the previous loop handles commas and braces well.

        // Handle unquoted key remnants by doing a secondary cleanup:
        // Strip trailing whitespace, colons, or partial string fragments
        repairedContent = repairedContent.replace(/(,\s*|:\s*|"\w*\s*)$/, '');

        while (stack.length > 0) {
            repairedContent += stack.pop();
        }

        try {
            return JSON.parse(repairedContent);
        } catch (e2) {
            // Ultimate fallback for completely shattered JSON objects
            console.error("Advanced JSON repair failed.", e2.message);
            throw new Error("JSON parse failed completely");
        }
    }
}

// Simple Concurrency Semaphore (Promise Pool)
class Semaphore {
    constructor(maxConcurrent) {
        this.maxConcurrent = maxConcurrent;
        this.currentConcurrent = 0;
        this.queue = [];
    }

    async acquire() {
        if (this.currentConcurrent < this.maxConcurrent) {
            this.currentConcurrent++;
            return Promise.resolve();
        }

        return new Promise(resolve => {
            this.queue.push(resolve);
        });
    }

    release() {
        this.currentConcurrent--;
        if (this.queue.length > 0) {
            this.currentConcurrent++;
            const resolve = this.queue.shift();
            resolve();
        }
    }
}

// Pass 2: Single-Question Grading
async function gradeSingleQuestion(apiKey, questionData, markingSchemeText) {
    let attempt = 0;
    const maxRetries = 5;
    while (attempt < maxRetries) {
        try {
            const promptText = `Marking Scheme for context:\n${markingSchemeText}\n\nEvaluate the following student's answer for Question ${questionData.questionId}:\nMax Marks: ${questionData.max_marks}\nAnswer: ${questionData.student_answer_transcription}`;

            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'google/gemini-2.0-flash-001',
                    temperature: 0.0,
                    top_p: 0.1,
                    seed: 42,
                    messages: [
                        { role: 'system', content: PASS2_SYSTEM_PROMPT },
                        { role: 'user', content: promptText }
                    ],
                    response_format: { type: "json_object" }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
            }

            const data = await response.json();
            const parsed = parseLLMJSON(data.choices[0].message.content);

            if (parsed.total_correct_points_found === undefined && parsed.is_entirely_blank === undefined) {
                throw new Error("Invalid LLM response format: missing total_correct_points_found or is_entirely_blank");
            }

            return {
                ...questionData,
                total_correct_points_found: parsed.total_correct_points_found !== undefined ? parsed.total_correct_points_found : 0,
                is_entirely_blank: parsed.is_entirely_blank || false,
                justification: parsed.justification || "No justification provided.",
                constructive_feedback: parsed.constructive_feedback || "Review rubric.",
                criteria_evaluations: [] // Nullified by new architecture
            };

        } catch (error) {
            attempt++;
            console.warn(`[Invisible Retry] gradeSingleQuestion attempt ${attempt} failed for Question ${questionData.questionId}:`, error.message);
            if (attempt >= maxRetries) {
                console.error(`Failed to grade question ${questionData.questionId} after ${maxRetries} attempts:`, error);
                return { ...questionData, total_correct_points_found: 0, is_entirely_blank: true, justification: "Error grading.", constructive_feedback: "Error grading." };
            }
            await delay(attempt * 2000);
        }
    }
}

// Client-Side Distributed Grading Engine (Map-Reduce Architecture)
async function gradeBatchExams(base64PDF, markingSchemeText, examInstructions = "", maxScoreParam = 100, maxRetries = 3) {
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            const apiKey = await getSecureKey();

            // PASS 1: THE SEGMENTATION MAP
            let promptText = `Here is the marking scheme:\n${markingSchemeText}\n\n`;
            const userContent = [];

            if (typeof base64PDF === 'string') {
                promptText += `Here is the raw text of this single student's digital exam submission:\n\n---\n${base64PDF}\n---`;
                userContent.push({ type: "text", text: promptText });
            } else if (Array.isArray(base64PDF)) {
                promptText += `Here are the scanned pages of this single student's exam:`;
                userContent.push({ type: "text", text: promptText });
                base64PDF.forEach(imageUrl => {
                    userContent.push({
                        type: "image_url",
                        image_url: { url: imageUrl }
                    });
                });
            } else {
                throw new Error("Invalid input format for student exam data.");
            }

            const mapResponse = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'google/gemini-2.0-flash-001',
                    temperature: 0.0,
                    top_p: 0.1,
                    seed: 42,
                    max_tokens: 8192,
                    messages: [
                        { role: 'system', content: PASS1_SYSTEM_PROMPT },
                        { role: 'user', content: userContent }
                    ],
                    response_format: { type: "json_object" }
                })
            });

            if (!mapResponse.ok) {
                const errorText = await mapResponse.text();
                throw new Error(`OpenRouter API error in Pass 1: ${mapResponse.status} ${errorText}`);
            }

            const mapData = await mapResponse.json();
            let parsedMap = parseLLMJSON(mapData.choices[0].message.content);

            if (parsedMap.students && Array.isArray(parsedMap.students)) {
                parsedMap = parsedMap.students[0];
            }

            // PASS 2: PARALLEL QUESTION PROCESSING (The "Brain")
            const questions = parsedMap.questions || [];
            const semaphore = new Semaphore(10); // Throttle to 10 concurrent requests

            const gradingPromises = questions.map(async (q) => {
                if (q.answer_status === "Skipped") {
                    return {
                        ...q,
                        is_entirely_blank: true,
                        total_correct_points_found: 0,
                        justification: "No answer provided",
                        constructive_feedback: "No answer provided"
                    };
                }

                await semaphore.acquire();
                try {
                    return await gradeSingleQuestion(apiKey, q, markingSchemeText);
                } finally {
                    semaphore.release();
                }
            });

            const gradedQuestions = await Promise.all(gradingPromises);
            parsedMap.questions = gradedQuestions;

            // PASS 3: THE DUMB AGGREGATOR (The "Reduce" Phase)
            const finalData = calculateDeterministicScores(parsedMap, examInstructions, maxScoreParam);

            return [finalData];

        } catch (error) {
            attempt++;
            console.warn(`Playbook Engine Attempt ${attempt} failed: ${error.message}`);

            if (attempt >= maxRetries) {
                console.error("Error in Playbook grading engine (All retries exhausted):", error);
                throw error;
            }

            const backoffTime = attempt * 3000;
            console.log(`Self-Healing Loop activated: Retrying in ${backoffTime / 1000} seconds...`);
            await delay(backoffTime);
        }
    }
}

        // Optimization Prompt for Pre-processing
        const OPTIMIZE_PROMPT = `
You are an elite educational engineer. Rewrite this raw marking scheme into the strict "Playbook Standard Format".

CRITICAL MANDATES:

1. NO DATA LOSS: Preserve every alternative answer and exact mark allocation.
2. STRICT HIERARCHY: Every single question/sub-question MUST have its own block. Do not merge sub-questions.
3. ATOMIC CRITERIA: Break down paragraph answers into explicit, atomic, true/false grading criteria. Each criterion must represent exactly one independently gradable concept.
4. Output ONLY the structured text. No markdown block wrapping (\`\`\`).

=== PLAYBOOK STANDARD FORMAT EXAMPLE ===
Question 1a: Definition (Max: 3 marks)

Criterion_1: States "conversion of light energy to chemical energy" (1 mark)
Criterion_2: Explicitly writes "Chlorophyll" (1 mark)
Criterion_3: Mentions "Water" (1 mark)

Question 1b: Diagram (Max: 2 marks)

Criterion_1: A leaf shape is clearly drawn (1 mark)
Criterion_2: An arrow is drawn pointing into the leaf and is labeled "Sunlight" (1 mark)
=========================================
`;

        async function optimizeMarkingScheme(rawText, maxRetries = 3) {
            let attempt = 0;
            while (attempt < maxRetries) {
                try {
                    const apiKey = await getSecureKey();

                    const response = await fetch(API_URL, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${apiKey}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            model: 'google/gemini-2.0-flash-001',
                            temperature: 0.0,
                            top_p: 0.1,
                            seed: 42,
                            messages: [
                                {
                                    role: 'system',
                                    content: OPTIMIZE_PROMPT
                                },
                                {
                                    role: 'user',
                                    content: rawText
                                }
                            ]
                        })
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
                    }

                    const data = await response.json();
                    let content = data.choices[0].message.content;

                    if (content.startsWith('```')) {
                        content = content.replace(/^```[^\n]*\n|\n```$/g, '');
                    }
                    return content;
                } catch (error) {
                    attempt++;
                    console.warn(`Optimization Attempt ${attempt} failed: ${error.message}`);

                    if (attempt >= maxRetries) {
                        console.error("Error in Playbook optimization engine (All retries exhausted):", error);
                        throw error;
                    }

                    const backoffTime = attempt * 3000;
                    console.log(`Self-Healing Loop activated for optimization: Retrying in ${backoffTime / 1000} seconds...`);
                    await delay(backoffTime);
                }
            }
        }

// OCR Fallback for Scanned Marking Schemes
async function extractMarkingSchemeOCR(base64Images, maxRetries = 3) {
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            const apiKey = await getSecureKey();

            const userContent = [
                {
                    type: "text",
                    text: "Extract all text from these marking scheme images. Preserve the exact layout, question numbers, and point values. Do not add any conversational text, just output the extracted text."
                }
            ];

            base64Images.forEach(imageUrl => {
                userContent.push({
                    type: "image_url",
                    image_url: { url: imageUrl }
                });
            });

            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'google/gemini-2.0-flash-001',
                    temperature: 0.0,
                    top_p: 0.1,
                    seed: 42,
                    messages: [
                        { role: 'user', content: userContent }
                    ]
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
            }

            const data = await response.json();
            return data.choices[0].message.content;

        } catch (error) {
            attempt++;
            console.warn(`OCR Attempt ${attempt} failed: ${error.message}`);

            if (attempt >= maxRetries) {
                console.error("Error in Playbook OCR engine (All retries exhausted):", error);
                throw error;
            }

            const backoffTime = attempt * 3000;
            console.log(`Self-Healing Loop activated for OCR: Retrying in ${backoffTime / 1000} seconds...`);
            await delay(backoffTime);
        }
    }
}

// Export for both main thread and Web Worker environments
if (typeof window !== 'undefined') {
            window.PlaybookAI = { gradeBatchExams, optimizeMarkingScheme, extractMarkingSchemeOCR };
} else {
            self.PlaybookAI = { gradeBatchExams, optimizeMarkingScheme, extractMarkingSchemeOCR };
}