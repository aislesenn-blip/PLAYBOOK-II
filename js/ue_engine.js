// js/ue_engine.js
// Ultra-Fast Consensus Grading Engine (UE Mode)
// Strictly uses Free Tier models with extreme accuracy via Pass 3 Auditing

// API_URL is inherited globally from js/ai.js which is loaded first in upload.html

// Hybrid Enterprise "Cheap & Fast" Model Routing
const VISION_MODEL = "google/gemini-2.0-flash-lite-preview-02-05:free"; // Extracts images fast & cheap
const LOGIC_MODEL = "google/gemini-2.0-flash-lite-preview-02-05:free"; // DeepSeek V3: Ultra-cheap, ultra-smart logic

const UE_PASS1_SYSTEM_PROMPT = `
You are the Master Segmenter for an Examination Board. Your job is to extract the student's identity and transcribe their answers from a SINGLE page of their exam.

*** MANDATE ***
You must analyze this single page and extract ONLY the answers visible on this specific image. Do not invent answers. Do not cross-contaminate.

*** ABSOLUTE LITERAL TRANSCRIPTION RULE ***
You MUST act as a literal transcriber. Quote the student's exact phrases exactly as written on this page. DO NOT invent, assume, or inject terms from the marking scheme. If the student did not explicitly write it ON THIS SPECIFIC PAGE, you must not extract it.

*** INSTRUCTIONS ***
1. Check if the student's name and registration number are visible ON THIS PAGE. If not, output "Unknown".
2. Look at the provided marking scheme. Which of these questions are answered ON THIS SPECIFIC PAGE?
3. For the questions answered ON THIS PAGE, transcribe their exact text/math/steps. For diagrams, describe the labels and structural logic in text.
4. ONLY output questions that have answers visibly written on this page. If a question from the rubric is not answered on this page, DO NOT include it in the JSON array.
5. Identify the maximum number of items the student is explicitly asked to provide (e.g., 'Name 5 sensors' = 5). Store this as 'expected_number_of_items'.
6. ONLY output valid JSON using the exact schema below. Output ONLY raw JSON. No conversational text. Start your response with {

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
      "student_answer_transcription": "The exact text written by the student on this page: '...'"
    }
  ]
}
`;

const UE_PASS2_SYSTEM_PROMPT = `
You are the Primary Evaluator for an Examination Board. Grade exactly ONE question for ONE student.

*** STRICT SCORING GUARDRAIL ***
Do NOT perform final score arithmetic. Your ONLY job is to extract an array of specific, awarded points based on the rubric.
1. 'points_awarded': An array of floats. For EVERY distinct, correct rubric criterion the student successfully met, append the exact point value.
2. If the student's answer is missing or completely wrong, output 'is_entirely_blank': true and 'points_awarded': [].

*** THE "MICRO-LESSON" FEEDBACK PROTOCOL ***
Your "constructive_feedback" MUST be short and directly actionable. Use this exact formula: [Acknowledge what they got right] + [State the EXACT missing scientific fact from the rubric] + [Actionable micro-lesson].

*** SCHEMA ***
{
  "justification": "The rubric requires X and Y. The student provided X but missed Y...",
  "points_awarded": [0.5],
  "is_entirely_blank": false,
  "constructive_feedback": "You correctly identified X. However, you missed Y."
}
`;

const UE_PASS3_AUDITOR_PROMPT = `
You are the Chief Auditor for an Examination Board. Your job is to review the Primary Evaluator's grading decision for ONE question.

*** MANDATE ***
Read the Marking Scheme. Read the Student's Answer. Read the Primary Evaluator's "points_awarded", "justification", and "constructive_feedback".
Did the Primary Evaluator make a mistake? Did they miss partial credit? Did they penalize something unfairly?

If the Primary Evaluator was correct, you must output "audit_status": "Approved" and pass through their data exactly.
If the Primary Evaluator was wrong, you must output "audit_status": "Overridden", output your corrected "points_awarded", and rewrite the "justification" explaining exactly what the primary evaluator missed.

*** SCHEMA ***
{
  "audit_status": "Approved | Overridden",
  "justification": "(Auditor Override: [Your explanation]) OR (the original justification)",
  "points_awarded": [0.5, 1.0],
  "is_entirely_blank": false,
  "constructive_feedback": "..."
}
`;

