// js/ai.js
// Playbook Central Intelligence Engine (Client-Side Distributed Processing)

const API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const PASS1_SYSTEM_PROMPT = `
You are the Master Mapper for an Examination Board. Your job is to scan the provided exam document, extract the student's identity, and identify EVERY question from the marking scheme that the student attempted.

*** MANDATE ***
You must analyze the student's exam against the provided marking scheme. You will return a lightweight JSON object mapping out the student's exam structure. DO NOT TRANSCRIBE THE ANSWERS YET. Just state if they attempted the question or skipped it.

*** INSTRUCTIONS ***
1. Identify the student's name and registration number.
2. For EVERY question listed in the marking scheme, check if the student attempted it anywhere in their document.
3. Set 'answer_status' to 'Answered' if they wrote anything for it, otherwise 'Skipped'.
4. Identify the maximum number of items the student is explicitly asked to provide (e.g., 'Name 5 sensors' = 5). Store this as 'expected_number_of_items'. Do NOT count the total number of possible valid options listed in the rubric. If the rubric lists 17 options but the question asks for 5 (or max marks is 5), the expected number is 5.
5. ONLY output valid JSON using the exact schema below. Output ONLY raw JSON. No conversational text. No markdown blocks. Start your response with {
6. Do not use <think> tags.

*** SCHEMA ***
{
  "studentName": "Extracted Name or 'Unknown'",
  "registrationNumber": "Extracted ID or 'Unknown'",
  "questions": [
    {
      "questionId": "1a",
      "questionTitle": "A short 3-5 word summary of the question topic (e.g., 'Newton's First Law' or 'Define Hydroponics')",
      "section": "Section name if applicable, else 'General'",
      "max_marks": 5,
      "expected_number_of_items": 4,
      "answer_status": "Answered | Skipped"
    }
  ]
}
`;

const PASS1B_EXTRACTION_PROMPT = `
You are the Chief Transcriber for an Examination Board. You are tasked with locating and transcribing the student's answer for exactly ONE specific question.

*** ABSOLUTE LITERAL TRANSCRIPTION RULE ***
You MUST act as a literal transcriber. Find where the student answered the specific question requested, and quote their exact phrases, math, and steps exactly as written. DO NOT invent, assume, or inject terms from the marking scheme into the student's answer. If the student did not explicitly write it, you must not extract it. For diagrams, describe the diagram's labels and structural logic in text.

*** INSTRUCTIONS ***
1. Locate the student's answer for the specific Question ID provided by the user.
2. Transcribe their exact answer.
3. ONLY output valid JSON using the exact schema below. Output ONLY raw JSON. No conversational text. No markdown blocks. Start your response with {
4. Do not use <think> tags.

*** SCHEMA ***
{
  "student_answer_transcription": "The student wrote: '...'"
}
`;

