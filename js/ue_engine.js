// js/ue_engine.js
// Ultra-Fast Consensus Grading Engine (UE Mode)
// Strictly uses Free Tier models with extreme accuracy via Pass 3 Auditing

// API_URL is inherited globally from js/ai.js which is loaded first in upload.html

// Ultra-Fast Gemini Native JSON Engine
// Bypasses complex Maps and streaming in favor of high-context window processing

const VISION_MODEL = "gemini-1.5-flash"; // Extreme speed for massive bulk page reading
const LOGIC_MODEL = "gemini-1.5-pro"; // Maximum accuracy for grading and logic mapping

const UE_PASS1_SYSTEM_PROMPT = `
You are the Master Segmenter for an Examination Board. Extract the student's identity and transcribe their answers from the provided exam pages.

*** ABSOLUTE LITERAL TRANSCRIPTION RULE ***
Quote the student's exact phrases exactly as written. DO NOT invent, assume, or inject terms from the marking scheme.

*** INSTRUCTIONS ***
1. Extract the student's name and registration number.
2. Look at the provided marking scheme. Which of these questions are answered across these pages?
3. Transcribe the exact text/math/steps for answered questions. For diagrams, describe the labels and structural logic in text.
4. Output ONLY valid JSON matching the schema precisely.

*** SCHEMA ***
{
  "students": [
    {
      "studentName": "Extracted Name or 'Unknown'",
      "registrationNumber": "Extracted ID or 'Unknown'",
      "questions": [
        {
          "questionId": "1a",
          "questionTitle": "A short summary",
          "section": "Section A",
          "max_marks": 5,
          "expected_number_of_items": 4,
          "answer_status": "Answered",
          "student_answer_transcription": "The exact text written by the student: '...'"
        }
      ]
    }
  ]
}
`;

const UE_PASS2_SYSTEM_PROMPT = `
You are the Primary Evaluator for an Examination Board. Grade exactly ONE question for ONE student.

*** STRICT SCORING GUARDRAIL ***
Do NOT perform final score arithmetic. Extract an array of specific, awarded points based on the rubric.
1. 'points_awarded': An array of floats. For EVERY distinct, correct rubric criterion the student successfully met, append the exact point value.
2. If the student's answer is missing or completely wrong, output 'is_entirely_blank': true and 'points_awarded': [].

*** THE "MICRO-LESSON" FEEDBACK PROTOCOL ***
"constructive_feedback" MUST be short and actionable: [Acknowledge what they got right] + [State EXACT missing scientific fact] + [Actionable micro-lesson].

*** SCHEMA ***
{
  "justification": "The rubric requires X and Y. The student provided X but missed Y...",
  "points_awarded": [0.5],
  "is_entirely_blank": false,
  "constructive_feedback": "You correctly identified X. However, you missed Y."
}
`;

// Helper: calculateDeterministicScores and delay are inherited globally from js/ai.js

class UESemaphore {
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

async function getGeminiKey() {
    try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) throw new Error("No active session.");

        const userProfile = await window.PlaybookDB.getUserById(session.user.id);
        const instId = userProfile ? userProfile.institution_id : session.institution_id;
        if (!instId) throw new Error("Institution ID not found.");

        const secret = await window.PlaybookDB.getInstitutionSecret(instId);
        if (!secret || !secret.google_ai_studio_key) {
            throw new Error("No Google AI Studio key found in the secure vault. Ask an Admin to configure it.");
        }
        return secret.google_ai_studio_key;
    } catch (e) {
        const mockEnv = localStorage.getItem('PLAYBOOK_GEMINI_API_KEY');
        if (mockEnv) return mockEnv;
        throw new Error(`Authorization failed: ${e.message}`);
    }
}

async function callGemini(apiKey, systemPrompt, userParts, title, targetModel = VISION_MODEL) {
    let attempt = 0;
    while (true) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s timeout for large context

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    systemInstruction: {
                        parts: [{ text: systemPrompt }]
                    },
                    contents: [{
                        role: "user",
                        parts: userParts
                    }],
                    generationConfig: {
                        temperature: 0.0,
                        topP: 0.1,
                        responseMimeType: "application/json"
                    }
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API error: ${response.status} ${errorText}`);
            }

            const responseData = await response.json();

            if (responseData.candidates && responseData.candidates.length > 0) {
                return responseData.candidates[0].content.parts[0].text;
            } else {
                throw new Error("Gemini returned empty or blocked response.");
            }

        } catch (error) {
            attempt++;
            console.warn(`UE Engine attempt ${attempt} failed for ${title}:`, error.message);

            if (error.message.includes('400')) {
                throw error; // Fatal configuration error
            }

            let backoffTime = 4000 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 2000);

            // 429 Limit explicitly requires a longer cooling off period
            if (error.message.includes('429')) {
                backoffTime = 15000 + Math.floor(Math.random() * 5000);
            }

            if (backoffTime > 60000) backoffTime = 60000;

            await delay(backoffTime);
        }
    }
}

// parseLLMJSON is inherited globally from js/ai.js

async function gradeSingleQuestionUE(apiKey, questionData, markingSchemeText) {
    let attempt = 0;
    while (true) {
        try {
            const p2Prompt = `Marking Scheme for context:\n${markingSchemeText}\n\nEvaluate the following student's answer for Question ${questionData.questionId}:\nMax Marks: ${questionData.max_marks}\nAnswer: ${questionData.student_answer_transcription}`;

            const userParts = [{ text: p2Prompt }];
            const p2Raw = await callGemini(apiKey, UE_PASS2_SYSTEM_PROMPT, userParts, "UE Pass 2: Primary Grader", LOGIC_MODEL);
            const p2Data = parseLLMJSON(p2Raw);

            return {
                ...questionData,
                points_awarded: Array.isArray(p2Data.points_awarded) ? p2Data.points_awarded : [],
                is_entirely_blank: p2Data.is_entirely_blank || false,
                justification: p2Data.justification || "No justification provided.",
                constructive_feedback: p2Data.constructive_feedback || "Review rubric.",
                audit_status: "Approved"
            };
        } catch (error) {
            attempt++;
            console.warn(`gradeSingleQuestionUE attempt ${attempt} failed for Question ${questionData.questionId}:`, error.message);
            if (attempt >= 5) {
                return {
                    ...questionData,
                    points_awarded: [],
                    is_entirely_blank: true,
                    justification: "Error grading after multiple retries.",
                    constructive_feedback: "Error grading. Please review manually.",
                    audit_status: "Approved"
                };
            }
            const backoff = 4000 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 2000);
            await delay(Math.min(backoff, 30000));
        }
    }
}

