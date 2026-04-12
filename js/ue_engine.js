// js/ue_engine.js
// UE Gemini Integration Engine (Client-Side Distributed Processing)

const UE_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent";

const UE_PASS1_SYSTEM_PROMPT = `
You are the Master Segmenter for an Examination Board. Your job is to extract the student's identity and transcribe their answers from the provided exam document, mapping each answer to its corresponding question from the marking scheme.

*** MANDATE ***
You must analyze the student's exam and segment their answers based on the provided marking scheme. You will return a JSON object with the student's identity and an array of their transcribed answers.

*** ABSOLUTE LITERAL TRANSCRIPTION RULE ***
You MUST act as a literal transcriber. Quote the student's exact phrases. DO NOT invent, assume, or inject terms from the marking scheme into the student's answer. If the student did not explicitly write it, you must not extract it.

*** INSTRUCTIONS ***
1. Identify the student's name and registration number.
2. For EVERY question listed in the marking scheme, check if the student attempted it.
3. If they attempted it, transcribe their exact text/math/steps as accurately as possible exactly as written. For diagrams, describe the diagram's labels and structural logic in text.
4. If they skipped the question, set 'answer_status' to 'Skipped'.
5. Identify the maximum number of items the student is explicitly asked to provide (e.g., 'Name 5 sensors' = 5). Store this as 'expected_number_of_items'. Do NOT count the total number of possible valid options listed in the rubric. If the rubric lists 17 options but the question asks for 5 (or max marks is 5), the expected number is 5.
6. ONLY output valid JSON using the exact schema below. Output ONLY raw JSON. No conversational text. No markdown blocks. Start your response with {

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
      "answer_status": "Answered | Skipped",
      "student_answer_transcription": "The student wrote: '...'"
    }
  ]
}
`;

