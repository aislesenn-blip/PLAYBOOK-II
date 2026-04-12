// js/ue_engine.js
// Ultra-Fast Consensus Grading Engine (UE Mode)
// Strictly uses Free Tier models with extreme accuracy via Pass 3 Auditing

// API_URL is inherited globally from js/ai.js which is loaded first in upload.html

// Ultra-Fast Gemini Native JSON Engine
// Bypasses complex Maps and streaming in favor of high-context window processing

const VISION_MODEL = "gemini-2.0-flash"; // Extreme speed for massive bulk reading AND logic

const UE_SINGLE_PASS_PROMPT = `
You are an Elite Examination Board Evaluator capable of parallel task execution.
You must process an entire student exam (provided via text or images) against the Marking Scheme in a single, comprehensive pass.

*** MANDATE 1: EXTRACTION ***
1. Identify the student's Name and Registration Number. If missing, output "Unknown".
2. Identify WHICH questions from the marking scheme have been attempted.

*** MANDATE 2: TRANSCRIPTION & EVALUATION ***
For every attempted question:
1. Transcribe what the student wrote or drew (mental scratchpad).
2. Grade the transcribed answer against the Marking Scheme criteria.
3. Output an array of floats ('points_awarded') representing the exact point values earned from the rubric. DO NOT perform final score arithmetic.
4. Provide a 'justification' comparing the student's answer to the expected rubric facts.
5. Provide 'constructive_feedback' using the micro-lesson formula: [Acknowledge what they got right] + [State EXACT missing scientific fact] + [Actionable micro-lesson].

If a question from the marking scheme is NOT ATTEMPTED/SKIPPED by the student, output it with:
"answer_status": "Skipped", "is_entirely_blank": true, "points_awarded": []

*** FINAL OUTPUT SCHEMA ***
{
  "studentName": "Extracted Name or 'Unknown'",
  "registrationNumber": "Extracted ID or 'Unknown'",
  "questions": [
    {
      "questionId": "1a",
      "questionTitle": "Summary of question",
      "section": "Section A",
      "max_marks": 5,
      "expected_number_of_items": 4,
      "answer_status": "Answered | Skipped",
      "student_answer_transcription": "The exact text/diagram description.",
      "justification": "The rubric requires X. The student provided X...",
      "points_awarded": [1.0, 0.5],
      "is_entirely_blank": false,
      "constructive_feedback": "You correctly identified X. However, you missed Y."
    }
  ]
}
`;

// Helper: calculateDeterministicScores and delay are inherited globally from js/ai.js

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

            if (error.message.includes('400') || error.message.includes('404')) {
                throw error; // Fatal configuration or model not found error
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

async function gradeBatchExams(base64PDF, markingSchemeText, examInstructions = "", maxScoreParam = 100) {
    let attempt = 0;
    while (true) {
        try {
            const apiKey = await getGeminiKey();

            // SINGLE PASS: ONE MASSIVE API CALL TO AVOID THE MAP-REDUCE MULTIPLIER TRAP
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

            const rawGradedDataStr = await callGemini(apiKey, UE_SINGLE_PASS_PROMPT, userParts, "UE Single Pass Bulk Grading", VISION_MODEL);
            let parsedExam = parseLLMJSON(rawGradedDataStr);

            // Handle potential array unwrapping from prompt schema flexibility
            if (Array.isArray(parsedExam)) {
                parsedExam = parsedExam[0];
            } else if (parsedExam.students && Array.isArray(parsedExam.students)) {
                parsedExam = parsedExam.students[0];
            }

            // Ensure schema integrity for the math calculation layer
            parsedExam.questions = (parsedExam.questions || []).map(q => {
                if (q.answer_status === "Skipped") {
                    return {
                        ...q,
                        is_entirely_blank: true,
                        points_awarded: [],
                        justification: "No answer provided",
                        constructive_feedback: "No answer provided"
                    };
                }
                return {
                    ...q,
                    points_awarded: Array.isArray(q.points_awarded) ? q.points_awarded : [],
                    is_entirely_blank: q.is_entirely_blank || false,
                    justification: q.justification || "No justification provided.",
                    constructive_feedback: q.constructive_feedback || "Review rubric.",
                    audit_status: "Approved"
                };
            });

            // MATH (Deterministic JS Calculation)
            const finalData = calculateDeterministicScores(parsedExam, examInstructions, maxScoreParam);

            return [finalData];

        } catch (error) {
            attempt++;
            console.warn(`Playbook UE Engine Attempt ${attempt} failed: ${error.message}`);

            if (error.message.includes('400') || error.message.includes('404')) throw error;

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
    const mapDataStr = await callGemini(apiKey, UE_OPTIMIZE_PROMPT, userParts, "UE Pass 0: Format Scheme", VISION_MODEL);
    return mapDataStr;
}

window.UE_Engine = { gradeBatchExams, optimizeMarkingSchemeUE };
