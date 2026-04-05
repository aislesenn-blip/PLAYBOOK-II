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

*** STRICT SCORING GUARDRAIL ***
Calculate the exact marks the student earned based on the rubric. If the rubric states each item is worth 0.5 marks, and they got 3 items, award 1.5. 
DO NOT divide their score by the total number of options listed in the marking scheme. Just add up the points they successfully earned.
If the student's answer is blank, output 'is_entirely_blank': true.

*** THE "MICRO-LESSON" FEEDBACK PROTOCOL ***
Your "constructive_feedback" MUST be short and directly actionable. Use this exact formula: [Acknowledge what they got right] + [State the EXACT missing scientific fact from the rubric] + [Actionable micro-lesson].

*** SCHEMA ***
You MUST output ONLY valid JSON using the exact keys below. No markdown formatting.
CRITICAL JSON RULE: Do NOT use ANY quotation marks inside your justification or feedback text. If you need to reference what the student wrote, paraphrase them or just state the words without wrapping them in quotes.

{
  "justification": "The rubric requires X and the student provided X but missed Y.",
  "marks_awarded": 1.5,
  "is_entirely_blank": false,
  "constructive_feedback": "You correctly identified X. However, you missed Y."
}
`;

function parseSectionRules(examInstructions) {
    const rules = {};
    if (!examInstructions || typeof examInstructions !== 'string') return rules;
    const format1 = /Section\s+([A-Z0-9]+)[\s:,-]+(?:answer|choose|pick|attempt|do)[\sA-Za-z]*(\d+)/gi;
    const format2 = /(?:answer|choose|pick|attempt|do)[\sA-Za-z]*(\d+)[\sA-Za-z]*(?:in|from|of)\s+Section\s+([A-Z0-9]+)/gi;
    const formatGlobal = /(?:answer|choose|pick|attempt|do)[\sA-Za-z]*(\d+)(?![\sA-Za-z]*(?:in|from|of)\s+Section)/gi;

    let match;
    while ((match = format1.exec(examInstructions)) !== null) {
        rules[match[1].toUpperCase()] = parseInt(match[2], 10);
    }
    while ((match = format2.exec(examInstructions)) !== null) {
        rules[match[2].toUpperCase()] = parseInt(match[1], 10);
    }
    while ((match = formatGlobal.exec(examInstructions)) !== null) {
        const limit = parseInt(match[1], 10);
        if (!rules["GENERAL"] || limit < rules["GENERAL"]) {
            rules["GENERAL"] = limit;
        }
    }
    return rules;
}

function calculateDeterministicScores(extractedData, examInstructions, maxScoreParam = 100) {
    if (!extractedData || !extractedData.questions) return extractedData;

    extractedData.questions.forEach(q => {
        if (q.answer_status === "Skipped" || q.is_entirely_blank) {
            q.marks_awarded = 0;
            q.score = 0;
        } else {
            const maxMarksRaw = q.max_marks !== undefined ? q.max_marks : (q.max !== undefined ? q.max : 1);
            const maxMarks = parseFloat(maxMarksRaw) || 1;
            q.max_marks = maxMarks;

            let aiCalculatedMarks = parseFloat(q.marks_awarded_by_ai) || 0;
            let finalScore = Math.min(aiCalculatedMarks, maxMarks);
            
            q.score = finalScore;
            q.marks_awarded = Math.round(finalScore * 100) / 100;
        }
    });

    const sectionRules = parseSectionRules(examInstructions);
    const sections = {};
    extractedData.questions.forEach(q => {
        let secName = "GENERAL";
        if (q.section) {
            const normalized = q.section.replace(/section/i, '').trim();
            const secMatch = normalized.match(/([A-Z0-9]+)/i);
            if (secMatch) secName = secMatch[1].toUpperCase();
        }
        if (!sections[secName]) sections[secName] = [];
        sections[secName].push(q);
    });

    let totalScore = 0;

    for (const [secName, qs] of Object.entries(sections)) {
        let attemptedQs = qs.filter(q => q.answer_status !== "Skipped" && q.marks_awarded > 0);

        if (sectionRules[secName] && attemptedQs.length > sectionRules[secName]) {
            attemptedQs.sort((a, b) => b.marks_awarded - a.marks_awarded);
            const allowedAnswers = sectionRules[secName];
            const droppedQuestions = attemptedQs.slice(allowedAnswers);

            droppedQuestions.forEach(q => {
                q.marks_awarded = 0;
                if (q.constructive_feedback) {
                    q.constructive_feedback = "(Dropped: " + q.constructive_feedback + ")";
                } else {
                    q.constructive_feedback = "(Dropped)";
                }
            });
        }
        totalScore += qs.reduce((sum, q) => sum + (q.marks_awarded || 0), 0);
    }

    extractedData.totalScore = totalScore;
    extractedData.maxScore = maxScoreParam; 

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

const delay = ms => new Promise(res => setTimeout(res, ms));

function parseLLMJSON(content) {
    if (!content || content.trim() === '') {
        return { is_entirely_blank: true, justification: "No step-by-step thinking provided", marks_awarded: 0 };
    }

    let cleanedText = content;
    
    // Safely remove markdown JSON blocks
    cleanedText = cleanedText.replace(/^```json\s*/gi, '');
    cleanedText = cleanedText.replace(/^```\s*/gi, '');
    cleanedText = cleanedText.replace(/```\s*$/gi, '');

    // THE MAGIC SANITIZER: Strip unescaped newlines and tabs BEFORE parsing
    cleanedText = cleanedText.replace(/[\n\r\t]+/g, ' ');

    try {
        return JSON.parse(cleanedText);
    } catch (e) {
        console.warn("JSON parse failed, attempting automatic fallback repair for truncated JSON:", e.message);
        let repairedContent = cleanedText;
        let stack = [];
        let inString = false;
        let escapeNext = false;

        for (let i = 0; i < repairedContent.length; i++) {
            const char = repairedContent[i];
            if (escapeNext) { escapeNext = false; continue; }
            if (char === '\\') { escapeNext = true; continue; }
            if (char === '"') { inString = !inString; continue; }
            if (!inString) {
                if (char === '{') stack.push('}');
                else if (char === '[') stack.push(']');
                else if (char === '}' || char === ']') stack.pop();
            }
        }

        let dropIndex = repairedContent.length;
        let insideStr = inString;

        for (let i = repairedContent.length - 1; i >= 0; i--) {
            const char = repairedContent[i];
            if (char === '"' && (i === 0 || repairedContent[i-1] !== '\\')) {
                insideStr = !insideStr;
                continue;
            }
            if (!insideStr) {
                if (char === ',') { dropIndex = i; break; }
                if (char === '{' || char === '[' || char === '}' || char === ']') { dropIndex = i + 1; break; }
            }
        }

        repairedContent = repairedContent.substring(0, dropIndex);
        repairedContent = repairedContent.replace(/(,\s*|:\s*|"\w*\s*)$/, '');

        while (stack.length > 0) { repairedContent += stack.pop(); }

        try {
            return JSON.parse(repairedContent);
        } catch (e2) {
            console.error("Advanced JSON repair failed.", e2.message);
            throw new Error("JSON parse failed completely");
        }
    }
}

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
        return new Promise(resolve => { this.queue.push(resolve); });
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

async function gradeSingleQuestion(apiKey, questionData, markingSchemeText) {
    let attempt = 0;
    const maxRetries = 5;
    while (attempt < maxRetries) {
        try {
            const promptText = `Marking Scheme for context:\n${markingSchemeText}\n\nEvaluate the following student's answer for Question ${questionData.questionId}:\nMax Marks: ${questionData.max_marks}\nAnswer: ${questionData.student_answer_transcription}`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000); 

            let response;
            try {
                response = await fetch(API_URL, {
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
                            { role: 'system', content: PASS2_SYSTEM_PROMPT },
                            { role: 'user', content: promptText }
                        ],
                        response_format: { type: "json_object" }
                    }),
                    signal: controller.signal
                });
            } finally {
                clearTimeout(timeoutId);
            }

            if (!response.ok) {
                if (response.status === 429) throw new Error("Rate limit exceeded (429)");
                const errorText = await response.text();
                throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
            }

            const data = await response.json();
            const parsed = parseLLMJSON(data.choices[0].message.content);

            if (parsed.marks_awarded === undefined && parsed.is_entirely_blank === undefined) {
                throw new Error("Invalid LLM response format: missing marks_awarded or is_entirely_blank");
            }

            return {
                ...questionData,
                marks_awarded_by_ai: parsed.marks_awarded !== undefined ? parseFloat(parsed.marks_awarded) : 0,
                is_entirely_blank: parsed.is_entirely_blank || false,
                justification: parsed.justification || "No justification provided.",
                constructive_feedback: parsed.constructive_feedback || "Review rubric.",
                criteria_evaluations: [] 
            };

        } catch (error) {
            attempt++;
            console.warn(`[Invisible Retry] gradeSingleQuestion attempt ${attempt} failed for Question ${questionData.questionId}:`, error.message);
            if (attempt >= maxRetries) {
                console.error(`Failed to grade question ${questionData.questionId} after ${maxRetries} attempts:`, error);
                return { ...questionData, marks_awarded_by_ai: 0, is_entirely_blank: true, justification: "Error grading.", constructive_feedback: "Error grading." };
            }
            const baseDelay = 4000;
            const backoffTime = baseDelay * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 2000);
            await delay(backoffTime);
        }
    }
}

