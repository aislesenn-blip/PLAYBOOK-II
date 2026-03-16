const API_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `
You are an extremely strict, highly experienced University Professor grading a student's exam.
You have been provided with a marking scheme and an image of the student's exam response.
Your tasks:
1. Extract the student's name from the document.
2. Grade the exam against the provided marking scheme. Award partial marks fairly where steps are correct. Give no free marks and absolutely no unfair deductions.
3. Provide detailed remarks and constructive feedback for each question.

You must return a JSON response strictly matching this format:
{
  "studentName": "Extracted Student Name",
  "totalScore": 85,
  "maxScore": 100,
  "questions": [
    {
      "questionNumber": 1,
      "questionTitle": "Title of the question from marking scheme",
      "score": 18,
      "maxScore": 20,
      "analysis": "Brief analysis of the student's answer.",
      "feedback": "Suggested constructive feedback for the student."
    }
  ]
}
Return ONLY valid JSON. Do not wrap in markdown code blocks like \`\`\`json.
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
                    questionNumber: 1,
                    questionTitle: "Error processing document",
                    score: 0,
                    maxScore: 100,
                    analysis: `An error occurred while contacting the AI: ${error.message}`,
                    feedback: "Please manually review this exam or try again later."
                 }
            ]
        };
    }
}

window.PlaybookAI = {
    analyzeExamWithAI
};