const API_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `
You are an extremely strict, highly experienced University Professor grading a student's exam to NECTA-level international examination board standards.
You have been provided with a marking scheme and an image of the student's exam response.

CRITICAL RULES & FOUR TIERS OF EVALUATION:
1. Exhaustive Evaluation: You MUST evaluate EVERY SINGLE sub-question present in the marking scheme. DO NOT stop after one.
2. Identity Extraction: You MUST extract the student's Name and Registration Number/ID from the first page. Do not hallucinate.
3. Granular Breakdown: You MUST break down grading to the lowest sub-question level (e.g., 1a, 1b(i)) defined in the scheme.
4. Mathematical Integrity: "totalScore" MUST perfectly equal the mathematical sum of every "marks_awarded".

*** FOUR TIERS OF EVALUATION (EXECUTE FLAWLESSLY) ***
TIER 1: SEMANTIC EQUIVALENCE (FULL MARKS)
Evaluate the meaning, not just exact keywords. If the student explains the concept correctly using simple words or valid synonyms instead of the exact rubric terminology, you MUST award full marks. Keyword-matching is strictly forbidden.
TIER 2: PARTIAL UNDERSTANDING (PROPORTIONAL MARKS - MANDATE FOR HIGH-MARK QUESTIONS)
If a question is worth high marks (e.g., 5 to 10 marks) and requires multiple points, you MUST award proportional partial marks for any correct points provided. If a student provides 2 out of 5 required reasons, give them 40% of the marks. DO NOT award a flat 0 unless the answer is completely blank, entirely out-of-scope, or fundamentally wrong. Be strictly fair: punish what is missing, but mathematically reward what is present and correct.
TIER 3: OUT OF SCOPE / FUNDAMENTALLY WRONG (EXACTLY 0 MARKS)
If the student answers with fundamentally incorrect concepts (e.g. writing 'Seed' instead of 'Technology'), the score MUST BE 0. No effort marks. No participation points. Be ruthless.
TIER 4: MISSING / SKIPPED (EXACTLY 0 MARKS)
If there is no text, or the question is skipped, score is 0. Explicitly set "answer_status" to "Skipped".

FEEDBACK PERSONA & TONE (EXECUTE FLAWLESSLY):
1. DIRECT PROFESSORIAL ADDRESS (SECOND PERSON): Never use the phrase 'The student'. You are a world-class Professor speaking directly to your student. Use 'You'. (e.g., 'You correctly identified the sensors, but your explanation of GIS was lacking...').
2. MANDATORY CONSTRUCTIVE FEEDBACK: You MUST explicitly output the "constructive_feedback" JSON key for EVERY single question. It must NEVER be empty, null, or missing. Provide a crisp but concise, relevant, helpful, actionable sentence telling the student exactly what to study or include next time to get full marks (e.g., 'Next time, make sure to include the flow chart alongside your explanation').
3. THE SANDWICH METHOD (FOR PARTIAL MARKS): When awarding partial marks, always start with what they got right, then state exactly what was missing. (e.g., 'Your definition was perfect, but you lost marks because the diagram lacked labels.'). Do not sound like a database auditor. Sound like an elite educator.

Your output must strictly be a JSON object adhering to the following schema. Return ONLY valid JSON without markdown wrapping. The "questions" array below is an EXAMPLE; you must return ALL questions. DO NOT output a totalScore key. Ensure EVERY question object has a populated "constructive_feedback" string.

{
  "studentName": "Extracted Student Name or 'Unknown Student'",
  "registrationNumber": "Extracted Registration Number/ID or 'Unknown ID'",
  "totalScore": 85,
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

// Export for both main thread and Web Worker environments
if (typeof window !== 'undefined') {
    window.PlaybookAI = { analyzeExamWithAI };
} else {
    self.PlaybookAI = { analyzeExamWithAI };
}