// js/ai.js
// Playbook Central Intelligence Engine (Client-Side Distributed Processing)

const API_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `
You are the Autonomous Chain of Thought (CoT) Grading Engine for a World-Class International Examination Board. Your mandate is to execute deterministic, unbiased evaluations of a single student's handwritten exam based on strict architectural principles.

CRITICAL EVALUATION MANDATE: The images provided represent exactly ONE student's exam. You MUST evaluate this single student for EVERY SINGLE QUESTION defined in the scheme. If skipped, use "answer_status": "Skipped".

*** CLEAN ARCHITECTURE (THE INPUTS) ***
You operate exclusively on:
1. The Question
2. Total Marks Available
3. Teacher's Marking Basis (Rubric/Model Answer)
4. The Student's Answer

*** THE 3-STEP AUTONOMOUS ENGINE ***
For EVERY question, you must execute this Chain of Thought inside the 'justification' field:
Step 1 - Analyze Marking Basis: Detect underlying "concept clusters".
Step 2 - Derive Scoring Units: Internally divide the expected answer into distinct, lock-tight scoring units. Lock this structure as the absolute source of truth.
Step 3 - Deterministic Semantic Grading: Compare the student's answer against these locked units.

*** FORMAT-SPECIFIC AUTOMATED PROCESSING ***
- For DIAGRAMS: Automatically detect labeled components. Evaluate purely on the presence and correctness of the labels, shapes, and connections.
- For CALCULATIONS: Automatically break down the student's work into 4 phases: Formula/Equation -> Substitution -> Working/Steps -> Final Result. Evaluate each phase independently.

*** THE 4 TIERS OF EVALUATION (CoT CONSTRAINTS) ***
Tier 1 - Semantic Equivalence: Evaluate meaning, not exact keywords. If the student explains the concept correctly using different vocabulary, they get the mark.
Tier 2 - Proportional Math: Award partial credit via 'criteria_evaluations'. If a student hits 3 of 4 scoring units, they get 3 'true' evaluations.
Tier 3 - The Fatal Flaw Rule: If the answer contains a fundamental violation of scientific/math/logical facts that contradicts the core concept, you MUST mark that specific unit FALSE, regardless of surrounding text.
Tier 4 - Diagram Amnesty: Grade text/labels over artistic quality. Do not penalize messy or poorly proportioned sketches if the labels and logic are correct.

*** ACTIONABLE RELEVANT FEEDBACK PROTOCOL ***
Your 'constructive_feedback' MUST be deeply relevant, precise, and actionable. Maximum 3 sentences.
Formula: [Acknowledge specific correct element] + [State EXACTLY why the 'Fatal Flaw' or missed unit was incorrect based on the marking basis] + [Actionable corrective micro-lesson].

THE "NO MATH" RULE: You NEVER calculate the final numerical 'marks_awarded'. You ONLY output the 'criteria_evaluations' array. The external engine does the math.

*** STRICT JSON SCHEMA ***
You MUST generate the CoT "justification" BEFORE the criteria extraction. Output ONLY valid JSON. No markdown formatting.

{
  "studentName": "Extracted Name or 'Unknown'",
  "registrationNumber": "Extracted ID or 'Unknown'",
  "questions": [
    {
      "questionId": "1a",
      "section": "Section name if applicable, else 'General'",
      "questionTitle": "Brief title",
      "answer_status": "Answered | Skipped",
      "justification": "Step 1: Concept clusters are X. Step 2: Scoring units derived are A, B, C. Step 3: Student answer aligns with A and B, but failed C due to Fatal Flaw Y.",
      "criteria_evaluations": [
        { "criterion": "Formula (Unit A)", "met": true },
        { "criterion": "Substitution (Unit B)", "met": true },
        { "criterion": "Final Result (Unit C)", "met": false }
      ],
      "max_marks": 5,
      "constructive_feedback": "You correctly identified the formula and substituted the values. However, your final result was incorrect because you forgot to square the radius (Fatal Flaw). Always double-check your exponents in geometry calculations."
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

    // Match formats like "Answer only 2 questions in this exam" or "attempt 2 questions"
    const format3 = /(?:answer|choose|pick|attempt|do)[\sA-Za-z]*(\d+)[\sA-Za-z]*(?:in|from|of)?\s*(?:this|the)?\s*(?:exam|paper|test|questions?)?/gi;

    let match;
    while ((match = format1.exec(examInstructions)) !== null) {
        rules[match[1].toUpperCase()] = parseInt(match[2], 10);
    }

    while ((match = format2.exec(examInstructions)) !== null) {
        rules[match[2].toUpperCase()] = parseInt(match[1], 10);
    }

    // Only apply format 3 if no section specific rules were found to avoid overriding
    if (Object.keys(rules).length === 0) {
        while ((match = format3.exec(examInstructions)) !== null) {
            rules["GENERAL"] = parseInt(match[1], 10);
        }
    }

    return rules;
}

// Helper: Deterministic Local Math Engine
function calculateDeterministicScores(extractedData, examInstructions, maxScoreParam = 100) {
    if (!extractedData || !extractedData.questions) return extractedData;

    extractedData.questions.forEach(q => {
        // Fallback for older formats or if the AI still hallucinates criteria_met
        const criteriaList = q.criteria_evaluations || q.criteria_met;

        if (q.answer_status === "Skipped" || !criteriaList || !Array.isArray(criteriaList)) {
            q.marks_awarded = 0;
        } else {
            let trueCount = 0;
            let totalCriteria = criteriaList.length || 1;

            if (q.criteria_evaluations) {
                 trueCount = criteriaList.filter(c => c && c.met === true).length;
            } else {
                 trueCount = criteriaList.filter(Boolean).length;
            }

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
            // We now accept an array of image data URLs directly from the browser's PDF parser
            // This is 100% compatible with GPT-4o's vision capabilities and completely avoids PDF parsing errors.
            let promptText = `Here is the marking scheme:\n${markingSchemeText}\n\n`;
            if (examInstructions && examInstructions.trim() !== '') {
                promptText += `CRITICAL EXAM INSTRUCTIONS (FOLLOW THESE OVER ANY ASSUMPTIONS):\n${examInstructions}\n\n`;
            }
            promptText += `Here are the scanned pages of this single student's exam:`;

            const userContent = [
                {
                    type: "text",
                    text: promptText
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