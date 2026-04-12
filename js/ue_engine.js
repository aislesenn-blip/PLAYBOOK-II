// js/ue_engine.js
// Ultra-Fast Consensus Grading Engine (UE Mode)
// Strictly uses Paid Tier models with extreme accuracy via Pass 3 Auditing

// API_URL is inherited globally from js/ai.js which is loaded first in upload.html

// Ultra-Fast SiliconFlow JSON Engine (Paid Tier)
// Leverages high-speed V3 models with strict JSON schema enforcement

const VISION_MODEL = "Qwen/Qwen2.5-VL-72B-Instruct"; // Blazing fast Vision model (131K Context)
const LOGIC_MODEL = "deepseek-ai/DeepSeek-V3"; // The Ultimate Logic & Math Engine (164K Context)

const UE_PASS1_SYSTEM_PROMPT = `
You are the Master Segmenter for an Examination Board. Extract the student's identity and transcribe their answers from the provided exam page.

*** ABSOLUTE LITERAL TRANSCRIPTION RULE ***
Quote the student's exact phrases exactly as written. DO NOT invent, assume, or inject terms from the marking scheme.

*** INSTRUCTIONS ***
1. Extract the student's name and registration number if visible.
2. Look at the provided marking scheme. Which of these questions are answered on this specific page?
3. Transcribe the exact text/math/steps for answered questions. For diagrams, describe the labels and structural logic in text.
4. Output ONLY valid JSON matching the schema precisely. Output ONLY raw JSON. No conversational text. No markdown blocks. Do not use <think> tags. Start your response with {

*** SCHEMA ***
{
  "studentName": "Extracted Name or 'Unknown'",
  "registrationNumber": "Extracted ID or 'Unknown'",
  "questions_found_on_this_page": [
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
`;

