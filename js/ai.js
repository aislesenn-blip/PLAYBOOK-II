// js/ai.js
// Playbook Central Intelligence Engine (Client-Side Distributed Processing)

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";

const SYSTEM_PROMPT = `
You are the Chief Examiner for a World-Class International Examination Board. Your mandate is to evaluate a handwritten student exam against a strict marking scheme with absolute fairness, deterministic logic, and zero hallucinations.

CRITICAL EVALUATION MANDATE: The images provided represent exactly ONE student's exam. You MUST evaluate this single student.

THE "NO GHOST GRADING" RULE (ABSOLUTE MANDATE): You are STRICTLY FORBIDDEN from skipping any question. Your JSON output MUST contain an evaluation object for EVERY SINGLE QUESTION defined in the marking scheme. If a student completely skipped a question, you MUST include it with "answer_status": "Skipped", "marks_awarded": 0, and "constructive_feedback": "You did not attempt this question."

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

async function getSecureKeys() {
    try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) throw new Error("No active session.");

        const userProfile = await window.PlaybookDB.getUserById(session.user.id);
        const secret = await window.PlaybookDB.getInstitutionSecret(userProfile.institution_id);

        if (!secret || !secret.aws_access_key || !secret.aws_secret_key || !secret.aws_region || !secret.deepseek_api_key) {
            throw new Error("Missing AWS Textract credentials or DeepSeek API key in the secure vault. Ask an Admin to configure them.");
        }
        return {
            awsAccessKeyId: secret.aws_access_key,
            awsSecretAccessKey: secret.aws_secret_key,
            awsRegion: secret.aws_region,
            deepseekKey: secret.deepseek_api_key
        };
    } catch (e) {
        throw new Error(`Authorization failed: ${e.message}`);
    }
}

// Helper function for exponential backoff delay
const delay = ms => new Promise(res => setTimeout(res, ms));

// Helper to call AWS Textract for OCR
async function callTextractVision(images, credentials) {
    if (!window.AWS) {
        throw new Error("AWS SDK is not loaded. Ensure the AWS SDK script is included in the HTML.");
    }

    // Configure AWS with the provided credentials
    window.AWS.config.update({
        accessKeyId: credentials.awsAccessKeyId,
        secretAccessKey: credentials.awsSecretAccessKey,
        region: credentials.awsRegion
    });

    const textract = new window.AWS.Textract();
    let fullText = "";

    for (const dataUrl of images) {
        // Convert base64 data URL to raw binary Uint8Array
        const base64Data = dataUrl.split(',')[1];
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const params = {
            Document: {
                Bytes: bytes
            }
        };

        try {
            const result = await textract.detectDocumentText(params).promise();
            // Extract the LINE blocks from the result
            const lines = result.Blocks.filter(block => block.BlockType === 'LINE').map(block => block.Text);
            fullText += lines.join('\n') + '\n\n---PAGE_BREAK---\n\n';
        } catch (err) {
            throw new Error(`AWS Textract error: ${err.message}`);
        }
    }

    return fullText;
}

// Helper to call DeepSeek API
async function callDeepSeek(userContent, systemPrompt, apiKey, isJson = false) {
    const body = {
        model: 'deepseek-reasoner',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent }
        ]
    };

    // deepseek-reasoner does not support temperature=0.0 or response_format: json_object
    // So we just rely on prompt engineering to return valid JSON

    const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`DeepSeek API error: ${response.status} ${err}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
}

// Client-Side Distributed Grading Engine
async function gradeBatchExams(base64PDF, markingSchemeText, maxRetries = 3) {
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            const keys = await getSecureKeys();

            // STEP 1: OCR via AWS Textract
            const extractedText = await callTextractVision(base64PDF, keys);

            // STEP 2: Grading via DeepSeek
            const gradingPrompt = `Here is the marking scheme:\n${markingSchemeText}\n\nHere is the extracted text from the single student's exam:\n${extractedText}`;
            let content = await callDeepSeek(gradingPrompt, SYSTEM_PROMPT, keys.deepseekKey, true);

            if (content.startsWith('```json')) content = content.replace(/^```json\n|\n```$/g, '');
            else if (content.startsWith('```')) content = content.replace(/^```\n|\n```$/g, '');

            // JSON Sanitizer
            content = content.replace(/(?<!\\)\\(?!["\\/n])/g, '\\\\');

            const parsedData = JSON.parse(content);

            if (parsedData.students && Array.isArray(parsedData.students)) {
                return parsedData.students;
            }

            return [parsedData];

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
                    const keys = await getSecureKeys();

                    let textToProcess = rawText;

                    if (Array.isArray(rawText)) {
                        textToProcess = await callTextractVision(rawText, keys);
                    }

                    let content = await callDeepSeek(textToProcess, OPTIMIZE_PROMPT, keys.deepseekKey, false);

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

// Export for both main thread and Web Worker environments
if (typeof window !== 'undefined') {
            window.PlaybookAI = { gradeBatchExams, optimizeMarkingScheme };
} else {
            self.PlaybookAI = { gradeBatchExams, optimizeMarkingScheme };
}