async function gradeBatchExams(base64PDF, markingSchemeText, examInstructions = "", maxScoreParam = 100, maxRetries = 3) {
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            const apiKey = await getSecureKey();

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

            const questions = parsedMap.questions || [];
            
            // STRICT CONCURRENCY CONTROL TO PREVENT HTTP 429
            const semaphore = new Semaphore(2); 

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
                    return await gradeSingleQuestion(apiKey, q, markingSchemeText);
                } finally {
                    semaphore.release();
                }
            });

            const gradedQuestions = await Promise.all(gradingPromises);
            parsedMap.questions = gradedQuestions;

            const finalData = calculateDeterministicScores(parsedMap, examInstructions, maxScoreParam);
            return [finalData];

        } catch (error) {
            attempt++;
            console.warn(`Playbook Engine Attempt ${attempt} failed: ${error.message}`);
            if (attempt >= maxRetries) throw error;
            const backoffTime = attempt * 3000;
            await delay(backoffTime);
        }
    }
}

const OPTIMIZE_PROMPT = `
You are an elite educational engineer. Rewrite this raw marking scheme into the strict "Playbook Standard Format".

CRITICAL MANDATES:
1. NO DATA LOSS: Preserve every alternative answer and exact mark allocation.
2. STRICT HIERARCHY: Every single question/sub-question MUST have its own block. Do not merge sub-questions.
3. ATOMIC CRITERIA: Break down paragraph answers into explicit, atomic, true/false grading criteria. Each criterion must represent exactly one independently gradable concept.
4. Output ONLY the structured text. Do not use markdown block wrapping.

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
                        { role: 'system', content: OPTIMIZE_PROMPT },
                        { role: 'user', content: rawText }
                    ]
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
            }

            const data = await response.json();
            let content = data.choices[0].message.content;

            if (content.startsWith('```')) content = content.replace(/^```[^\n]*\n|\n```$/g, '');
            return content;
        } catch (error) {
            attempt++;
            if (attempt >= maxRetries) throw error;
            const backoffTime = attempt * 3000;
            await delay(backoffTime);
        }
    }
}

async function extractMarkingSchemeOCR(base64Images, maxRetries = 3) {
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            const apiKey = await getSecureKey();
            const userContent = [{ type: "text", text: "Extract all text from these marking scheme images. Preserve the exact layout, question numbers, and point values. Do not add any conversational text, just output the extracted text." }];

            base64Images.forEach(imageUrl => {
                userContent.push({ type: "image_url", image_url: { url: imageUrl } });
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
                    messages: [{ role: 'user', content: userContent }]
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
            if (attempt >= maxRetries) throw error;
            const backoffTime = attempt * 3000;
            await delay(backoffTime);
        }
    }
}

if (typeof window !== 'undefined') {
    window.PlaybookAI = { gradeBatchExams, optimizeMarkingScheme, extractMarkingSchemeOCR };
} else {
    self.PlaybookAI = { gradeBatchExams, optimizeMarkingScheme, extractMarkingSchemeOCR };
}
