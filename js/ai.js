// js/ai.js
// Playbook Central Intelligence Engine (Client-Side Distributed Processing)

const API_URL = "https://openrouter.ai/api/v1/chat/completions";

class Semaphore {
    constructor(maxConcurrent) {
        this.maxConcurrent = maxConcurrent;
        this.currentConcurrent = 0;
        this.queue = [];
    }

    async acquire() {
        if (this.currentConcurrent < this.maxConcurrent) {
            this.currentConcurrent++;
            return;
        }
        return new Promise(resolve => this.queue.push(resolve));
    }

    release() {
        this.currentConcurrent--;
        if (this.queue.length > 0) {
            this.currentConcurrent++;
            const next = this.queue.shift();
            next();
        }
    }
}

function parseLLMJSON(content) {
    if (!content || !content.trim()) {
        return { is_entirely_blank: true, justification: "LLM returned completely empty response.", total_correct_points_found: 0, constructive_feedback: "Error processing this question." };
    }

    let sanitized = content;
    if (sanitized.startsWith('```json')) sanitized = sanitized.replace(/^```json\n|\n```$/g, '');
    else if (sanitized.startsWith('```')) sanitized = sanitized.replace(/^```\n|\n```$/g, '');

    // JSON Sanitizer: Double-escape unescaped backslashes and strip control chars
    sanitized = sanitized.replace(/(?<!\\)\\(?!["\\/n])/g, '\\\\');
    sanitized = sanitized.replace(/[\u0000-\u001F]+/g, ' ');

    try {
        return JSON.parse(sanitized);
    } catch (e) {
        // Attempt advanced repair by tracking open braces up to a safe structural boundary
        // For now, if naive parse fails, throw explicit error for the retry loop to catch
        throw new Error("JSON parse failed. Requires retry.");
    }
}

const PASS1_SYSTEM_PROMPT = `
You are Pass 1 of the Playbook AI engine. Your job is to extract the structure of the exam from the marking scheme.

You MUST read the marking scheme and output a JSON array of question objects.
For each question, extract:
1. "questionId": The ID of the question (e.g., "1a").
2. "questionTitle": A brief title or description of the question.
3. "max_marks": The maximum marks for this question (number).
4. "expected_number_of_items": The integer count of discrete scoring items or points expected by the marking scheme for full marks.
   - e.g., if the marking scheme says "Award 1 mark for X, 1 mark for Y, 1 mark for Z", expected_number_of_items is 3.
   - if it says "Give 2 marks for a clear definition", expected_number_of_items is 1.

JSON Output Schema:
{
  "questions": [
    { "questionId": "1a", "questionTitle": "Brief title", "max_marks": 5, "expected_number_of_items": 5, "markingSchemeText": "Exact text of the scheme for this question" }
  ]
}
`;

const PASS2_SYSTEM_PROMPT = `
You are Pass 2 of the Playbook Central Intelligence Engine. Your mandate is to evaluate ONE specific question for a handwritten student exam against its strict marking scheme with absolute fairness, deterministic logic, and zero hallucinations.

CRITICAL MANDATES:
VISUAL DIAGRAMS MANDATE: Explicitly evaluate hand-drawn visuals, graphs, and spatial logic if required by the scheme.
LOGICAL CONSISTENCY: Your reasoning MUST directly match your boolean output.
BLANK ANSWER HANDLING: If the student completely skipped the question or wrote generic filler text, set "is_entirely_blank" to true.

SEMANTIC EQUIVALENCE: DO NOT penalize for poor English or missing exact keywords if the SCIENTIFIC MEANING is correct. Award full marks for correct concepts.
THE FATAL FLAW: If the student's answer contains fundamentally incorrect concepts, penalize accordingly. Be ruthless.

*** THE "MICRO-LESSON" FEEDBACK PROTOCOL (CRITICAL) ***
Your "constructive_feedback" MUST be unforgettable, short, and directly actionable. Maximum 3 sentences.
Rule 1: Speak directly to the student as an elite Professor (Use "You").
Rule 2: NEVER use lazy phrases like "Study more" or "Expand on this."
Rule 3: Use this exact formula: [Acknowledge what they got right, if anything] + [State the EXACT missing scientific fact from the rubric] + [Actionable micro-lesson to never miss it again].

*** CHAIN-OF-THOUGHT JSON SCHEMA (STRICT ENFORCEMENT) ***
You MUST generate the "justification" BEFORE the integer outputs to prevent hallucinations. You MUST NOT perform any proportional math. Only extract the count of correct items found.
Output ONLY valid JSON. No markdown formatting. Return the evaluation for this ONE question.

{
  "justification": "Step 1: Rubric requires X. Step 2: Student wrote Y. Step 3: Match is correct/incorrect.",
  "constructive_feedback": "The strict Micro-Lesson feedback as defined above.",
  "total_correct_points_found": 2,
  "is_entirely_blank": false
}
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

const semaphore = new Semaphore(5); // Adjust based on rate limits

async function runPass1(markingSchemeText, maxRetries = 3) {
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
                    seed: 42,
                    messages: [
                        { role: 'system', content: PASS1_SYSTEM_PROMPT },
                        { role: 'user', content: markingSchemeText }
                    ],
                    response_format: { type: "json_object" }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`OpenRouter API error (Pass 1): ${response.status} ${errorText}`);
            }

            const data = await response.json();
            const content = data.choices[0].message.content;
            return parseLLMJSON(content).questions || [];
        } catch (error) {
            attempt++;
            console.warn(`Pass 1 Attempt ${attempt} failed: ${error.message}`);
            if (attempt >= maxRetries) throw error;
            await delay(attempt * 3000);
        }
    }
}

async function gradeSingleQuestion(images, questionData, maxRetries = 3) {
    await semaphore.acquire();
    let attempt = 0;
    try {
        while (attempt < maxRetries) {
            try {
                const apiKey = await getSecureKey();
                const userContent = [
                    {
                        type: "text",
                        text: `Here is the specific question and marking scheme you must evaluate:\nQuestion ID: ${questionData.questionId}\nTitle: ${questionData.questionTitle}\nMax Marks: ${questionData.max_marks}\nExpected Count of Items: ${questionData.expected_number_of_items}\nScheme:\n${questionData.markingSchemeText}\n\nEvaluate the student's handwritten response in these images against this exact question:`
                    }
                ];
                images.forEach(imageUrl => {
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
                        seed: 42,
                        messages: [
                            { role: 'system', content: PASS2_SYSTEM_PROMPT },
                            { role: 'user', content: userContent }
                        ],
                        response_format: { type: "json_object" }
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`OpenRouter API error (Pass 2): ${response.status} ${errorText}`);
                }

                const data = await response.json();
                const content = data.choices[0].message.content;
                const result = parseLLMJSON(content);

                return {
                    questionId: questionData.questionId,
                    questionTitle: questionData.questionTitle,
                    max_marks: questionData.max_marks,
                    expected_number_of_items: questionData.expected_number_of_items,
                    ...result
                };
            } catch (error) {
                attempt++;
                console.warn(`Pass 2 Question ${questionData.questionId} Attempt ${attempt} failed: ${error.message}`);
                if (attempt >= maxRetries) {
                    return {
                        questionId: questionData.questionId,
                        questionTitle: questionData.questionTitle,
                        max_marks: questionData.max_marks,
                        expected_number_of_items: questionData.expected_number_of_items,
                        is_entirely_blank: false,
                        total_correct_points_found: 0,
                        justification: "Error grading.",
                        constructive_feedback: "Error processing this question."
                    };
                }
                await delay(attempt * 3000);
            }
        }
    } finally {
        semaphore.release();
    }
}

