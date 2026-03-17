const API_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `
You are an extremely strict, highly experienced University Professor grading a student's exam to NECTA-level international examination board standards.
You have been provided with a marking scheme and an image of the student's exam response.

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

Your output must strictly be a JSON object adhering to the following schema. Return ONLY valid JSON without markdown wrapping. The "questions" array below is an EXAMPLE; you must return ALL questions. DO NOT output a totalScore key. Ensure EVERY question object has a populated "constructive_feedback" string.

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
`;

// Pass the API key explicitly to allow Web Worker usage
async function analyzeExamWithAI(imageDataUrls, markingSchemeText, apiKey) {
    try {
        const userContent = [
            {
                type: "text",
                text: `Here is the marking scheme:\n${markingSchemeText}\n\nHere are the pages of the student's exam in order:`
            }
        ];

        // Append all pages of the exam
        imageDataUrls.forEach(url => {
            userContent.push({
                type: "image_url",
                image_url: { url: url }
            });
        });

        if (!apiKey) {
            // Fallback for main thread testing if needed, though mostly passed by worker
            apiKey = typeof window !== 'undefined' ? localStorage.getItem('PLAYBOOK_API_KEY') : null;
            if (!apiKey) {
                throw new Error("No API key found. Please configure your API key.");
            }
        }

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'openai/gpt-4o',
                temperature: 0.0,
                top_p: 0.1,
                messages: [
                    {
                        role: 'system',
                        content: SYSTEM_PROMPT
                    },
                    {
                        role: 'user',
                        content: userContent
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

        // Ensure valid JSON by stripping markdown formatting if present
        if (content.startsWith('```json')) {
            content = content.replace(/^```json\n|\n```$/g, '');
        } else if (content.startsWith('```')) {
            content = content.replace(/^```\n|\n```$/g, '');
        }

        const parsedContent = JSON.parse(content);
        return parsedContent;

    } catch (error) {
        console.error("Error in Playbook grading:", error);

        // Fallback mock data in case API fails or hits rate limits
        return {
            studentName: "Unknown Student (API Error)",
            registrationNumber: "Unknown ID (API Error)",
            totalScore: 0,
            maxScore: 100,
            questions: [
                 {
                    questionId: "Error",
                    questionTitle: "Error processing document",
                    marks_awarded: 0,
                    max_marks: 100,
                    answer_status: "Skipped",
                    justification: `An error occurred while contacting the AI: ${error.message}`,
                    constructive_feedback: "Please manually review this exam or try again later."
                 }
            ]
        };
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
            const apiKey = typeof window !== 'undefined' ? localStorage.getItem('PLAYBOOK_API_KEY') : null;
            if (!apiKey) {
                throw new Error("No API key found. Please configure your API key.");
            }

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
            window.PlaybookAI = { analyzeExamWithAI, optimizeMarkingScheme };
} else {
            self.PlaybookAI = { analyzeExamWithAI, optimizeMarkingScheme };
}