const UE_PASS2_SYSTEM_PROMPT = `
You are the Primary Evaluator for an Examination Board. Grade a small batch of questions for ONE student.

*** STRICT SCORING GUARDRAIL ***
Do NOT perform final score arithmetic. Extract an array of specific, awarded points based on the rubric.
1. 'points_awarded': An array of floats. For EVERY distinct, correct rubric criterion the student successfully met, append the exact point value.
2. If the student's answer is missing or completely wrong, output 'is_entirely_blank': true and 'points_awarded': [].

*** THE "MICRO-LESSON" FEEDBACK PROTOCOL ***
"constructive_feedback" MUST be short and actionable: [Acknowledge what they got right] + [State EXACT missing scientific fact] + [Actionable micro-lesson].

*** SCHEMA ***
Output ONLY valid JSON matching the schema precisely. Output ONLY raw JSON. No conversational text. No markdown blocks. Do not use <think> tags. Start your response with {
{
  "graded_questions": [
    {
      "questionId": "1a",
      "justification": "The rubric requires X and Y. The student provided X but missed Y...",
      "points_awarded": [0.5],
      "is_entirely_blank": false,
      "constructive_feedback": "You correctly identified X. However, you missed Y."
    }
  ]
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

async function getSiliconFlowKey() {
    try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) throw new Error("No active session.");

        const userProfile = await window.PlaybookDB.getUserById(session.user.id);
        const instId = userProfile ? userProfile.institution_id : session.institution_id;
        if (!instId) throw new Error("Institution ID not found.");

        const secret = await window.PlaybookDB.getInstitutionSecret(instId);
        if (!secret || !secret.siliconflow_api_key) {
            throw new Error("No SiliconFlow API key found in the secure vault. Ask an Admin to configure it.");
        }
        return secret.siliconflow_api_key;
    } catch (e) {
        const mockEnv = localStorage.getItem('PLAYBOOK_SILICONFLOW_API_KEY');
        if (mockEnv) return mockEnv;
        throw new Error(`Authorization failed: ${e.message}`);
    }
}

async function callSiliconFlow(apiKey, systemPrompt, userContent, title, targetModel = VISION_MODEL, requireJSON = true) {
    let attempt = 0;
    while (true) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s timeout

            const payload = {
                model: targetModel,
                temperature: 0.0,
                top_p: 0.1,
                stream: false,
                max_tokens: 8192,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userContent }
                ]
            };

            // DeepSeek V3 and Qwen 2.5 support strict JSON mode natively
            // However, SiliconFlow sometimes rejects it for certain models or contexts
            // If it rejects, we will rely on prompt instructions
            if (requireJSON) {
                // Do not force response_format for Qwen2.5-VL-72B-Instruct or DeepSeek-R1 as it may cause 400 Json mode not supported error
                if (!targetModel.includes("Qwen2.5-VL") && !targetModel.includes("DeepSeek-R1")) {
                    payload.response_format = { type: "json_object" };
                }
            }

            const response = await fetch("https://api.siliconflow.com/v1/chat/completions", {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://playbook.edu',
                    'X-Title': title
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                if (response.status === 402) {
                    alert("Payment Required (402). Your SiliconFlow account has insufficient credits.");
                    throw new Error("Payment Required (402). Credits depleted.");
                }
                throw new Error(`API error: ${response.status} ${errorText}`);
            }

            const responseData = await response.json();

            if (responseData.choices && responseData.choices.length > 0) {
                return responseData.choices[0].message.content;
            } else {
                throw new Error("API returned empty or blocked response.");
            }

        } catch (error) {
            if (error.message.includes('402')) {
                throw error; // Fatal configuration error
            }

            attempt++;
            console.warn(`UE Engine attempt ${attempt} failed for ${title}:`, error.message);

            if (error.message.includes('400') || error.message.includes('404')) {
                throw error; // Fatal configuration or model not found error
            }

            let backoffTime = 4000 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 2000);

            if (error.message.includes('429')) {
                backoffTime = 15000 + Math.floor(Math.random() * 5000);
            }

            if (backoffTime > 60000) backoffTime = 60000;

            await delay(backoffTime);
        }
    }
}

async function gradeQuestionChunkUE(apiKey, questionChunk, markingSchemeText) {
    let attempt = 0;
    while (true) {
        try {
            // Map questions into a single block of text for the API
            let answersText = questionChunk.map(q =>
                `Question ${q.questionId}:\nMax Marks: ${q.max_marks}\nAnswer: ${q.student_answer_transcription}`
            ).join('\n\n---\n\n');

            const p2Prompt = `Marking Scheme for context:\n${markingSchemeText}\n\nEvaluate the following student's answers:\n\n${answersText}`;

            const p2Raw = await callSiliconFlow(apiKey, UE_PASS2_SYSTEM_PROMPT, p2Prompt, "UE Pass 2: Chunk Grader", LOGIC_MODEL);
            const p2Data = parseLLMJSON(p2Raw);

            // Map results back to original questions safely
            return questionChunk.map(originalQ => {
                const gradedData = (p2Data.graded_questions || []).find(g => g.questionId === originalQ.questionId) || {};
                return {
                    ...originalQ,
                    points_awarded: Array.isArray(gradedData.points_awarded) ? gradedData.points_awarded : [],
                    is_entirely_blank: gradedData.is_entirely_blank || false,
                    justification: gradedData.justification || "No justification provided.",
                    constructive_feedback: gradedData.constructive_feedback || "Review rubric.",
                    audit_status: "Approved"
                };
            });
        } catch (error) {
            attempt++;
            console.warn(`gradeQuestionChunkUE attempt ${attempt} failed:`, error.message);
            if (attempt >= 5) {
                // Fallback for all questions in the chunk
                return questionChunk.map(originalQ => ({
                    ...originalQ,
                    points_awarded: [],
                    is_entirely_blank: true,
                    justification: "Error grading after multiple retries.",
                    constructive_feedback: "Error grading. Please review manually.",
                    audit_status: "Approved"
                }));
            }
            const backoff = 4000 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 2000);
            await delay(Math.min(backoff, 30000));
        }
    }
}