function parseSectionRules(examInstructions) {
    // Basic implementation for dropping lowest scores if needed based on instructions
    // This can be expanded based on specific regex matching needs mentioned in memory.
    // For now, it returns a default config.
    return { rules: [] };
}

function calculateDeterministicScores(results, examInstructions) {
    const finalResults = [];
    let totalScore = 0;

    // In a full implementation, apply section rules here to drop lowest scores.
    // For now, process each question deterministically without math hallucinations.
    for (const res of results) {
        let questionScore = 0;
        let finalStatus = "Answered";

        if (res.is_entirely_blank || res.answer_status === 'Skipped') {
            questionScore = 0;
            finalStatus = "Skipped";
        } else {
            const pointsFound = res.total_correct_points_found || 0;
            const expectedItems = res.expected_number_of_items || 1;
            const maxMarks = res.max_marks || 0;

            // Decoupled exact calculation: prevent denominator bugs and hallucinations
            const ratio = Math.min(pointsFound / expectedItems, 1.0);
            questionScore = ratio * maxMarks;
        }

        totalScore += questionScore;
        finalResults.push({
            ...res,
            score: questionScore,
            marks_awarded: questionScore,
            answer_status: finalStatus
        });
    }

    return { totalScore, questions: finalResults };
}

// Client-Side Distributed Grading Engine
async function gradeBatchExams(base64PDF, markingSchemeText, maxRetries = 3) {
    try {
        // Step 1: Map (Pass 1) - Extract questions from marking scheme
        const questionsData = await runPass1(markingSchemeText);

        if (!questionsData || questionsData.length === 0) {
            throw new Error("Pass 1 failed to extract any questions from the marking scheme.");
        }

        // Step 2: Map (Pass 2) - Grade single questions in parallel
        const evaluationPromises = questionsData.map(qData =>
            gradeSingleQuestion(base64PDF, qData)
        );

        const rawResults = await Promise.all(evaluationPromises);

        // Step 3: Reduce - Deterministically calculate scores
        // Note: examInstructions could be passed in, currently defaults to empty.
        const { totalScore, questions } = calculateDeterministicScores(rawResults, "");

        // Return the student object compatible with existing upload.js
        return [{
            studentName: "Unknown",
            registrationNumber: "Unknown",
            total_score: totalScore,
            questions: questions
        }];

    } catch (error) {
        console.error("Error in Playbook Map-Reduce engine:", error);
        throw error;
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

// Export for both main thread and Web Worker environments
if (typeof window !== 'undefined') {
            window.PlaybookAI = { gradeBatchExams, optimizeMarkingScheme };
} else {
            self.PlaybookAI = { gradeBatchExams, optimizeMarkingScheme };
}