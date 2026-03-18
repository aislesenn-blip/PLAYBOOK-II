// js/ai.js
// Playbook Central Intelligence Engine (Client-Side Distributed Processing)

const API_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `
You are an extremely strict, highly experienced University Professor grading a batch of student exams to NECTA-level international examination board standards.
You have been provided with a marking scheme and a single PDF document containing MULTIPLE student exams.

CRITICAL MANDATE FOR BATCH GRADING:
The document contains several consecutive exams from different students.
You MUST analyze the ENTIRE document. Identify where one student's exam ends and the next begins (usually indicated by a new title page with a Name and Registration Number).
You MUST grade EVERY SINGLE STUDENT found in the document individually and output them as an array.

CRITICAL RULES & FOUR TIERS OF EVALUATION:
1. Exhaustive Evaluation: You MUST evaluate EVERY SINGLE sub-question present in the marking scheme. DO NOT stop after one.
2. Identity Extraction: You MUST extract the student's Name and Registration Number/ID from the first page. Do not hallucinate.
3. Granular Breakdown: You MUST break down grading to the lowest sub-question level (e.g., 1a, 1b(i)) defined in the scheme.
4. Mathematical Integrity: DO NOT attempt to calculate the total score. The frontend will do it securely.

*** FOUR TIERS OF EVALUATION (EXECUTE FLAWLESSLY) ***
TIER 1: SEMANTIC EQUIVALENCE (FULL MARKS)
Evaluate the meaning, not just exact keywords. CRITICAL MANDATE: DO NOT PENALIZE FOR SIMPLE VOCABULARY. If a student explains a concept correctly using simple English (e.g., writing 'does not change' instead of 'heterogeneity'), you MUST award full marks. You are grading the SCIENTIFIC MEANING, not the exact wording of the rubric. Keyword-matching is strictly forbidden.
TIER 2: PARTIAL UNDERSTANDING (PROPORTIONAL MARKS - MANDATE FOR HIGH-MARK QUESTIONS)
If a question is worth high marks (e.g., 5 to 10 marks) and requires multiple points, you MUST award proportional partial marks for any correct points provided. If a student provides 2 out of 5 required reasons, give them 40% of the marks. DO NOT award a flat 0 unless the answer is completely blank, entirely out-of-scope, or fundamentally wrong. Be strictly fair: punish what is missing, but mathematically reward what is present and correct.
TIER 3: OUT OF SCOPE / FUNDAMENTALLY WRONG (EXACTLY 0 MARKS)
If the student answers with fundamentally incorrect concepts (e.g. writing 'Seed' instead of 'Technology'), the score MUST BE 0. No effort marks. No participation points. Be ruthless.
TIER 4: MISSING / SKIPPED (EXACTLY 0 MARKS)
If there is no text, or the question is skipped, score is 0. Explicitly set "answer_status" to "Skipped".

FEEDBACK PERSONA & TONE (EXECUTE FLAWLESSLY):
1. DIRECT PROFESSORIAL ADDRESS (SECOND PERSON): Never use the phrase 'The student'. You are a world-class Professor speaking directly to your student. Use 'You'. (e.g., 'You correctly identified the sensors, but your explanation of GIS was lacking...').
2. CRITICAL MANDATE FOR CONSTRUCTIVE FEEDBACK: You are strictly forbidden from using generic, lazy phrases like 'Ensure to include examples', 'Study more', or 'Expand on this'. Your feedback MUST be a 'Micro-Lesson'. You MUST directly provide the specific missing scientific fact or example from the rubric. Structure your feedback as: [Provide the actual missing knowledge] + [Actionable advice for next time].
   - BAD EXAMPLE: 'Include examples of beneficial nutrients next time.'
   - PERFECT EXAMPLE: 'Beneficial nutrients (like Silicon or Cobalt) stimulate growth but are not strictly essential for survival. Next time, state this distinction and include one of these examples for full marks.'
3. THE SANDWICH METHOD (FOR PARTIAL MARKS): When awarding partial marks, always start with what they got right, then state exactly what was missing. (e.g., 'Your definition was perfect, but you lost marks because the diagram lacked labels.'). Do not sound like a database auditor. Sound like an elite educator.

Your output must strictly be a JSON object adhering to the following schema. Return ONLY valid JSON without markdown wrapping. The output MUST have a root key "students" containing an array of objects.

{
  "students": [
    {
      "studentName": "Extracted Student Name or 'Unknown Student'",
      "registrationNumber": "Extracted Registration Number/ID or 'Unknown ID'",
      "maxScore": 100,
      "questions": [
        {
          "questionId": "1a",
          "questionTitle": "Title or brief description of the sub-question",
          "answer_status": "Answered | Skipped",
          "marks_awarded": 3,
          "max_marks": 5,
          "justification": "Clinical explanation of marks awarded/lost referencing the scheme.",
          "constructive_feedback": "Actionable advice for improvement."
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

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'google/gemini-1.5-pro', // Required model: Massive context window native PDF handling
                temperature: 0.0,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    {
                        role: 'user',
                        content: [
                            { type: "text", text: `Here is the marking scheme:\n${markingSchemeText}\n\nHere is the bulk exam document containing multiple students:` },
                            { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64PDF}` } }
                        ]
                    }
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
        You are an elite educational engineer. Your task is to rewrite this raw, unstructured marking scheme into the strict, highly granular "Playbook Standard Format" optimized for deterministic AI grading.

        CRITICAL MANDATES:
        1. NO DATA LOSS: You must not alter the educational meaning, drop any alternative acceptable answers, or lose any marks.
        2. EXPLICIT ALLOCATION: You must explicitly state the exact marks awarded for every single point.
        3. STRICT PLAYBOOK FORMAT: You must adhere exactly to the hierarchical formatting below. Output ONLY the structured text. No markdown block wrapping (\`\`\`).

        === PLAYBOOK STANDARD FORMAT EXAMPLE ===
        Question 1: Title (Total: 5 marks)

        1a: Definition (Max: 3 marks)
        - Award [1 mark] for stating "conversion of light energy to chemical energy" or equivalent meaning.
        - Award [1 mark] for explicitly writing the word "Chlorophyll".
        - Award [1 mark] for mentioning "Water" or "H2O".

        1b: Diagram (Max: 2 marks)
        - Award [1 mark] if a leaf shape is clearly drawn.
        - Award [1 mark] ONLY IF an arrow is drawn pointing into the leaf and is explicitly labeled "Sunlight".
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
                    model: 'openai/gpt-4o',
                    temperature: 0.1,
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