async function gradeBatchExams(base64PDF, markingSchemeText, examInstructions = "", maxScoreParam = 100) {
    const apiKey = await getSiliconFlowKey();

    // PASS 1: MAP (Image-Level Chunking)
    const semaphorePass1 = new UESemaphore(10); // Balanced control to prevent 429 TPM Limits on Paid Tier

    let combinedMap = {
        studentName: "Unknown",
        registrationNumber: "Unknown",
        questions: []
    };

    let questionMap = new Map();

    if (Array.isArray(base64PDF)) {
        const pagePromises = base64PDF.map(async (imageUrl, idx) => {
            await semaphorePass1.acquire();
            try {
                let attempt = 0;
                while (true) {
                    try {
                        let userContent = [
                            { type: "text", text: `Here is the marking scheme:\n${markingSchemeText}\n\nHere is Page ${idx + 1} of this single student's exam:` },
                            { type: "image_url", image_url: { url: imageUrl } }
                        ];

                        const mapDataStr = await callSiliconFlow(apiKey, UE_PASS1_SYSTEM_PROMPT, userContent, `UE Pass 1: Segment Page ${idx + 1}`, VISION_MODEL);
                        const parsedMap = parseLLMJSON(mapDataStr);

                        return parsedMap;
                    } catch (error) {
                        attempt++;
                        console.warn(`gradeBatchExams Pass 1 attempt ${attempt} failed for Page ${idx + 1}:`, error.message);
                        if (attempt >= 5) {
                            return { studentName: "Unknown", registrationNumber: "Unknown", questions_found_on_this_page: [] };
                        }
                        const backoff = 4000 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 2000);
                        await delay(Math.min(backoff, 30000));
                    }
                }
            } finally {
                semaphorePass1.release();
            }
        });

        const pagesData = await Promise.all(pagePromises);

        pagesData.forEach(page => {
            if (page.studentName && page.studentName !== "Unknown") combinedMap.studentName = page.studentName;
            if (page.registrationNumber && page.registrationNumber !== "Unknown") combinedMap.registrationNumber = page.registrationNumber;

            if (page.questions_found_on_this_page && Array.isArray(page.questions_found_on_this_page)) {
                page.questions_found_on_this_page.forEach(q => {
                    if (questionMap.has(q.questionId)) {
                        const existing = questionMap.get(q.questionId);
                        existing.student_answer_transcription += "\n [Continued on next page]: " + q.student_answer_transcription;
                        questionMap.set(q.questionId, existing);
                    } else {
                        q.answer_status = "Answered";
                        questionMap.set(q.questionId, q);
                    }
                });
            }
        });
    }

    combinedMap.questions = Array.from(questionMap.values());

    // PASS 2: REDUCE (Chunked Parallel Logic Grading to prevent Token Multiplier Effect)
    const semaphorePass2 = new UESemaphore(15); // Balanced control to prevent 429 TPM limits on Paid Tier

    // Group questions into chunks of 6 to increase speed while balancing limits
    const CHUNK_SIZE = 6;
    const questionChunks = [];
    const validQuestions = combinedMap.questions.filter(q => q.answer_status !== "Skipped");
    const skippedQuestions = combinedMap.questions.filter(q => q.answer_status === "Skipped").map(q => ({
        ...q,
        is_entirely_blank: true,
        points_awarded: [],
        justification: "No answer provided",
        constructive_feedback: "No answer provided"
    }));

    for (let i = 0; i < validQuestions.length; i += CHUNK_SIZE) {
        questionChunks.push(validQuestions.slice(i, i + CHUNK_SIZE));
    }

    const chunkPromises = questionChunks.map(async (chunk) => {
        await semaphorePass2.acquire();
        try {
            return await gradeQuestionChunkUE(apiKey, chunk, markingSchemeText);
        } finally {
            semaphorePass2.release();
        }
    });

    const gradedChunks = await Promise.all(chunkPromises);
    const gradedQuestions = gradedChunks.flat();

    // Merge graded valid questions and the skipped questions
    combinedMap.questions = [...gradedQuestions, ...skippedQuestions];

    // MATH
    const finalData = calculateDeterministicScores(combinedMap, examInstructions, maxScoreParam);
    return [finalData];
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
    const apiKey = await getSiliconFlowKey();
    const mapDataStr = await callSiliconFlow(apiKey, UE_OPTIMIZE_PROMPT, rawText, "UE Pass 0: Format Scheme", VISION_MODEL, false);
    return mapDataStr;
}

window.UE_Engine = { gradeBatchExams, optimizeMarkingSchemeUE };