// Helper: Dumb Aggregator (Reduce Phase)
function calculateDeterministicScores(extractedData, examInstructions, maxScoreParam = 100) {
    if (!extractedData || !extractedData.questions) return extractedData;

    extractedData.questions.forEach(q => {
        if (q.answer_status === "Skipped" || q.is_entirely_blank) {
            q.marks_awarded = 0;
            q.score = 0;
        } else {
            const maxMarksRaw = q.max_marks !== undefined ? q.max_marks : (q.max !== undefined ? q.max : 0);
            const maxMarks = Math.max(parseFloat(maxMarksRaw) || 0, 0);
            q.max_marks = maxMarks;

            let aiCalculatedMarks = 0;
            if (Array.isArray(q.points_awarded)) {
                aiCalculatedMarks = q.points_awarded.reduce((sum, point) => sum + (parseFloat(point) || 0), 0);
            }
            aiCalculatedMarks = isNaN(aiCalculatedMarks) ? 0 : aiCalculatedMarks;
            aiCalculatedMarks = Math.round(aiCalculatedMarks * 100) / 100;

            let finalScore = Math.min(aiCalculatedMarks, maxMarks);
            q.marks_awarded_by_ai = aiCalculatedMarks;
            q.score = finalScore;
            q.marks_awarded = finalScore;
        }
    });

    let totalScore = 0;
    extractedData.questions.forEach(q => {
        totalScore += (q.marks_awarded || 0);
    });

    extractedData.totalScore = totalScore;
    extractedData.maxScore = maxScoreParam;

    return extractedData;
}

const delay = ms => new Promise(res => setTimeout(res, ms));

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

async function getSecureKey() {
    try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) throw new Error("No active session.");

        const userProfile = await window.PlaybookDB.getUserById(session.user.id);
        const instId = userProfile ? userProfile.institution_id : session.institution_id;
        if (!instId) throw new Error("Institution ID not found.");

        const secret = await window.PlaybookDB.getInstitutionSecret(instId);
        if (!secret || !secret.openrouter_api_key) throw new Error("No OpenRouter API key found");
        return secret.openrouter_api_key;
    } catch (e) {
        const mockEnv = localStorage.getItem('playbook_mock_api_key');
        if (mockEnv) return mockEnv;
        throw new Error(`Authorization failed: ${e.message}`);
    }
}

async function callOpenRouter(apiKey, systemPrompt, userContent, title, targetModel, requireJSON = true) {
    let attempt = 0;
    while (true) {
        try {
            const payload = {
                model: targetModel,
                temperature: 0.0,
                top_p: 0.1,
                seed: 42,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userContent }
                ]
            };

            if (requireJSON) {
                payload.response_format = { type: "json_object" };
            }

            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://playbook.edu',
                    'X-Title': title
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API error: ${response.status} ${errorText}`);
            }

            const data = await response.json();
            return data.choices[0].message.content;

        } catch (error) {
            attempt++;
            console.warn(`UE Engine attempt ${attempt} failed for ${title}:`, error.message);

            // Infinite retries for guaranteed free-tier grading
            let backoffTime = 4000 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 2000);
            if (backoffTime > 30000) backoffTime = 30000;

            await delay(backoffTime);
        }
    }
}

function parseLLMJSON(content) {
    if (!content || content.trim() === '') return { is_entirely_blank: true };
    try {
        let clean = content.replace(/^```json\s*/gi, '').replace(/^```\s*/gi, '').replace(/```\s*$/gi, '');
        let startIndex = clean.indexOf('{');
        let endIndex = clean.lastIndexOf('}');
        if (startIndex !== -1 && endIndex !== -1) {
            clean = clean.substring(startIndex, endIndex + 1);
        }
        return JSON.parse(clean);
    } catch (e) {
        return { is_entirely_blank: true, justification: "JSON Parse Error in Free Model" };
    }
}

