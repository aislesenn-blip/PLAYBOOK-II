// js/ai.js
// Playbook Central Intelligence Engine (Client-Side Distributed Processing)

const API_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `
You are the Chief Examiner for a World-Class International Examination Board. Your mandate is to evaluate a handwritten student exam against a strict marking scheme with absolute fairness, deterministic logic, and zero hallucinations.

CRITICAL EVALUATION MANDATE: The images provided represent exactly ONE student's exam. You MUST evaluate this single student.

THE "NO GHOST GRADING" RULE (ABSOLUTE MANDATE): You are STRICTLY FORBIDDEN from skipping any question. Your JSON output MUST contain an evaluation object for EVERY SINGLE QUESTION defined in the marking scheme. If a student completely skipped a question, you MUST include it with "answer_status": "Skipped", "marks_awarded": 0, and "constructive_feedback": "You did not attempt this question."

THE "HARD CEILING" RULE (ABSOLUTE MANDATE): You are STRICTLY FORBIDDEN from hallucinating marks. Under NO CIRCUMSTANCES can the \`marks_awarded\` for a question exceed the \`max_marks\` defined for that specific question in the marking scheme. If a question is worth 5 marks, the maximum you can award is 5.

*** THE 4 TIERS OF EVALUATION ***

SEMANTIC EQUIVALENCE: DO NOT penalize for poor English or missing exact keywords if the SCIENTIFIC MEANING is correct. Award full marks for correct concepts.
PROPORTIONAL MATH: For multi-point questions, mathematically reward what is present. (e.g., 2 valid reasons out of 5 required = 40% of marks).
THE FATAL FLAW: If the student's answer contains fundamentally incorrect concepts, the score MUST BE 0. No pity marks for wrong science. Be ruthless.
DIAGRAM AMNESTY: DO NOT penalize for missing sketches/diagrams, as OCR vision may miss them. Grade based strictly on the text.

*** THE "MICRO-LESSON" FEEDBACK PROTOCOL (CRITICAL) ***
Your "constructive_feedback" MUST be unforgettable, short, and directly actionable. Maximum 3 sentences.

Rule 1: Speak directly to the student as an elite Professor (Use "You").
Rule 2: NEVER use lazy phrases like "Study more" or "Expand on this."
Rule 3: Use this exact formula: [Acknowledge what they got right, if anything] + [State the EXACT missing scientific fact from the rubric] + [Actionable micro-lesson to never miss it again].
Perfect Example: "You correctly defined hydroponics, but you missed 'capillarity'. Next time, remember that a Wicking system relies specifically on capillarity action to pull water up to the roots."

*** CHAIN-OF-THOUGHT JSON SCHEMA (STRICT ENFORCEMENT) ***
You MUST generate the "justification" BEFORE the "marks_awarded" to prevent hallucinations. Output ONLY valid JSON. No markdown formatting. Return the evaluation for this ONE student.

{ "studentName": "Extracted Name or 'Unknown'", "registrationNumber": "Extracted ID or 'Unknown'", "maxScore": 100, "questions": [ { "questionId": "1a", "questionTitle": "Brief title", "answer_status": "Answered | Skipped", "justification": "Step 1: Rubric requires X. Step 2: Student wrote Y. Step 3: Match is correct/incorrect.", "marks_awarded": 2, "max_marks": 5, "constructive_feedback": "The strict Micro-Lesson feedback as defined above." } ] }
`;

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

// Client-Side Distributed Grading Engine
async function gradeBatchExams(base64PDF, markingSchemeText, maxRetries = 3) {
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            const apiKey = await getSecureKey();

            // Ensure backwards compatibility and dynamic context building
            // We now accept an array of image data URLs directly from the browser's PDF parser
            // This is 100% compatible with GPT-4o's vision capabilities and completely avoids PDF parsing errors.
            const userContent = [
                {
                    type: "text",
                    text: `Here is the marking scheme:\n${markingSchemeText}\n\nHere are the scanned pages of this single student's exam:`
                }
            ];

            // Ensure base64PDF is treated as an array of image URLs (handled by upload.js)
            base64PDF.forEach(imageUrl => {
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
                    model: 'google/gemini-2.0-flash-001', // Required model: Guaranteed massive context window support on OpenRouter
                    temperature: 0.0,
                    seed: 42,
                    max_tokens: 8192, // Explicitly required so the LLM doesn't truncate massive batch JSON arrays mid-sentence
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user', content: userContent }
                    ],
                    response_format: { type: "json_object" }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
            }

            const data = await response.json();
            let content = data.choices[0].message.content;

            if (content.startsWith('```json')) content = content.replace(/^```json\n|\n```$/g, '');
            else if (content.startsWith('```')) content = content.replace(/^```\n|\n```$/g, '');

            // JSON Sanitizer: Robustly double-escape unescaped backslashes to prevent "Bad escaped character" JSON.parse errors.
            // This safely preserves valid JSON structure escapes (\", \\, \/, \n) but double-escapes everything else (e.g. \frac, \sin, \theta)
            // by matching any backslash NOT preceded by a backslash AND NOT followed by ", \, /, or n.
            content = content.replace(/(?<!\\)\\(?!["\\/n])/g, '\\\\');

            const parsedData = JSON.parse(content);

            // Handle backward compatibility: If AI hallucinated a 'students' array wrapper despite the single-student prompt
            if (parsedData.students && Array.isArray(parsedData.students)) {
                return parsedData.students;
            }

            // Standard Single Student Object mapping
            return [parsedData];

        } catch (error) {
            attempt++;
            console.warn(`Playbook Engine Attempt ${attempt} failed: ${error.message}`);

            // If we've exhausted all retries, throw the error to halt the queue
            if (attempt >= maxRetries) {
                console.error("Error in Playbook grading engine (All retries exhausted):", error);
                throw error;
            }

            // Exponential backoff: Wait 3s, then 6s, before retrying
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

NO DATA LOSS: Preserve every alternative answer and exact mark allocation.
STRICT HIERARCHY: Every single question/sub-question MUST have its own block. Do not merge sub-questions.
Output ONLY the structured text. No markdown block wrapping (\`\`\`).
=== PLAYBOOK STANDARD FORMAT EXAMPLE ===
Question 1a: Definition (Max: 3 marks)

Award [1 mark] for stating "conversion of light energy to chemical energy".
Award [1 mark] for explicitly writing "Chlorophyll".
Award [1 mark] for mentioning "Water".

Question 1b: Diagram (Max: 2 marks)

Award [1 mark] if a leaf shape is clearly drawn.
Award [1 mark] ONLY IF an arrow is drawn pointing into the leaf and is labeled "Sunlight".
=========================================
`;

        async function optimizeMarkingScheme(rawText, maxRetries = 3) {
            let attempt = 0;
            while (attempt < maxRetries) {
                try {
                    const apiKey = await getSecureKey();

                    let userContent = rawText;

                    if (Array.isArray(rawText)) {
                        userContent = [
                            {
                                type: "text",
                                text: `Here are the scanned pages of a marking scheme. Please transcribe and rewrite them into the strict "Playbook Standard Format".`
                            }
                        ];
                        rawText.forEach(imageUrl => {
                            userContent.push({
                                type: "image_url",
                                image_url: { url: imageUrl }
                            });
                        });
                    }

                    const response = await fetch(API_URL, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${apiKey}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            model: 'google/gemini-2.0-flash-001',
                            temperature: 0.0,
                            seed: 42,
                            messages: [
                                {
                                    role: 'system',
                                    content: OPTIMIZE_PROMPT
                                },
                                {
                                    role: 'user',
                                    content: userContent
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