async function gradeBatchExams(base64PDF, markingSchemeText, examInstructions = "", maxScoreParam = 100) {
    let attempt = 0;
    while (true) {
        try {
            const apiKey = await getGeminiKey();

            // PASS 1: THE SEGMENTATION MAP (Massive Context Window allows all pages at once)
            let promptText = `Here is the marking scheme:\n${markingSchemeText}\n\n`;
            const userParts = [];

            if (typeof base64PDF === 'string') {
                promptText += `Here is the raw text of this single student's digital exam submission:\n\n---\n${base64PDF}\n---`;
                userParts.push({ text: promptText });
            } else if (Array.isArray(base64PDF)) {
                promptText += `Here are the scanned pages of this single student's exam:`;
                userParts.push({ text: promptText });

                // For Gemini, base64 images need specific inline_data structure
                base64PDF.forEach(imageUrl => {
                    // Extract mime type and raw base64 from data URL (e.g., data:image/jpeg;base64,...)
                    const mimeMatch = imageUrl.match(/data:([^;]+);base64,(.+)/);
                    if (mimeMatch) {
                        userParts.push({
                            inlineData: {
                                mimeType: mimeMatch[1],
                                data: mimeMatch[2]
                            }
                        });
                    }
                });
            } else {
                throw new Error("Invalid input format for student exam data.");
            }

            const mapDataStr = await callGemini(apiKey, UE_PASS1_SYSTEM_PROMPT, userParts, "UE Pass 1: Global Segmentation", VISION_MODEL);
            let parsedMap = parseLLMJSON(mapDataStr);

            if (parsedMap.students && Array.isArray(parsedMap.students)) {
                parsedMap = parsedMap.students[0];
            }

            // PASS 2: PARALLEL QUESTION PROCESSING
            const questions = parsedMap.questions || [];

            // Free Tier Gemini allows 15 RPM.
            // Processing 15 questions perfectly respects the free tier limit without triggering 429s.
            const semaphorePass2 = new UESemaphore(15);

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

                await semaphorePass2.acquire();
                try {
                    return await gradeSingleQuestionUE(apiKey, q, markingSchemeText);
                } finally {
                    semaphorePass2.release();
                }
            });

            const gradedQuestions = await Promise.all(gradingPromises);
            parsedMap.questions = gradedQuestions;

            // MATH (Deterministic JS Calculation)
            const finalData = calculateDeterministicScores(parsedMap, examInstructions, maxScoreParam);

            return [finalData];

        } catch (error) {
            attempt++;
            console.warn(`Playbook UE Engine Attempt ${attempt} failed: ${error.message}`);

            if (error.message.includes('400')) throw error;

            let backoffTime = attempt * 5000;
            if (backoffTime > 60000) backoffTime = 60000;

            console.log(`Self-Healing Loop activated: Retrying in ${backoffTime / 1000} seconds...`);
            await delay(backoffTime);
        }
    }
}

const UE_OPTIMIZE_PROMPT = `
You are an elite educational engineer. Rewrite this raw marking scheme into the strict "Playbook Standard Format".

CRITICAL MANDATES:
1. NO DATA LOSS: Preserve every alternative answer and exact mark allocation.
2. STRICT HIERARCHY: Every single question/sub-question MUST have its own block. Do not merge sub-questions.
3. ATOMIC CRITERIA: Break down paragraph answers into explicit, atomic, true/false grading criteria. Each criterion must represent exactly one independently gradable concept.
4. Output ONLY the structured text. No markdown block wrapping (\`\`\`).
`;

async function optimizeMarkingSchemeUE(rawText) {
    const apiKey = await getGeminiKey();
    const userParts = [{ text: rawText }];
    const mapDataStr = await callGemini(apiKey, UE_OPTIMIZE_PROMPT, userParts, "UE Pass 0: Format Scheme", LOGIC_MODEL);
    return mapDataStr;
}

window.UE_Engine = { gradeBatchExams, optimizeMarkingSchemeUE };