async function gradeSingleQuestionUE(apiKey, questionData, markingSchemeText) {
    // 1. Primary Grader (Pass 2)
    const p2Prompt = `Marking Scheme for context:\n${markingSchemeText}\n\nEvaluate the following student's answer for Question ${questionData.questionId}:\nMax Marks: ${questionData.max_marks}\nAnswer: ${questionData.student_answer_transcription}`;
    const p2Raw = await callOpenRouter(apiKey, UE_PASS2_SYSTEM_PROMPT, p2Prompt, "UE Pass 2: Primary Grader", LOGIC_MODEL);
    const p2Data = parseLLMJSON(p2Raw);

    // 2. Auditor (Pass 3)
    const p3Prompt = `Marking Scheme:\n${markingSchemeText}\n\nStudent Answer for Question ${questionData.questionId}:\n${questionData.student_answer_transcription}\n\nPrimary Evaluator's Decision:\n${JSON.stringify(p2Data, null, 2)}\n\nReview this decision now.`;
    const p3Raw = await callOpenRouter(apiKey, UE_PASS3_AUDITOR_PROMPT, p3Prompt, "UE Pass 3: Auditor", LOGIC_MODEL);
    const p3Data = parseLLMJSON(p3Raw);

    return {
        ...questionData,
        points_awarded: Array.isArray(p3Data.points_awarded) ? p3Data.points_awarded : [],
        is_entirely_blank: p3Data.is_entirely_blank || false,
        justification: p3Data.justification || p2Data.justification || "No justification provided.",
        constructive_feedback: p3Data.constructive_feedback || p2Data.constructive_feedback || "Review rubric.",
        audit_status: p3Data.audit_status || "Approved"
    };
}

async function gradeBatchExams(base64PDF, markingSchemeText, examInstructions = "", maxScoreParam = 100) {
    const apiKey = await getSecureKey();

    // PASS 1: MAP (Image-Level Chunking)
    const semaphorePass1 = new UESemaphore(5); // Keep at 5 to protect Free Tier limits

    let combinedMap = {
        studentName: "Unknown",
        registrationNumber: "Unknown",
        questions: []
    };

    let questionMap = new Map(); // Use Map to stitch multi-page answers

    if (Array.isArray(base64PDF)) {
        const pagePromises = base64PDF.map(async (imageUrl, idx) => {
            await semaphorePass1.acquire();
            try {
                let userContent = [
                    { type: "text", text: `Here is the marking scheme:\n${markingSchemeText}\n\nHere is Page ${idx + 1} of this single student's exam:` },
                    { type: "image_url", image_url: { url: imageUrl } }
                ];

                const mapDataStr = await callOpenRouter(apiKey, UE_PASS1_SYSTEM_PROMPT, userContent, `UE Pass 1: Segment Page ${idx + 1}`, VISION_MODEL);
                const parsedMap = parseLLMJSON(mapDataStr);

                return parsedMap;
            } finally {
                semaphorePass1.release();
            }
        });

        const pagesData = await Promise.all(pagePromises);

        // Stitch the data together
        pagesData.forEach(page => {
            if (page.studentName && page.studentName !== "Unknown") {
                combinedMap.studentName = page.studentName;
            }
            if (page.registrationNumber && page.registrationNumber !== "Unknown") {
                combinedMap.registrationNumber = page.registrationNumber;
            }

            if (page.questions_found_on_this_page && Array.isArray(page.questions_found_on_this_page)) {
                page.questions_found_on_this_page.forEach(q => {
                    if (questionMap.has(q.questionId)) {
                        // Stitch multi-page answers together
                        const existing = questionMap.get(q.questionId);
                        existing.student_answer_transcription += "\n [Continued on next page]: " + q.student_answer_transcription;
                        questionMap.set(q.questionId, existing);
                    } else {
                        q.answer_status = "Answered"; // It was found, so it's answered
                        questionMap.set(q.questionId, q);
                    }
                });
            }
        });
    }

    combinedMap.questions = Array.from(questionMap.values());

    // PASS 2 & 3: REDUCE AND AUDIT
    const semaphorePass2 = new UESemaphore(5); // Keep at 5 to protect Free Tier limits

    const gradingPromises = combinedMap.questions.map(async (q) => {
        await semaphorePass2.acquire();
        try {
            return await gradeSingleQuestionUE(apiKey, q, markingSchemeText);
        } finally {
            semaphorePass2.release();
        }
    });

    const gradedQuestions = await Promise.all(gradingPromises);
    combinedMap.questions = gradedQuestions;

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
    const apiKey = await getSecureKey();
    const mapDataStr = await callOpenRouter(apiKey, UE_OPTIMIZE_PROMPT, rawText, "UE Pass 0: Format Scheme", LOGIC_MODEL, false);
    let content = mapDataStr;
    if (content.startsWith('\`\`\`')) {
        content = content.replace(/^\`\`\`[^\n]*\n|\n\`\`\`$/g, '');
    }
    return content;
}

window.UE_Engine = { gradeBatchExams, optimizeMarkingSchemeUE };
