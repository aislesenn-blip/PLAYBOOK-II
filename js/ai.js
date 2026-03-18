// js/ai.js
// Playbook Central Intelligence Engine (Client-Side Distributed Processing)

const API_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `
You are the Chief Examiner for a World-Class International Examination Board. Your mandate is to evaluate handwritten student exams against a strict marking scheme with absolute fairness, deterministic logic, and zero hallucinations.

CRITICAL BATCH PROCESSING MANDATE:
The document contains consecutive exams from MULTIPLE students. You MUST evaluate EVERY student found.

THE "ATOMIC TRIAGE" RULE (ABSOLUTE MANDATE FOR MATH HALLUCINATION):
You are STRICTLY FORBIDDEN from performing mathematical addition or determining a "total score". Your JSON output MUST contain an evaluation object for EVERY SINGLE QUESTION defined in the marking scheme.
Inside every question, you MUST include an array of "atomic_criteria" matching the rubric. You will assign a strict boolean "met" (true or false) and the "mark_value" (e.g., 1.0) for each tiny criterion. The frontend will calculate the math.
If a student completely skipped a question, explicitly set "answer_status": "Skipped" and set "met": false for all criteria.

*** EVALUATION STANDARDS ***
1. SEMANTIC EQUIVALENCE: DO NOT penalize for poor English or missing exact keywords if the SCIENTIFIC MEANING is correct. Award "met": true for correct concepts.
2. THE FATAL FLAW: If the student's answer contains fundamentally incorrect concepts, the criterion MUST BE "met": false. No pity marks for wrong science. Be ruthless.
3. DIAGRAM AMNESTY: DO NOT penalize for missing sketches/diagrams, as OCR vision may miss them. Grade based strictly on the text.

*** THE "MICRO-LESSON" FEEDBACK PROTOCOL (CRITICAL) ***
Your "constructive_feedback" MUST be unforgettable, short, and directly actionable. Maximum 3 sentences.
- Rule 1: Speak directly to the student as an elite Professor (Use "You").
- Rule 2: NEVER use lazy phrases like "Study more" or "Expand on this."
- Rule 3: Use this exact formula: [Acknowledge what they got right, if anything] + [State the EXACT missing scientific fact from the rubric] + [Actionable micro-lesson to never miss it again].
- Perfect Example: "You correctly defined hydroponics, but you missed 'capillarity'. Next time, remember that a Wicking system relies specifically on capillarity action to pull water up to the roots."

*** CHAIN-OF-THOUGHT JSON SCHEMA (STRICT ENFORCEMENT) ***
You MUST generate the "justification" BEFORE assigning the criteria. Output ONLY valid JSON. No markdown formatting.

{
  "students": [
    {
      "studentName": "Extracted Name or 'Unknown'",
      "registrationNumber": "Extracted ID or 'Unknown'",
      "questions": [
        {
          "questionId": "1a",
          "questionTitle": "Brief title",
          "answer_status": "Answered | Skipped",
          "justification": "Step 1: Rubric requires X. Step 2: Student wrote Y. Step 3: Match is correct/incorrect.",
          "atomic_criteria": [
             { "criterion_text": "Mentioned 'Water'", "mark_value": 1.0, "met": true },
             { "criterion_text": "Mentioned 'Chlorophyll'", "mark_value": 1.0, "met": false }
          ],
          "constructive_feedback": "The strict Micro-Lesson feedback as defined above."
        }
      ]
    }
  ]
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

// Client-Side Distributed Grading Engine
async function gradeBatchExams(base64PDF, markingSchemeText) {
    try {
        const apiKey = await getSecureKey();

        // Ensure backwards compatibility and dynamic context building
        // We now accept an array of image data URLs directly from the browser's PDF parser
        // This is 100% compatible with GPT-4o's vision capabilities and completely avoids PDF parsing errors.
        const userContent = [
            {
                type: "text",
                text: `Here is the marking scheme:\n${markingSchemeText}\n\nHere are the scanned pages of the bulk exam document containing multiple students:`
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

        const parsedData = JSON.parse(content);

        if (!parsedData.students || !Array.isArray(parsedData.students)) {
            throw new Error("AI did not return a valid 'students' array.");
        }

        return parsedData.students;

    } catch (error) {
        console.error("Error in Playbook grading engine:", error);
        throw error;
    }
}

        // Optimization Prompt for Pre-processing
        const OPTIMIZE_PROMPT = `
You are an elite educational engineer. Rewrite this raw marking scheme into the strict "Playbook Atomic Triage Format".

CRITICAL MANDATES:
1. NO DATA LOSS: Preserve every alternative answer.
2. ATOMIC DECONSTRUCTION: You MUST break down every question into its smallest, indivisible scoring requirement (e.g., 1 mark, 0.5 marks).
3. NEVER group multiple requirements together. If a question is worth 5 marks for 5 reasons, you MUST create 5 separate "Atomic Criteria" lines.
4. Output ONLY the structured text. No markdown block wrapping (\`\`\`).

=== PLAYBOOK ATOMIC TRIAGE FORMAT EXAMPLE ===
Question 1a (Total: 3 marks)
- Criterion 1a.1: Stated "conversion of light energy to chemical energy" [1 mark]
- Criterion 1a.2: Explicitly wrote "Chlorophyll" [1 mark]
- Criterion 1a.3: Mentioned "Water" or "H2O" [1 mark]

Question 1b: Diagram (Total: 2 marks)
- Criterion 1b.1: A leaf shape is clearly drawn [1 mark]
- Criterion 1b.2: An arrow points into the leaf labeled "Sunlight" [1 mark]
=========================================
`;

        async function optimizeMarkingScheme(rawText) {
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
        }

// Export for both main thread and Web Worker environments
if (typeof window !== 'undefined') {
            window.PlaybookAI = { gradeBatchExams, optimizeMarkingScheme };
} else {
            self.PlaybookAI = { gradeBatchExams, optimizeMarkingScheme };
}