const UE_PASS2_SYSTEM_PROMPT = `
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

// Helper: Dumb Aggregator (Reduce Phase)

async function getSecureGeminiKey() {
    try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) throw new Error("No active session.");

        const userProfile = await window.PlaybookDB.getUserById(session.user.id);
        // Fallback for Playwright testing where userProfile might be missing or mocked
        const instId = userProfile ? userProfile.institution_id : session.institution_id;
        if (!instId) throw new Error("Institution ID not found.");

        const secret = await window.PlaybookDB.getInstitutionSecret(instId);

        if (!secret || !secret.gemini_api_key) {
            throw new Error("No Gemini API key found in the secure vault. Ask an Admin to configure it.");
        }
        return secret.gemini_api_key;
    } catch (e) {
        // Fallback check for Playwright environment directly using a localStorage mocked API key if DB fails
        const mockEnv = localStorage.getItem('PLAYBOOK_GEMINI_API_KEY') || localStorage.getItem('playbook_gemini_mock_api_key');
        if (mockEnv) return mockEnv;

        throw new Error(`Authorization failed: ${e.message}`);
    }
}


// Helper function for exponential backoff delay

// Helper to parse LLM JSON output robustly

// Simple Concurrency Semaphore (Promise Pool)

// Pass 2: Single-Question Grading
async function gradeSingleQuestionUE(apiKey, questionData, markingSchemeText) {
    let attempt = 0;

    while (true) {
        try {
            const promptText = `Marking Scheme for context:\n${markingSchemeText}\n\nEvaluate the following student's answer for Question ${questionData.questionId}:\nMax Marks: ${questionData.max_marks}\nAnswer: ${questionData.student_answer_transcription}`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

            let response;
            try {
                response = await fetch(`${UE_API_URL}?key=${apiKey}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        systemInstruction: {
                            parts: [{ text: UE_PASS2_SYSTEM_PROMPT }]
                        },
                        contents: [
                            { role: 'user', parts: [{ text: promptText }] }
                        ],
                        generationConfig: {
                            temperature: 0.0,
                            topP: 0.1,
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
                if (response.status === 400 || response.status === 404) {
                    throw new Error(`Fatal configuration error (${response.status}): ${errorText}`);
                }
                throw new Error(`Gemini API error: ${response.status} ${errorText}`);
            }

            const data = await response.json();
            const responseText = data.candidates && data.candidates.length > 0 ? data.candidates[0].content.parts[0].text : "{}";
            const _parseJSON = window.parseLLMJSON || self.parseLLMJSON;
            const parsed = _parseJSON(responseText);

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
            if (error.message.includes('Fatal configuration error')) {
                throw error;
            }

            attempt++;
            console.warn(`[Infinite Retry] gradeSingleQuestionUE attempt ${attempt} failed for Question ${questionData.questionId}:`, error.message);

            // Capped Exponential backoff with jitter
            const baseDelay = 4000;
            let backoffTime = baseDelay * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 2000);
            if (backoffTime > 60000) backoffTime = 60000;

            const _delay = window.delay || self.delay;
            await _delay(backoffTime);
        }
    }
}

// Client-Side Distributed Grading Engine (Map-Reduce Architecture)
async function gradeBatchExamsUE(base64PDF, markingSchemeText, examInstructions = "", maxScoreParam = 100) {
    let attempt = 0;
    while (true) {
        try {
            const apiKey = await getSecureGeminiKey();

            // PASS 1: THE SEGMENTATION MAP
            let promptText = `Here is the marking scheme:\n${markingSchemeText}\n\n`;
            const geminiParts = [];

            if (typeof base64PDF === 'string') {
                promptText += `Here is the raw text of this single student's digital exam submission:\n\n---\n${base64PDF}\n---`;
                geminiParts.push({ text: promptText });
            } else if (Array.isArray(base64PDF)) {
                promptText += `Here are the scanned pages of this single student's exam:`;
                geminiParts.push({ text: promptText });
                base64PDF.forEach(imageUrl => {
                    const mimeTypeMatch = imageUrl.match(/data:([^;]+);base64,/);
                    const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'image/jpeg';
                    const base64Data = imageUrl.split(',')[1] || imageUrl;

                    geminiParts.push({
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Data
                        }
                    });
                });
            } else {
                throw new Error("Invalid input format for student exam data.");
            }

            const mapResponse = await fetch(`${UE_API_URL}?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    systemInstruction: {
                        parts: [{ text: UE_PASS1_SYSTEM_PROMPT }]
                    },
                    contents: [
                        { role: 'user', parts: geminiParts }
                    ],
                    generationConfig: {
                        temperature: 0.0,
                        topP: 0.1,
                        maxOutputTokens: 8192,
                        responseMimeType: "application/json"
                    }
                })
            });

            if (!mapResponse.ok) {
                const errorText = await mapResponse.text();
                if (mapResponse.status === 400 || mapResponse.status === 404) {
                    throw new Error(`Fatal configuration error in Pass 1 (${mapResponse.status}): ${errorText}`);
                }
                throw new Error(`Gemini API error in Pass 1: ${mapResponse.status} ${errorText}`);
            }

            const mapData = await mapResponse.json();
            const responseTextMap = mapData.candidates && mapData.candidates.length > 0 ? mapData.candidates[0].content.parts[0].text : "{}";
            const _parseJSON = window.parseLLMJSON || self.parseLLMJSON;
            let parsedMap = _parseJSON(responseTextMap);

            if (parsedMap.students && Array.isArray(parsedMap.students)) {
                parsedMap = parsedMap.students[0];
            }

            // PASS 2: PARALLEL QUESTION PROCESSING (The "Brain")
            const questions = parsedMap.questions || [];
            const semaphore = new (window.Semaphore || self.Semaphore)(3); // Throttle to 3 concurrent requests

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
                    return await gradeSingleQuestionUE(apiKey, q, markingSchemeText);
                } finally {
                    semaphore.release();
                }
            });

            const gradedQuestions = await Promise.all(gradingPromises);
            parsedMap.questions = gradedQuestions;

            // PASS 3: THE DUMB AGGREGATOR (The "Reduce" Phase)
            const _calcScores = window.calculateDeterministicScores || self.calculateDeterministicScores;
            const finalData = _calcScores(parsedMap, examInstructions, maxScoreParam);

            return [finalData];

        } catch (error) {
            if (error.message.includes('Fatal configuration error')) {
                throw error;
            }

            attempt++;
            console.warn(`Playbook Engine Attempt ${attempt} failed: ${error.message}`);

            let backoffTime = attempt * 3000;
            if (backoffTime > 60000) backoffTime = 60000;

            console.log(`Self-Healing Loop activated: Retrying in ${backoffTime / 1000} seconds...`);
            const _delay = window.delay || self.delay;
            await _delay(backoffTime);
        }
    }
}

        // Optimization Prompt for Pre-processing
        const UE_OPTIMIZE_PROMPT = `
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

        async function optimizeMarkingSchemeUE(rawText) {
            let attempt = 0;
            while (true) {
                try {
                    const apiKey = await getSecureGeminiKey();

                    const response = await fetch(`${UE_API_URL}?key=${apiKey}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            systemInstruction: {
                                parts: [{ text: UE_OPTIMIZE_PROMPT }]
                            },
                            contents: [
                                { role: 'user', parts: [{ text: rawText }] }
                            ],
                            generationConfig: {
                                temperature: 0.0,
                                topP: 0.1,
                                maxOutputTokens: 8192
                            }
                        })
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        if (response.status === 402) {
                            alert("Payment Required (402). Your Gemini API account has insufficient credits.");
                            throw new Error("Payment Required (402). Credits depleted.");
                        }
                        if (response.status === 400 || response.status === 404) {
                            throw new Error(`Fatal configuration error in Optimization (${response.status}): ${errorText}`);
                        }
                        throw new Error(`Gemini API error: ${response.status} ${errorText}`);
                    }

                    const data = await response.json();
                    let content = data.candidates && data.candidates.length > 0 ? data.candidates[0].content.parts[0].text : "";

                    if (content.startsWith('```')) {
                        content = content.replace(/^```[^\n]*\n|\n```$/g, '');
                    }
                    return content;
                } catch (error) {
                    // Fatal errors that should not be infinitely retried
                    if (error.message.includes('402') || error.message.includes('Fatal configuration error')) {
                        document.getElementById('optimize-scheme-btn').textContent = 'Auto-Format Scheme';
                        document.getElementById('optimize-scheme-btn').disabled = false;
                        throw error;
                    }

                    attempt++;
                    console.warn(`Optimization Attempt ${attempt} failed: ${error.message}`);

                    let backoffTime = attempt * 3000;
                    if (backoffTime > 60000) backoffTime = 60000;

                    console.log(`Self-Healing Loop activated for optimization: Retrying in ${backoffTime / 1000} seconds...`);
                    const _delay = window.delay || self.delay;
                    await _delay(backoffTime);
                }
            }
        }


// Export for both main thread and Web Worker environments
if (typeof window !== 'undefined') {
            window.UE_Engine = { gradeBatchExams: gradeBatchExamsUE, optimizeMarkingSchemeUE: optimizeMarkingSchemeUE };
} else {
            self.UE_Engine = { gradeBatchExams: gradeBatchExamsUE, optimizeMarkingSchemeUE: optimizeMarkingSchemeUE };
}
