const API_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `
You are an extremely strict, highly experienced University Professor grading a student's exam to NECTA-level international examination board standards.
You have been provided with a marking scheme and an image of the student's exam response.

CRITICAL RULES:
1. Deterministic Grading: You must evaluate the answers logically and mechanically. Do not guess. Do not give free marks. Do not deduct unfairly.
2. Granular Breakdown: You MUST break down the grading to the lowest possible sub-question level (e.g., 1a, 1b(i), 1b(ii), etc.) as defined in the marking scheme. Do not group or generalize feedback for multi-part questions.
3. Strict Justification: For every sub-question, you must provide a strict, clinical explanation of exactly why the specific mark was given and why it did not get full marks (explicitly referencing the marking scheme).
4. Constructive Feedback: Provide actionable advice for the student to improve.

Your output must strictly be a JSON object adhering to the following schema. Return ONLY valid JSON without markdown wrapping.

{
  "studentName": "Extracted Student Name or 'Unknown Student'",
  "totalScore": 85,
  "maxScore": 100,
  "questions": [
    {
      "questionId": "1a",
      "questionTitle": "Title or brief description of the sub-question",
      "marks_awarded": 3,
      "max_marks": 5,
      "justification": "Clinical explanation of marks awarded/lost referencing the scheme.",
      "constructive_feedback": "Actionable advice for improvement."
    }
  ]
}
`;

async function analyzeExamWithAI(imageDataUrls, markingSchemeText) {
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

        const apiKey = localStorage.getItem('PLAYBOOK_API_KEY');

        if (!apiKey) {
            throw new Error("No API key found. Please configure your API key in the Dashboard.");
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
        console.error("Error in AI grading:", error);

        // Fallback mock data in case API fails or hits rate limits
        return {
            studentName: "Unknown Student (API Error)",
            totalScore: 0,
            maxScore: 100,
            questions: [
                 {
                    questionId: "Error",
                    questionTitle: "Error processing document",
                    marks_awarded: 0,
                    max_marks: 100,
                    justification: `An error occurred while contacting the AI: ${error.message}`,
                    constructive_feedback: "Please manually review this exam or try again later."
                 }
            ]
        };
    }
}

window.PlaybookAI = {
    analyzeExamWithAI
};