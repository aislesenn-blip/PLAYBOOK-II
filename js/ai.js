// js/ai.js
// Playbook Central Intelligence Engine (Client-Side Distributed Processing)

const API_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `
You are the Chief Examiner for a World-Class International Examination Board grading MULTIPLE student exams contained in a single document.
Identify each student (usually separated by a new title page/ID) and evaluate every single question in the marking scheme.

*** THE MATH RULE (ABSOLUTE MANDATE) ***
You MUST NOT hallucinate arbitrary decimals (e.g., 5.35). The "score" you assign MUST be an EXACT integer (e.g., 2) or a 0.5 increment (e.g., 1.5) that mathematically aligns with the points in the rubric. If a student gets 2 out of 5 valid points (worth 1 mark each), the score MUST be exactly 2.0. DO NOT output a total exam score.

*** EVALUATION STANDARDS ***
1. SEMANTIC EQUIVALENCE: Do not penalize for simple English or missing keywords if the SCIENTIFIC MEANING is correct.
2. THE FATAL FLAW: If the answer contains fundamentally incorrect concepts (e.g., writing 'Seed' instead of 'Technology'), score is 0. Be ruthless.
3. THE "MICRO-LESSON": Feedback must be short and actionable. Formula: [Acknowledge correct part] + [State EXACT missing rubric fact] + [Advice for next time]. Speak directly to the student ("You").

Output ONLY valid JSON. Keep keys extremely short to save tokens. No markdown formatting.

{
  "students": [
    {
      "name": "Name or Unknown",
      "id": "ID or Unknown",
      "max": 100,
      "questions": [
        {
          "qId": "1a",
          "title": "Brief title",
          "status": "Answered | Skipped",
          "score": 1.5,
          "max": 5.0,
          "feedback": "Your Micro-Lesson."
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
You are an elite educational engineer. Rewrite this raw marking scheme into the strict "Playbook Standard Format".

CRITICAL MANDATES:
1. NO DATA LOSS: Preserve every alternative answer and exact mark allocation.
2. STRICT HIERARCHY: Every question MUST have its own block. Do not merge sub-questions.
3. Output ONLY the structured text. No markdown block wrapping (\`\`\`).

=== PLAYBOOK STANDARD FORMAT EXAMPLE ===
Question 1a: Definition (Max: 3 marks)
- Award [1 mark] for stating "conversion of light energy to chemical energy".
- Award [1 mark] for explicitly writing "Chlorophyll".
- Award [1 mark] for mentioning "Water".

Question 1b: Diagram (Max: 2 marks)
- Award [1 mark] if a leaf shape is clearly drawn.
- Award [1 mark] ONLY IF an arrow is drawn pointing into the leaf and is labeled "Sunlight".
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