const PASS2_SYSTEM_PROMPT = `
You are the Chief Evaluator for an Examination Board. You are tasked with grading exactly ONE question for ONE student.

*** THE 4 TIERS OF EVALUATION (GRADING CONSTRAINTS) ***
Tier 1: Strict Binary Logic: If the student's answer does not explicitly contain the exact concept or scientific fact defined in the rubric, give a 0. Do not give the benefit of the doubt. Do not guess.
Tier 2: Fact Extraction: Isolate specific, distinct correct statements the student made that directly match a scoring criterion in the rubric.
Tier 3: The Fatal Flaw Rule: Fundamental violations of scientific/logical facts mean zero marks for that specific concept.
Tier 4: Diagram Amnesty: Evaluate text descriptions of diagrams based on labels/structural logic over artistic quality.

*** HARDENED GRADING RULES ***
1. ANTI-FABRICATION RULE: NEVER fabricate or hallucinate student errors. If a student's calculation or step perfectly matches the rubric, you MUST award the full marks for that scoring unit. Do not invent missing steps to justify a lower score.
2. BLANK ANSWER HANDLING: If the student's answer is completely blank or missing, you MUST still output valid JSON containing the step-by-step thinking explaining that the answer is missing. Output an empty array for points_awarded. Do not attempt to evaluate and do not crash.
3. STRICT FATAL FLAW PENALTY: If a student's core definition or fundamental concept is explicitly wrong (e.g., defining an 'essential nutrient' when asked for a 'beneficial nutrient'), you MUST award 0 points for that entire conceptual block. Do not award partial credit for lucky guesses or examples if the foundational premise is incorrect.

*** STRICT SCORING GUARDRAIL ***
Do NOT perform final score arithmetic. Your ONLY job is to extract an array of specific, awarded points based on the rubric.
1. 'points_awarded': An array of floats. For EVERY distinct, correct rubric criterion the student successfully met, append the exact point value (mark) assigned to that criterion in the rubric.
Example: If the rubric awards 0.5 marks for "defined gravity" and 1.5 marks for "showed equation", and the student did both, output: [0.5, 1.5]. If they only defined gravity, output: [0.5].
Let the external system handle summing the array and clamping it to the max score.
If the student's answer is blank or completely wrong, output 'is_entirely_blank': true and 'points_awarded': [].
CRITICAL JSON RULE: You MUST use standard double quotes (") for all JSON keys and string boundaries. Use single quotes (') for quotes inside strings.
You must rigidly escape all backslashes and double quotes in student answers.
Do not use <think> tags.

*** THE "MICRO-LESSON" FEEDBACK PROTOCOL ***
Your "constructive_feedback" MUST be short and directly actionable. Use this exact formula: [Acknowledge what they got right] + [State the EXACT missing scientific fact from the rubric] + [Actionable micro-lesson].

*** SCHEMA ***
You MUST output ONLY valid JSON using the schema below. Output ONLY raw JSON. No conversational text. No markdown blocks. Start your response with {

{
  "justification": "The rubric requires X (worth 0.5 marks) and Y (worth 1.5 marks). The student provided X but missed Y...",
  "points_awarded": [0.5],
  "is_entirely_blank": false,
  "constructive_feedback": "You correctly identified X. However, you missed Y."
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
            // The new deterministic aggregator - math done securely in JS based on AI's explicitly awarded points array
            const maxMarksRaw = q.max_marks !== undefined ? q.max_marks : (q.max !== undefined ? q.max : 0);
            const maxMarks = Math.max(parseFloat(maxMarksRaw) || 0, 0); // Ensure it's never negative
            q.max_marks = maxMarks;

            let aiCalculatedMarks = 0;

            // Sum up the explicit points the AI awarded
            if (Array.isArray(q.points_awarded)) {
                aiCalculatedMarks = q.points_awarded.reduce((sum, point) => {
                    const val = parseFloat(point);
                    return sum + (isNaN(val) ? 0 : val);
                }, 0);
            } else if (q.total_correct_points_found !== undefined) {
                // Fallback for older JSON schema during transition
                let correctPointsFound = parseInt(q.total_correct_points_found, 10) || 0;
                const expectedItemsRaw = q.expected_number_of_items !== undefined ? q.expected_number_of_items : maxMarks;
                const expectedItems = Math.max(parseFloat(expectedItemsRaw) || maxMarks, 1);
                aiCalculatedMarks = (correctPointsFound / expectedItems) * maxMarks;
            }

            // Prevent NaN if math somehow fails
            aiCalculatedMarks = isNaN(aiCalculatedMarks) ? 0 : aiCalculatedMarks;

            // Fix floating point math anomalies (e.g. 0.1 + 0.2 = 0.30000004)
            aiCalculatedMarks = Math.round(aiCalculatedMarks * 100) / 100;

            // Re-assign back to marks_awarded_by_ai to preserve schema for downstream logic
            q.marks_awarded_by_ai = aiCalculatedMarks;
            
            // Hard Ceiling Enforcement (Never exceed max marks)
            let finalScore = Math.min(aiCalculatedMarks, maxMarks);
            
            q.score = finalScore;
            q.marks_awarded = finalScore;
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
        // Fallback for Playwright testing where userProfile might be missing or mocked
        const instId = userProfile ? userProfile.institution_id : session.institution_id;
        if (!instId) throw new Error("Institution ID not found.");

        const secret = await window.PlaybookDB.getInstitutionSecret(instId);

        if (!secret || !secret.gemini_api_key) {
            throw new Error("No Google AI Studio API key found in the secure vault. Ask an Admin to configure it.");
        }

        // Cache SiliconFlow key for synchronous use in ue_engine.js
        if (secret.siliconflow_api_key) {
            localStorage.setItem('PLAYBOOK_SILICONFLOW_API_KEY', secret.siliconflow_api_key);
        } else {
            localStorage.removeItem('PLAYBOOK_SILICONFLOW_API_KEY');
        }

        return secret.gemini_api_key;
    } catch (e) {
        // Fallback check for Playwright environment directly using a localStorage mocked API key if DB fails
        const mockEnv = localStorage.getItem('playbook_mock_api_key');
        if (mockEnv) return mockEnv;

        throw new Error(`Authorization failed: ${e.message}`);
    }
}

// Helper function for exponential backoff delay
const delay = ms => new Promise(res => setTimeout(res, ms));

// Helper to parse LLM JSON output robustly
function parseLLMJSON(content) {
    if (!content || content.trim() === '') {
        return { is_entirely_blank: true, justification: "No step-by-step thinking provided", marks_awarded: 0 };
    }

    // Preemptively strip <think> tags which cause JSON truncation
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, '');

    // Escape unescaped backslashes before attempting JSON.parse
    content = content.replace(/\\([^"\\\/bfnrtu])/g, '\\\\$1');

    // STEP 1: Extract ONLY the JSON object, ignoring any conversational filler text before or after
    // Custom brace-counting JSON extractor to guarantee perfect extraction
    let startIndex = content.indexOf('{');
    if (startIndex !== -1) {
        let depth = 0;
        let inString = false;
        let escapeNext = false;
        let endIndex = -1;

        for (let i = startIndex; i < content.length; i++) {
            const char = content[i];

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
                if (char === '{') {
                    depth++;
                } else if (char === '}') {
                    depth--;
                    if (depth === 0) {
                        endIndex = i;
                        break;
                    }
                }
            }
        }

        if (endIndex !== -1) {
            content = content.substring(startIndex, endIndex + 1);
        } else {
            // Truncated JSON detected (e.g. AI token limit reached before closing '}')
            content = content.substring(startIndex);
        }
    }

    // STEP 2: Safely strip markdown blocks (in case they were inside the matched block or around it)
    content = content.replace(/^```json\s*/gi, '').replace(/^```\s*/gi, '').replace(/```\s*$/gi, '');

    // STEP 3: THE FIX: Strip unescaped newlines and tabs that break JSON parsing
    content = content.replace(/[\n\r\t]+/g, ' ');

    // STEP 4: Handle single quotes used incorrectly as keys (e.g. {'justification': ...})
    content = content.replace(/([{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3');
    // Handle single quotes used incorrectly as string values
    content = content.replace(/(:\s*)'([^']+)'(\s*[,}])/g, '$1"$2"$3');

    // STEP 5: THE FIX: Safe trailing commas
    content = content.replace(/,\s*([}\]])/g, '$1');

    // STEP 6: THE FIX: Safe backslash escaping WITHOUT using Negative Lookbehinds
    content = content.replace(/\\(?!["\\/bfnrt])/g, '\\\\');

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

        // Handle unquoted key remnants by doing a secondary cleanup:
        // Strip trailing whitespace, colons, or partial string fragments
        repairedContent = repairedContent.replace(/(,\s*|:\s*|"\w*\s*)$/, '');

        if (inString) {
            repairedContent += '"';
        }

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

// Pass 1B: Single-Question Extraction
async function extractSingleQuestion(apiKey, questionId, userParts) {
    let attempt = 0;
    while (true) {
        try {
            const promptText = `Locate and transcribe the exact answer for Question ID: ${questionId}`;

            // Create a fresh copy of userParts to avoid mutating the original array across parallel calls
            const currentParts = [...userParts, { text: promptText }];

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 120000);

            let response;
            try {
                response = await fetch(`${API_URL}/gemini-2.5-pro:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        systemInstruction: { parts: [{ text: PASS1B_EXTRACTION_PROMPT }] },
                        contents: [{ role: "user", parts: currentParts }],
                        generationConfig: {
                            temperature: 0.0,
                            maxOutputTokens: 8192,
                            responseMimeType: "application/json"
                        }
                    }),
                    signal: controller.signal
                });
            } finally {
                clearTimeout(timeoutId);
            }

            if (!response.ok) {
                if (response.status === 429) throw new Error("Rate limit exceeded (429)");
                throw new Error(`Google AI Studio API error: ${response.status} ${await response.text()}`);
            }

            const data = await response.json();
            const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
            const parsed = parseLLMJSON(textContent);
            return parsed.student_answer_transcription || "No text extracted.";

        } catch (error) {
            attempt++;
            console.warn(`[Infinite Retry] extractSingleQuestion attempt ${attempt} failed for Question ${questionId}:`, error.message);
            if (attempt >= 3) {
                console.error(`Failed to extract Question ${questionId} after 3 attempts. Returning fallback.`);
                return "No text extracted.";
            }
            let backoffTime = 1000; // Fixed 1 second delay for Paid Tier
            await delay(backoffTime);
        }
    }
}

// Pass 2: Single-Question Grading
async function gradeSingleQuestion(apiKey, questionData, markingSchemeText) {
    let attempt = 0;

    while (true) {
        try {
            const promptText = `Marking Scheme for context:\n${markingSchemeText}\n\nEvaluate the following student's answer for Question ${questionData.questionId}:\nMax Marks: ${questionData.max_marks}\nAnswer: ${questionData.student_answer_transcription}`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s timeout

            let response;
            try {
                response = await fetch(`${API_URL}/gemini-2.5-pro:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        systemInstruction: {
                            parts: [{ text: PASS2_SYSTEM_PROMPT }]
                        },
                        contents: [{
                            role: "user",
                            parts: [{ text: promptText }]
                        }],
                        generationConfig: {
                            temperature: 0.0,
                            maxOutputTokens: 8192,
                            responseMimeType: "application/json"
                        }
                    }),
                    signal: controller.signal
                });
            } finally {
                clearTimeout(timeoutId);
            }

            if (!response.ok) {
                if (response.status === 429) {
                    throw new Error("Rate limit exceeded (429)");
                }
                const errorText = await response.text();
                throw new Error(`Google AI Studio API error: ${response.status} ${errorText}`);
            }

            const data = await response.json();
            const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
            const parsed = parseLLMJSON(textContent);

            if (parsed.points_awarded === undefined && parsed.total_correct_points_found === undefined && parsed.is_entirely_blank === undefined) {
                throw new Error("Invalid LLM response format: missing points_awarded or is_entirely_blank");
            }

            return {
                ...questionData,
                points_awarded: Array.isArray(parsed.points_awarded) ? parsed.points_awarded : [],
                total_correct_points_found: parsed.total_correct_points_found !== undefined ? parseInt(parsed.total_correct_points_found, 10) : undefined,
                is_entirely_blank: parsed.is_entirely_blank || false,
                justification: parsed.justification || "No justification provided.",
                constructive_feedback: parsed.constructive_feedback || "Review rubric.",
                criteria_evaluations: [] // Nullified by new architecture
            };

        } catch (error) {
            attempt++;
            console.warn(`[Infinite Retry] gradeSingleQuestion attempt ${attempt} failed for Question ${questionData.questionId}:`, error.message);
            
            if (attempt >= 3) {
                console.error(`Failed to grade Question ${questionData.questionId} after 3 attempts. Returning fallback.`);
                return {
                    ...questionData,
                    points_awarded: [],
                    total_correct_points_found: 0,
                    is_entirely_blank: true,
                    justification: "Error grading.",
                    constructive_feedback: "Failed to evaluate.",
                    criteria_evaluations: []
                };
            }

            let backoffTime = 1000; // Fixed 1 second delay for Paid Tier
            await delay(backoffTime);
        }
    }
}

// Client-Side Distributed Grading Engine (Map-Reduce Architecture)
async function gradeBatchExams(base64PDF, markingSchemeText, examInstructions = "", maxScoreParam = 100) {
    let attempt = 0;
    while (true) {
        try {
            const apiKey = await getSecureKey();

            // PASS 1: THE SEGMENTATION MAP
            let promptText = `Here is the marking scheme:\n${markingSchemeText}\n\n`;
            const userParts = [];

            if (typeof base64PDF === 'string') {
                promptText += `Here is the raw text of this single student's digital exam submission:\n\n---\n${base64PDF}\n---`;
                userParts.push({ text: promptText });
            } else if (Array.isArray(base64PDF)) {
                promptText += `Here are the scanned pages of this single student's exam:`;
                userParts.push({ text: promptText });
                base64PDF.forEach(imageUrl => {
                    // Extract mime type and base64 data from data URL
                    const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
                    if (matches) {
                        userParts.push({
                            inlineData: {
                                mimeType: matches[1],
                                data: matches[2]
                            }
                        });
                    }
                });
            } else {
                throw new Error("Invalid input format for student exam data.");
            }

            const mapResponse = await fetch(`${API_URL}/gemini-2.5-pro:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    systemInstruction: {
                        parts: [{ text: PASS1_SYSTEM_PROMPT }]
                    },
                    contents: [{
                        role: "user",
                        parts: userParts
                    }],
                    generationConfig: {
                        temperature: 0.0,
                        maxOutputTokens: 8192,
                        responseMimeType: "application/json"
                    }
                })
            });

            if (!mapResponse.ok) {
                const errorText = await mapResponse.text();
                throw new Error(`Google AI Studio API error in Pass 1: ${mapResponse.status} ${errorText}`);
            }

            const mapData = await mapResponse.json();
            const mapTextContent = mapData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
            let parsedMap = parseLLMJSON(mapTextContent);

            if (parsedMap.students && Array.isArray(parsedMap.students)) {
                parsedMap = parsedMap.students[0];
            }

            // PASS 1B & 2: PARALLEL EXTRACTION & GRADING PROCESSING (The "Brain")
            const questions = parsedMap.questions || [];
            const semaphore = new Semaphore(6); // Throttled to 6 for optimal speed without 429/503 errors

            const gradingPromises = questions.map(async (q) => {
                if (q.answer_status === "Skipped") {
                    return {
                        ...q,
                        is_entirely_blank: true,
                        marks_awarded_by_ai: 0,
                        justification: "No answer provided",
                        constructive_feedback: "No answer provided"
                    };
                }

                await semaphore.acquire();
                try {
                    // Phase 1B: Extract just the answer text for this question
                    const transcription = await extractSingleQuestion(apiKey, q.questionId, userParts);
                    q.student_answer_transcription = transcription;

                    // Phase 2: Grade the transcribed text
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

            let backoffTime = 1000; // Fixed 1 second delay for Paid Tier
            console.log(`Self-Healing Loop activated: Retrying in 1 second...`);
            await delay(backoffTime);
        }
    }
}

        // Optimization Prompt for Pre-processing
        const OPTIMIZE_PROMPT = `
You are an elite educational engineer. Rewrite this raw marking scheme into the strict "Playbook Standard Format".

CRITICAL MANDATES:

1. NO DATA LOSS: Preserve every alternative answer and exact mark allocation.
2. STRICT HIERARCHY & SECTIONS: Every single question/sub-question MUST have its own block. Do not merge sub-questions. If the raw text contains Section headers (e.g., Section A, Section B), you MUST precede the questions in that section with a strict section marker block: [SECTION: X]. If no sections are found, assume [SECTION: GENERAL].
3. ATOMIC CRITERIA: Break down paragraph answers into explicit, atomic, true/false grading criteria. Each criterion must represent exactly one independently gradable concept.
4. Output ONLY the structured text. No markdown block wrapping (\`\`\`).

=== PLAYBOOK STANDARD FORMAT EXAMPLE ===
[SECTION: A]

Question 1a: Definition (Max: 3 marks)

Criterion_1: States "conversion of light energy to chemical energy" (1 mark)
Criterion_2: Explicitly writes "Chlorophyll" (1 mark)
Criterion_3: Mentions "Water" (1 mark)

[SECTION: B]

Question 1b: Diagram (Max: 2 marks)

Criterion_1: A leaf shape is clearly drawn (1 mark)
Criterion_2: An arrow is drawn pointing into the leaf and is labeled "Sunlight" (1 mark)
=========================================
`;

        async function optimizeMarkingScheme(rawText) {
            // L9 Architecture: Chunked Parallel Optimization
            // If the scheme is extremely long, Gemini will hit Output limits and truncate at Question 4.
            // So we slice the text by 'Question' keywords or chunks of ~2000 chars.

            // Basic heuristic chunking: Split by "Question"
            const chunks = rawText.split(/(?=\n*Question\s*\d)/i).filter(c => c.trim().length > 0);

            // If it's a very small text without "Question" headings, wrap it as one chunk.
            if (chunks.length === 0) chunks.push(rawText);

            const apiKey = await getSecureKey();
            const optimizeSemaphore = new Semaphore(6); // Throttled to 6 to prevent limits

            const chunkPromises = chunks.map(async (chunkText, index) => {
                let attempt = 0;
                while (true) {
                    await optimizeSemaphore.acquire();
                    try {
                        const response = await fetch(`${API_URL}/gemini-2.5-pro:generateContent?key=${apiKey}`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                systemInstruction: {
                                    parts: [{ text: OPTIMIZE_PROMPT }]
                                },
                                contents: [{
                                    role: "user",
                                    parts: [{ text: chunkText }]
                                }],
                                generationConfig: {
                                    temperature: 0.0,
                                    maxOutputTokens: 8192
                                }
                            })
                        });

                        if (!response.ok) {
                            const errorText = await response.text();
                            throw new Error(`Google AI Studio API error: ${response.status} ${errorText}`);
                        }

                        const data = await response.json();
                        let content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

                        if (content.startsWith('```')) {
                            content = content.replace(/^```[^\n]*\n|\n```$/g, '');
                        }
                        return { index, content }; // preserve order
                    } catch (error) {
                        attempt++;
                        console.warn(`Optimization Chunk ${index} Attempt ${attempt} failed: ${error.message}`);

                        let backoffTime = 1000; // Fixed 1 second delay for Paid Tier
                        await delay(backoffTime);
                    } finally {
                        optimizeSemaphore.release();
                    }
                }
            });

            // Reassemble the chunks deterministically
            const results = await Promise.all(chunkPromises);
            results.sort((a, b) => a.index - b.index);

            return results.map(r => r.content).join("\n\n");
        }

// OCR Fallback for Scanned Marking Schemes
async function extractMarkingSchemeOCR(base64Images) {
    let attempt = 0;
    while (true) {
        try {
            const apiKey = await getSecureKey();

            const userParts = [
                {
                    text: "Extract all text from these marking scheme images. Preserve the exact layout, question numbers, and point values. Do not add any conversational text, just output the extracted text."
                }
            ];

            base64Images.forEach(imageUrl => {
                const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
                if (matches) {
                    userParts.push({
                        inlineData: {
                            mimeType: matches[1],
                            data: matches[2]
                        }
                    });
                }
            });

            const response = await fetch(`${API_URL}/gemini-2.5-pro:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [{
                        role: "user",
                        parts: userParts
                    }],
                    generationConfig: {
                        temperature: 0.0,
                        maxOutputTokens: 8192
                    }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Google AI Studio API error: ${response.status} ${errorText}`);
            }

            const data = await response.json();
            return data.candidates?.[0]?.content?.parts?.[0]?.text || "";

        } catch (error) {
            attempt++;
            console.warn(`OCR Attempt ${attempt} failed: ${error.message}`);

            let backoffTime = 1000; // Fixed 1 second delay for Paid Tier
            console.log(`Self-Healing Loop activated for OCR: Retrying in 1 second...`);
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

// EXPOSE EXTRACTOR TO UE
async function extractStudentExamsUE(base64PDF, compiledGoldenJson) {
    const apiKey = await getSecureKey();
    const userParts = [];
    if (typeof base64PDF === 'string') {
        userParts.push({ text: `Student Exam Text:\n\n---\n${base64PDF}\n---` });
    } else if (Array.isArray(base64PDF)) {
        base64PDF.forEach(imageUrl => {
            const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
            if (matches) {
                userParts.push({
                    inlineData: { mimeType: matches[1], data: matches[2] }
                });
            }
        });
    }

    const extractedQuestions = [];
    // Only extract questions defined in the Golden JSON
    const questionsToExtract = Object.keys(compiledGoldenJson.questions || {});

    // SINGLE-PASS MAP-EXTRACT (O(1) API Call per student)
    // Prevents rate limit exhaustion and token truncation failures associated with massive O(N) concurrent calls.
    const extractionPrompt = `
You are the UE Mass-Extractor for an Examination Board.
Locate and transcribe the exact answer for the following list of Question IDs from the provided student document:
[ ${questionsToExtract.join(", ")} ]

*** STRICT INSTRUCTIONS ***
1. For each Question ID listed, find where the student answered it and transcribe their EXACT text, math, or steps. Do not summarize or correct spelling.
2. If the student did not explicitly write anything for a question, output EXACTLY "No text extracted."
3. For diagram questions, describe the drawn nodes and connection logic literally.
4. DO NOT reference the Marking Scheme or try to evaluate if the student is correct. Your job is ONLY transcription.
5. Output ONLY valid JSON mapping the Question ID to the transcribed answer string.

*** FEW-SHOT EXAMPLES ***

[INPUT IMAGE]: A student wrote "1(a) The powerhouse is the mitochonria. (b) [Blank space]"
[TARGET IDs]: ["Q1_A", "Q1_B"]

[OUTPUT JSON]
{
  "Q1_A": "The powerhouse is the mitochonria.",
  "Q1_B": "No text extracted."
}

[INPUT IMAGE]: Student crossed out their first answer for Q3 and wrote "Q3: 45 kg" next to it.
[TARGET IDs]: ["Q3"]

[OUTPUT JSON]
{
  "Q3": "45 kg"
}
`;

    const currentParts = [...userParts, { text: extractionPrompt }];
    let attempt = 0;
    let extractionMap = {};

    while (attempt < 3) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s for full document parse

            const response = await fetch(`${API_URL}/gemini-2.5-pro:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: "user", parts: currentParts }],
                    generationConfig: {
                        temperature: 0.0,
                        maxOutputTokens: 8192,
                        responseMimeType: "application/json"
                    }
                }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                if (response.status === 429) throw new Error("Rate limit exceeded (429)");
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
            extractionMap = parseLLMJSON(textContent);
            break; // Success

        } catch (error) {
            attempt++;
            console.warn(`[Infinite Retry] Single-Pass Extraction attempt ${attempt} failed:`, error.message);
            if (attempt >= 3) {
                console.error("Failed to extract student exams after 3 attempts.");
                break;
            }
            let backoffTime = 1000; // Fixed 1 second delay for Paid Tier
            await delay(backoffTime);
        }
    }

    for (const qId of questionsToExtract) {
        extractedQuestions.push({
            questionId: qId,
            text: extractionMap[qId] || "No text extracted.",
            questionTitle: compiledGoldenJson.questions[qId].title || `Question ${qId}`
        });
    }

    // Extract Student ID and Name using a separate fast vision call
    let studentId = "Unknown ID";
    let studentName = "Unknown Student";
    try {
        const idPrompt = "Scan this document and output a JSON object with 'student_id' and 'student_name'. If you cannot find them, output 'Unknown'.";
        const idResponse = await fetch(`${API_URL}/gemini-2.5-pro:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [...userParts, { text: idPrompt }] }],
                generationConfig: { temperature: 0.0, responseMimeType: "application/json" }
            })
        });
        if (idResponse.ok) {
            const idData = await idResponse.json();
            const idParsed = parseLLMJSON(idData.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
            if (idParsed.student_id) studentId = idParsed.student_id;
            if (idParsed.student_name) studentName = idParsed.student_name;
        }
    } catch (e) {
        console.error("Failed to extract student identity:", e);
    }

    // Return Playbook compliant structure
    return [{
        student_id: studentId,
        student_name: studentName,
        student_id_uuid: null, // assigned in ue.js logic fallback if needed
        questions: extractedQuestions
    }];
}

if (typeof window !== 'undefined') {
    window.PlaybookAI.extractStudentExamsUE = extractStudentExamsUE;
} else {
    self.PlaybookAI.extractStudentExamsUE = extractStudentExamsUE;
}

// Extract Text From PDF (for schemes)
async function extractTextFromPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;

    if (pdfjsLib && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let extractedText = "";

    for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        extractedText += pageText + "\n";
    }

    if (extractedText.trim().length < 50) {
        throw new Error("PDF seems to be scanned (no native text). Please ensure marking schemes are digital text or use the main upload OCR flow.");
    }

    return extractedText;
}

// Extract Text From Word (for schemes)
async function extractTextFromWord(file) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    return result.value;
}

if (typeof window !== 'undefined') {
    window.PlaybookAI.extractTextFromPDF = extractTextFromPDF;
    window.PlaybookAI.extractTextFromWord = extractTextFromWord;
} else {
    self.PlaybookAI.extractTextFromPDF = extractTextFromPDF;
    self.PlaybookAI.extractTextFromWord = extractTextFromWord;
}
