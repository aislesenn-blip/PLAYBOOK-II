// js/ai.js
// Playbook Central Intelligence Engine (Client-Side Distributed Processing)

const API_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `
You are the Chief Data Extractor for a World-Class International Examination Board. Your mandate is to extract attempt status and boolean logic from a handwritten student exam against a strict marking scheme.

CRITICAL EVALUATION MANDATE: The images provided represent exactly ONE student's exam. You MUST evaluate this single student.

*** CLEAN ARCHITECTURE (THE INPUTS) ***
You will receive the following immutable inputs:
1. The Question
2. Total Marks Available
3. Teacher's Marking Basis (structured scheme or model answer)
4. The Student's Answer

*** THE 3-STEP AUTONOMOUS ENGINE ***
Once inputs are received, you MUST automatically execute these three steps in your Chain of Thought before outputting the boolean evaluation logic:
Step 1: Analyze the Marking Basis: Scan the provided scheme or model answer and detect underlying "concept clusters."
Step 2: Derive Scoring Units: Internally divide the expected answer into distinct, lock-tight scoring units. Lock this internal structure as the absolute source of truth.
Step 3: Deterministic Semantic Grading: Compare the student's answer against these locked scoring units using deterministic semantic logic to ensure consistent, unbiased grading.

*** THE 4 TIERS OF EVALUATION (CoT GRADING CONSTRAINTS) ***
While executing the semantic grading, you MUST strictly filter your decisions through these 4 tiers:
Tier 1: Semantic Equivalence: Evaluate based on the understanding of meaning, not just exact keyword matching. If the student explains the concept correctly using different vocabulary, the criterion is met (true).
Tier 2: Proportional Math: Evaluate individual scoring units precisely so that partial credit can be correctly derived by the local engine (e.g., if a student gets 3 out of 4 steps correct, you must output 4 criteria where 3 are true and 1 is false).
Tier 3: The Fatal Flaw Rule: If the student's answer contains a fundamental violation of scientific, mathematical, or logical facts that contradicts the core concept, the criterion must be false for that specific scoring unit, regardless of other surrounding text.
Tier 4: Diagram Amnesty: Evaluate text and labels over artistic quality. If a student draws a messy or poorly proportioned sketch, but the labels, arrows, and structural logic are scientifically correct, the criteria for the diagram are met (true).

*** FORMAT-SPECIFIC AUTOMATED PROCESSING ***
During the evaluation step, you MUST automatically adapt your extraction method based on the nature of the student's answer:
For Diagrams: Automatically detect labeled components and evaluate them purely on the presence and correctness of the labels and connections.
For Calculations: Automatically break down the student's work into four distinct phases: Formula/Equation -> Substitution -> Working/Steps -> Final Result, evaluating each phase independently.

THE "NO MATH" RULE (ABSOLUTE MANDATE): You are STRICTLY FORBIDDEN from calculating the final score or the 'marks_awarded' for any question. Your job is ONLY to extract 'answer_status' (Attempted/Skipped) and provide an array of objects explicitly stating each criterion evaluated and whether the student met it. NEVER output a 'score' field.

THE "NO GHOST EXTRACTION" RULE: Your JSON output MUST contain an evaluation object for EVERY SINGLE QUESTION defined in the marking scheme. If a student completely skipped a question, you MUST include it with "answer_status": "Skipped" and OMIT justification, criteria_evaluations, and constructive_feedback.

LOGICAL CONSISTENCY: The boolean values in your 'criteria_evaluations' MUST strictly align with your 'justification'. If your text says a student got something right, the corresponding criterion must be true.

*** THE "MICRO-LESSON" FEEDBACK PROTOCOL (CRITICAL) ***
Your "constructive_feedback" MUST be unforgettable, short, and directly actionable. Maximum 2 sentences. DO NOT use generic praise.
Use this exact formula: [Acknowledge what they got right] + [State the EXACT missing scientific fact from the rubric] + [Actionable micro-lesson].

*** CHAIN-OF-THOUGHT JSON SCHEMA (STRICT ENFORCEMENT) ***
You MUST generate the "justification" BEFORE the criteria extraction. The justification MUST be exactly 1 sentence. DO NOT use robotic step-by-step formats. Output ONLY valid JSON. No markdown formatting. Return the evaluation for this ONE student.

{
  "studentName": "Extracted Name or 'Unknown'",
  "registrationNumber": "Extracted ID or 'Unknown'",
  "questions": [
    {
      "questionId": "1a",
      "section": "Section name if applicable, else 'General'",
      "questionTitle": "Brief title",
      "answer_status": "Answered | Skipped",
      "justification": "The rubric requires X and the student correctly provided X but missed Y.",
      "criteria_evaluations": [
        { "criterion": "Identified correct formula", "met": true },
        { "criterion": "Calculated final answer", "met": false }
      ],
      "max_marks": 5,
      "constructive_feedback": "The strict Micro-Lesson feedback as defined above."
    }
  ]
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

// Helper: Deterministic Local Math Engine
function calculateDeterministicScores(extractedData, examInstructions, maxScoreParam = 100) {
    if (!extractedData || !extractedData.questions) return extractedData;

    extractedData.questions.forEach(q => {
        if (q.answer_status === "Skipped" || !q.criteria_evaluations || !Array.isArray(q.criteria_evaluations)) {
            q.marks_awarded = 0;
        } else {
            // Calculate proportional score based on evaluations array
            const trueCount = q.criteria_evaluations.filter(c => c && c.met === true).length;
            const totalCriteria = q.criteria_evaluations.length || 1;

            // Assume equal weighting for criteria unless specified otherwise
            // Fallback to 1 to prevent undefined/NaN crashes if AI omits it
            const maxMarksRaw = q.max_marks !== undefined ? q.max_marks : (q.max !== undefined ? q.max : (q.maxScore !== undefined ? q.maxScore : 1));
            const maxMarks = parseFloat(maxMarksRaw) || 1;

            q.max_marks = maxMarks; // Ensure it's defined on the object for the UI

            // Proportional Math: (trueCount / totalCriteria) * maxMarks
            let calculatedScore = (trueCount / totalCriteria) * maxMarks;

            // Hard Ceiling Enforcement and NaN prevention
            if (isNaN(calculatedScore)) calculatedScore = 0;
            q.marks_awarded = Math.min(Math.round(calculatedScore * 100) / 100, maxMarks);
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
                q.constructive_feedback = "(Dropped: " + q.constructive_feedback + ")";
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
async function gradeBatchExams(base64PDF, markingSchemeText, examInstructions = "", maxScoreParam = 100, maxRetries = 3) {
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            const apiKey = await getSecureKey();

            // Ensure backwards compatibility and dynamic context building
            let promptText = `Here is the marking scheme:\n${markingSchemeText}\n\n`;
            if (examInstructions && examInstructions.trim() !== '') {
                promptText += `CRITICAL EXAM INSTRUCTIONS (FOLLOW THESE OVER ANY ASSUMPTIONS):\n${examInstructions}\n\n`;
            }

            const userContent = [];

            // Detect if input is raw text string (Online Digital) or array of images (Offline Scanned)
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

            let parsedData;
            try {
                parsedData = JSON.parse(content);
            } catch (e) {
                console.warn("JSON parse failed, attempting automatic fallback repair for truncated JSON:", e.message);
                // Fallback mechanism to fix unterminated JSON chunks due to max token limits
                // It slices the string back to the last complete closing brace and appends the necessary closing tags.
                const lastBrace = content.lastIndexOf('}');
                if (lastBrace !== -1) {
                    content = content.substring(0, lastBrace + 1);
                    // Add closing brackets assuming the truncation happened within the "questions" array
                    content += ']}';
                    try {
                        parsedData = JSON.parse(content);
                        console.log("JSON fallback repair successful. Some questions may be truncated.");
                    } catch (e2) {
                        throw new Error(`JSON parsing completely failed even after repair: ${e2.message}`);
                    }
                } else {
                    throw e;
                }
            }

            // 2. Deterministic Math Engine (Local Post-Processing)
            // AI extracted booleans, now our code calculates the absolute math to ensure 100% accuracy.
            let finalData = parsedData;

            if (parsedData.students && Array.isArray(parsedData.students)) {
                finalData = parsedData.students[0]; // Take first if hallucinated array
            }

            finalData = calculateDeterministicScores(finalData, examInstructions, maxScoreParam);

            return [finalData];

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