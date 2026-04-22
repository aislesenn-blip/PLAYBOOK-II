import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { corsHeaders } from "../_shared/cors.ts"

// --- PROMPTS PORTED FROM js/ai.js ---

const PASS1_SYSTEM_PROMPT = `
You are the Master Mapper for an Examination Board. Your job is to scan the provided exam document, extract the student's identity, and identify EVERY question from the marking scheme that the student attempted.

*** MANDATE ***
You must analyze the student's exam against the provided marking scheme. You will return a lightweight JSON object mapping out the student's exam structure. DO NOT TRANSCRIBE THE ANSWERS YET. Just state if they attempted the question or skipped it.

*** INSTRUCTIONS ***
1. Identify the student's name and registration number.
2. For EVERY question listed in the marking scheme, check if the student attempted it anywhere in their document.
3. Set 'answer_status' to 'Answered' if they wrote anything for it, otherwise 'Skipped'.
4. Identify the maximum number of items the student is explicitly asked to provide (e.g., 'Name 5 sensors' = 5). Store this as 'expected_number_of_items'. Do NOT count the total number of possible valid options listed in the rubric. If the rubric lists 17 options but the question asks for 5 (or max marks is 5), the expected number is 5.
5. ONLY output valid JSON using the exact schema below. Output ONLY raw JSON. No conversational text. No markdown blocks. Start your response with {
6. Do not use <think> tags.

*** SCHEMA ***
{
  "studentName": "Extracted Name or 'Unknown'",
  "registrationNumber": "Extracted ID or 'Unknown'",
  "questions": [
    {
      "questionId": "1a",
      "questionTitle": "A short 3-5 word summary of the question topic",
      "section": "Section name if applicable, else 'General'",
      "max_marks": 5,
      "expected_number_of_items": 4,
      "answer_status": "Answered | Skipped"
    }
  ]
}
`;

const PASS1B_EXTRACTION_PROMPT = `
You are the Chief Transcriber for an Examination Board. You are tasked with locating and transcribing the student's answer for exactly ONE specific question.

*** ABSOLUTE LITERAL TRANSCRIPTION RULE ***
You MUST act as a literal transcriber. Find where the student answered the specific question requested, and quote their exact phrases, math, and steps exactly as written. DO NOT invent, assume, or inject terms from the marking scheme into the student's answer. If the student did not explicitly write it, you must not extract it. For diagrams, describe the diagram's labels and structural logic in text.

*** INSTRUCTIONS ***
1. Locate the student's answer for the specific Question ID provided by the user.
2. Transcribe their exact answer.
3. ONLY output valid JSON using the exact schema below. Output ONLY raw JSON. No conversational text. No markdown blocks. Start your response with {
4. Do not use <think> tags.

*** SCHEMA ***
{
  "student_answer_transcription": "The student wrote: '...'"
}
`;

const PASS2_SYSTEM_PROMPT = `
You are the Chief Evaluator for an Examination Board. You are tasked with grading exactly ONE question for ONE student.

*** THE 4 TIERS OF EVALUATION (GRADING CONSTRAINTS) ***
Tier 1: Strict Binary Logic: If the student's answer does not explicitly contain the exact concept or scientific fact defined in the rubric, give a 0. Do not give the benefit of the doubt. Do not guess.
Tier 2: Fact Extraction: Isolate specific, distinct correct statements the student made that directly match a scoring criterion in the rubric.
Tier 3: The Fatal Flaw Rule: Fundamental violations of scientific/logical facts mean zero marks for that specific concept.
Tier 4: Diagram Amnesty: Evaluate text descriptions of diagrams based on labels/structural logic over artistic quality.

*** HARDENED GRADING RULES ***
1. ANTI-FABRICATION RULE: NEVER fabricate or hallucinate student errors. If a student's calculation or step perfectly matches the rubric, you MUST award the full marks for that scoring unit. Do not invent missing steps to justify a lower score.
2. BLANK ANSWER HANDLING: If the student's answer is completely blank or missing, you MUST still output valid JSON containing the step-by-step thinking explaining that the answer is missing. Output an empty array for points_awarded. Do not attempt to evaluate and do not crash.
3. STRICT FATAL FLAW PENALTY: If a student's core definition or fundamental concept is explicitly wrong (e.g., defining an 'essential nutrient' when asked for a 'beneficial nutrient'), you MUST award 0 points for that entire conceptual block. Do not award partial credit for lucky guesses or examples if the foundational premise is incorrect.

*** STRICT SCORING GUARDRAIL ***
Do NOT perform final score arithmetic. Your ONLY job is to extract an array of specific, awarded points based on the rubric.
1. 'points_awarded': An array of floats. For EVERY distinct, correct rubric criterion the student successfully met, append the exact point value (mark) assigned to that criterion in the rubric.
Example: If the rubric awards 0.5 marks for "defined gravity" and 1.5 marks for "showed equation", and the student did both, output: [0.5, 1.5]. If they only defined gravity, output: [0.5].
Let the external system handle summing the array and clamping it to the max score.
If the student's answer is blank or completely wrong, output 'is_entirely_blank': true and 'points_awarded': [].
CRITICAL JSON RULE: You MUST use standard double quotes (") for all JSON keys and string boundaries. Use single quotes (') for quotes inside strings.
Do not use <think> tags.

*** THE "MICRO-LESSON" FEEDBACK PROTOCOL ***
Your "constructive_feedback" MUST be short and directly actionable. Use this exact formula: [Acknowledge what they got right] + [State the EXACT missing scientific fact from the rubric] + [Actionable micro-lesson].

*** SCHEMA ***
You MUST output ONLY valid JSON using the schema below. Output ONLY raw JSON. No conversational text. No markdown blocks. Start your response with {

{
  "justification": "The rubric requires X (worth 0.5 marks) and Y (worth 1.5 marks). The student provided X but missed Y...",
  "points_awarded": [0.5],
  "is_entirely_blank": false,
  "constructive_feedback": "You correctly identified X. However, you missed Y."
}
Output ONLY raw JSON. No conversational text. No markdown blocks. Start your response with {
`;

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


// --- HELPER FUNCTIONS PORTED FROM js/ai.js ---

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

function parseLLMJSON(content: string) {
    if (!content || content.trim() === '') {
        return { is_entirely_blank: true, justification: "No step-by-step thinking provided", marks_awarded: 0 };
    }

    // Preemptively strip <think> tags which cause JSON truncation
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, '');

    let startIndex = content.indexOf('{');
    if (startIndex !== -1) {
        let depth = 0;
        let inString = false;
        let escapeNext = false;
        let endIndex = -1;

        for (let i = startIndex; i < content.length; i++) {
            const char = content[i];
            if (escapeNext) { escapeNext = false; continue; }
            if (char === '\\') { escapeNext = true; continue; }
            if (char === '"') { inString = !inString; continue; }
            if (!inString) {
                if (char === '{') depth++;
                else if (char === '}') {
                    depth--;
                    if (depth === 0) { endIndex = i; break; }
                }
            }
        }
        if (endIndex !== -1) {
            content = content.substring(startIndex, endIndex + 1);
        } else {
            content = content.substring(startIndex);
        }
    }

    content = content.replace(/^```json\s*/gi, '').replace(/^```\s*/gi, '').replace(/```\s*$/gi, '');
    content = content.replace(/[\n\r\t]+/g, ' ');
    content = content.replace(/([{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3');
    content = content.replace(/(:\s*)'([^']+)'(\s*[,}])/g, '$1"$2"$3');
    content = content.replace(/,\s*([}\]])/g, '$1');
    content = content.replace(/\\(?!["\\/bfnrt])/g, '\\\\');

    try {
        return JSON.parse(content);
    } catch (e: any) {
        console.warn("JSON parse failed, attempting automatic fallback repair for truncated JSON:", e.message);
        let repairedContent = content;
        let stack = [];
        let inString = false;
        let escapeNext = false;

        for (let i = 0; i < repairedContent.length; i++) {
            const char = repairedContent[i];
            if (escapeNext) { escapeNext = false; continue; }
            if (char === '\\') { escapeNext = true; continue; }
            if (char === '"') { inString = !inString; continue; }
            if (!inString) {
                if (char === '{') stack.push('}');
                else if (char === '[') stack.push(']');
                else if (char === '}' || char === ']') stack.pop();
            }
        }

        let dropIndex = repairedContent.length;
        let insideStr = inString;

        for (let i = repairedContent.length - 1; i >= 0; i--) {
            const char = repairedContent[i];
            if (char === '"' && (i === 0 || repairedContent[i-1] !== '\\')) {
                insideStr = !insideStr;
                continue;
            }
            if (!insideStr) {
                if (char === ',') { dropIndex = i; break; }
                if (char === '{' || char === '[' || char === '}' || char === ']') { dropIndex = i + 1; break; }
            }
        }

        repairedContent = repairedContent.substring(0, dropIndex);
        repairedContent = repairedContent.replace(/(,\s*|:\s*|"\w*\s*)$/, '');

        if (inString) {
            repairedContent += '"';
        }

        while (stack.length > 0) {
            repairedContent += stack.pop();
        }

        try {
            return JSON.parse(repairedContent);
        } catch (e2: any) {
            console.error("Advanced JSON repair failed.", e2.message);
            throw new Error("JSON parse failed completely");
        }
    }
}

class Semaphore {
    maxConcurrent: number;
    currentConcurrent: number;
    queue: Array<() => void>;

    constructor(maxConcurrent: number) {
        this.maxConcurrent = maxConcurrent;
        this.currentConcurrent = 0;
        this.queue = [];
    }

    async acquire() {
        if (this.currentConcurrent < this.maxConcurrent) {
            this.currentConcurrent++;
            return Promise.resolve();
        }
        return new Promise<void>(resolve => {
            this.queue.push(resolve);
        });
    }

    release() {
        this.currentConcurrent--;
        if (this.queue.length > 0) {
            this.currentConcurrent++;
            const resolve = this.queue.shift()!;
            resolve();
        }
    }
}

function parseSectionRules(examInstructions: string) {
    const rules: Record<string, number> = {};
    if (!examInstructions || typeof examInstructions !== 'string') return rules;

    const format1 = /Section\s+([A-Z0-9]+)[\s:,-]+(?:answer|choose|pick|attempt|do)[\sA-Za-z]*(\d+)/gi;
    const format2 = /(?:answer|choose|pick|attempt|do)[\sA-Za-z]*(\d+)[\sA-Za-z]*(?:in|from|of)\s+Section\s+([A-Z0-9]+)/gi;
    const formatGlobal = /(?:answer|choose|pick|attempt|do)[\sA-Za-z]*(\d+)(?![\sA-Za-z]*(?:in|from|of)\s+Section)/gi;

    let match;
    while ((match = format1.exec(examInstructions)) !== null) {
        rules[match[1].toUpperCase()] = parseInt(match[2], 10);
    }
    while ((match = format2.exec(examInstructions)) !== null) {
        rules[match[2].toUpperCase()] = parseInt(match[1], 10);
    }
    while ((match = formatGlobal.exec(examInstructions)) !== null) {
        const limit = parseInt(match[1], 10);
        if (!rules["GENERAL"] || limit < rules["GENERAL"]) {
            rules["GENERAL"] = limit;
        }
    }
    return rules;
}

function calculateDeterministicScores(extractedData: any, examInstructions: string, maxScoreParam = 100) {
    if (!extractedData || !extractedData.questions) return extractedData;

    extractedData.questions.forEach((q: any) => {
        if (q.answer_status === "Skipped" || q.is_entirely_blank) {
            q.marks_awarded = 0;
            q.score = 0;
            q.marks_awarded_by_ai = 0;
        } else {
            const maxMarksRaw = q.max_marks !== undefined ? q.max_marks : (q.max !== undefined ? q.max : 0);
            const maxMarks = Math.max(parseFloat(maxMarksRaw) || 0, 0);
            q.max_marks = maxMarks;

            let aiCalculatedMarks = 0;

            if (Array.isArray(q.points_awarded)) {
                aiCalculatedMarks = q.points_awarded.reduce((sum: number, point: any) => {
                    const val = parseFloat(point);
                    return sum + (isNaN(val) ? 0 : val);
                }, 0);
            } else if (q.total_correct_points_found !== undefined) {
                let correctPointsFound = parseInt(q.total_correct_points_found, 10) || 0;
                const expectedItemsRaw = q.expected_number_of_items !== undefined ? q.expected_number_of_items : maxMarks;
                const expectedItems = Math.max(parseFloat(expectedItemsRaw) || maxMarks, 1);
                aiCalculatedMarks = (correctPointsFound / expectedItems) * maxMarks;
            }

            aiCalculatedMarks = isNaN(aiCalculatedMarks) ? 0 : aiCalculatedMarks;

            // Fix floating point math anomalies (e.g. 0.1 + 0.2 = 0.30000004)
            aiCalculatedMarks = Math.round(aiCalculatedMarks * 100) / 100;

            q.marks_awarded_by_ai = aiCalculatedMarks;
            let finalScore = Math.min(aiCalculatedMarks, maxMarks);
            q.score = finalScore;
            q.marks_awarded = finalScore;
        }
    });

    const sectionRules = parseSectionRules(examInstructions);
    const sections: Record<string, any[]> = {};

    extractedData.questions.forEach((q: any) => {
        let secName = "GENERAL";
        if (q.section) {
            const normalized = q.section.replace(/section/i, '').trim();
            const secMatch = normalized.match(/([A-Z0-9]+)/i);
            if (secMatch) secName = secMatch[1].toUpperCase();
        }
        if (!sections[secName]) sections[secName] = [];
        sections[secName].push(q);
    });

    let totalScore = 0;

    for (const [secName, qs] of Object.entries(sections)) {
        let attemptedQs = qs.filter((q: any) => q.answer_status !== "Skipped" && q.marks_awarded > 0);

        if (sectionRules[secName] && attemptedQs.length > sectionRules[secName]) {
            attemptedQs.sort((a, b) => b.marks_awarded - a.marks_awarded);
            const allowedAnswers = sectionRules[secName];
            const droppedQuestions = attemptedQs.slice(allowedAnswers);

            droppedQuestions.forEach(q => {
                q.marks_awarded = 0;
                q.score = 0;
                if (q.constructive_feedback) {
                    q.constructive_feedback = "(Dropped: " + q.constructive_feedback + ")";
                } else {
                    q.constructive_feedback = "(Dropped)";
                }
            });
        }
        totalScore += qs.reduce((sum, q) => sum + (q.marks_awarded || 0), 0);
    }

    extractedData.totalScore = totalScore;
    extractedData.maxScore = maxScoreParam;

    return extractedData;
}


// --- MAIN EDGE FUNCTION LOGIC ---

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 })
  }

  try {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { headers: corsHeaders, status: 405 })
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response('Unauthorized', { headers: corsHeaders, status: 401 })
    }

    const { submission_id } = await req.json()
    if (!submission_id) {
      return new Response(JSON.stringify({ error: 'Missing submission_id' }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }

    const supabaseUrl = Deno.env.get('URL') || Deno.env.get('SUPABASE_URL') || ''
    const supabaseServiceKey = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: submission, error: submissionError } = await supabase
      .from('exam_submissions')
      .select(`
        id,
        text_content,
        pdf_storage_path,
        session_id,
        sessions!inner (
          id,
          course_id,
          exam_instructions,
          optimized_marking_scheme,
          professor_id,
          courses!inner (
            institution_id
          )
        )
      `)
      .eq('id', submission_id)
      .single()

    if (submissionError || !submission) {
      console.error("Submission fetch error:", submissionError)
      return new Response(JSON.stringify({ error: 'Failed to fetch submission' }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }

    // Process synchronously for Autopilot robustness
    await processGrading(supabase, submission)

    return new Response(JSON.stringify({ success: true, message: 'Processing completed' }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    })

  } catch (error: any) {
    console.error('Webhook error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500
    })
  }
})

async function processGrading(supabase: any, submission: any) {
  try {
    await supabase
      .from('exam_submissions')
      .update({ status: 'processing' })
      .eq('id', submission.id)

    const institutionId = submission.sessions.courses.institution_id
    const rawInstructions = submission.sessions.exam_instructions || ''

    const { data: secrets, error: secretsError } = await supabase
      .from('institution_secrets')
      .select('gemini_api_key')
      .eq('institution_id', institutionId)
      .single()

    if (secretsError || !secrets?.gemini_api_key) {
        throw new Error('API key not found for institution')
    }

    const googleAIApiKey = secrets.gemini_api_key
    const sessionId = submission.sessions.id

    // Parse studentText to see if it's an array of base64 images or plain text
    let studentContent = submission.text_content;
    let isVisionMode = false;
    let imageParts: any[] = [];

    try {
        const parsedContent = JSON.parse(studentContent);
        if (Array.isArray(parsedContent)) {
            isVisionMode = true;
            // Format base64 images for Gemini inlineData
            parsedContent.forEach((imageUrl: string) => {
                const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
                if (matches) {
                    imageParts.push({
                        inlineData: {
                            mimeType: matches[1],
                            data: matches[2]
                        }
                    });
                }
            });
        }
    } catch(e) {
        // It's standard text
    }


    // DB Caching for Optimized Scheme
    let optimizedScheme = "";
    // Only attempt to parse if the column actually exists and has data
    if (submission.sessions.optimized_marking_scheme) {
        try {
             // In Supabase, JSONB can come back as a string or object.
             optimizedScheme = typeof submission.sessions.optimized_marking_scheme === 'string'
                ? JSON.parse(submission.sessions.optimized_marking_scheme)
                : submission.sessions.optimized_marking_scheme;
             console.log("✅ Using cached optimized marking scheme from DB");
        } catch(e) {
            console.warn("Failed to parse cached optimized scheme, will regenerate.");
        }
    }

    if (!optimizedScheme && rawInstructions && rawInstructions.length > 20) {
        console.log("⚙️ Generating new optimized marking scheme...");
        try {
            // Edge Function L9 Chunking Optimization (Parallel Fan-Out)
            const chunks = rawInstructions.split(/(?=\n*Question\s*\d)/i).filter((c: string) => c.trim().length > 0);
            if (chunks.length === 0) chunks.push(rawInstructions);

            const optimizeSemaphore = new Semaphore(20);
            const chunkPromises = chunks.map(async (chunkText: string, index: number) => {
                await optimizeSemaphore.acquire();
                try {
                    let res = await fetchGoogleAI(googleAIApiKey, OPTIMIZE_PROMPT, chunkText, `Optimizer Chunk ${index}`, false);
                    return { index, text: res.replace(/^```[^\n]*\n|\n```$/g, '') };
                } finally {
                    optimizeSemaphore.release();
                }
            });

            const results = await Promise.all(chunkPromises);
            results.sort((a, b) => a.index - b.index);
            optimizedScheme = results.map(r => r.text).join("\n\n");

            // Cache it back to the DB to save 15s on all future submissions
            const updatePayload: any = { optimized_marking_scheme: optimizedScheme };
            await supabase.from('sessions').update(updatePayload).eq('id', sessionId);
            console.log("💾 Optimized scheme cached to DB successfully.");

        } catch (e: any) {
            console.warn("Scheme optimization failed, falling back to raw scheme. Error:", e.message);
            optimizedScheme = rawInstructions;
        }
    } else if (!optimizedScheme) {
        optimizedScheme = rawInstructions;
    }


    // MAP REDUCE AI GRADING
    const gradingResult = await gradeBatchExamsCloud(
        isVisionMode ? imageParts : studentContent,
        rawInstructions,
        optimizedScheme,
        googleAIApiKey,
        isVisionMode
    )

    await supabase
      .from('exam_submissions')
      .update({
        status: 'completed',
        total_score: gradingResult.totalScore || 0,
        grading_data: gradingResult.questions || [],
        completed_at: new Date().toISOString()
      })
      .eq('id', submission.id)

  } catch (err: any) {
    console.error("Auto-grade processing failed:", err)
    await supabase
      .from('exam_submissions')
      .update({
        status: 'failed',
        error_log: err.message
      })
      .eq('id', submission.id)
  }
}

async function fetchGoogleAI(apiKey: string, systemPrompt: string, userContent: any, title: string, requireJSON: boolean) {
    let attempt = 0;
    while (true) {
        try {
            const bodyPayload: any = {
                systemInstruction: {
                    parts: [{ text: systemPrompt }]
                },
                contents: [{
                    role: "user",
                    parts: Array.isArray(userContent) ? userContent : [{ text: userContent }]
                }],
                generationConfig: {
                    temperature: 0.0,
                    maxOutputTokens: 8192
                }
            };

            if (requireJSON) {
                bodyPayload.generationConfig.responseMimeType = "application/json";
            }

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(bodyPayload)
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Google AI Studio API error (${response.status}): ${errText}`);
            }

            const data = await response.json();
            return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "{}";

        } catch (error: any) {
            attempt++;
            console.warn(`[Infinite Retry] fetchGoogleAI attempt ${attempt} failed for ${title}: ${error.message}`);

            let backoffTime = 2000; // Flat 2 second delay for Edge Serverless Paid Tier
            await delay(backoffTime);
        }
    }
}

async function gradeBatchExamsCloud(studentContent: any, rawInstructions: string, optimizedScheme: string, apiKey: string, isVisionMode: boolean) {

    let pass1SystemPrompt = `${PASS1_SYSTEM_PROMPT}\n\n[CONTEXTUAL CACHE DATA]\nMarking Scheme:\n${optimizedScheme}`;
    let pass1UserPrompt: any = "Analyze the exam structure.";

    if (isVisionMode) {
        pass1UserPrompt = [...studentContent, { text: "Analyze the exam structure." }];
    } else {
        pass1SystemPrompt += `\n\nStudent Exam Submission:\n---\n${studentContent || '[NO CONTENT]'}\n---`;
    }

    // 1. Pass 1: Segmentation (Map - Skeleton Only)
    let mapDataStr;
    try {
        mapDataStr = await fetchGoogleAI(apiKey, pass1SystemPrompt, pass1UserPrompt, "Playbook Autopilot Map", true);
    } catch(e: any) {
         throw new Error("Pass 1 Map failed: " + e.message);
    }

    let parsedMap = parseLLMJSON(mapDataStr);
    if (parsedMap.students && Array.isArray(parsedMap.students)) {
        parsedMap = parsedMap.students[0];
    }
    const questions = parsedMap.questions || [];

    // 2. Pass 1B & Pass 2: Parallel Extraction & Grading (Reduce)
    // Serverless Fan-Out: Increased to 50 for True Parallelism on Paid Tier Edge Function
    const semaphore = new Semaphore(50);
    const gradingPromises = questions.map(async (q: any) => {
        if (q.answer_status === "Skipped") {
            return {
                ...q,
                is_entirely_blank: true,
                marks_awarded_by_ai: 0,
                justification: "No answer provided",
                constructive_feedback: "No answer provided"
            };
        }

        await semaphore.acquire();
        try {
            // Phase 1B: Extract transcription explicitly for this question
            let extractSystemPrompt = PASS1B_EXTRACTION_PROMPT;
            let extractUserPrompt: any = `Locate and transcribe the exact answer for Question ID: ${q.questionId}`;

            if (isVisionMode) {
                extractUserPrompt = [...studentContent, { text: extractUserPrompt }];
            } else {
                extractSystemPrompt += `\n\n[CONTEXTUAL CACHE DATA]\nStudent Exam Submission:\n---\n${studentContent || '[NO CONTENT]'}\n---`;
            }

            const transcriptionJSON = await fetchGoogleAI(apiKey, extractSystemPrompt, extractUserPrompt, "Playbook Pass1B Transcription", true);
            const parsedTranscription = parseLLMJSON(transcriptionJSON);
            q.student_answer_transcription = parsedTranscription.student_answer_transcription || "No text extracted.";

            // Phase 2: Grade
            return await gradeSingleQuestionCloud(apiKey, q, optimizedScheme);
        } finally {
            semaphore.release();
        }
    });

    const gradedQuestions = await Promise.all(gradingPromises);
    parsedMap.questions = gradedQuestions;

    // 3. Dumb Aggregator Math
    const finalData = calculateDeterministicScores(parsedMap, rawInstructions, 100);
    return finalData;
}

async function gradeSingleQuestionCloud(apiKey: string, questionData: any, markingSchemeText: string) {
    let attempt = 0;

    // Context Caching: Move Marking Scheme to System Prompt
    const contextHeavyPass2Prompt = `${PASS2_SYSTEM_PROMPT}\n\n[CONTEXTUAL CACHE DATA]\nMarking Scheme:\n${markingSchemeText}`;

    while (true) {
        try {
            const promptText = `Evaluate the following student's answer for Question ${questionData.questionId}:\nMax Marks: ${questionData.max_marks}\nAnswer: ${questionData.student_answer_transcription}`;

            const rawContent = await fetchGoogleAI(apiKey, contextHeavyPass2Prompt, promptText, "Playbook Autopilot Reduce", true);
            const parsed = parseLLMJSON(rawContent);

            if (parsed.points_awarded === undefined && parsed.total_correct_points_found === undefined && parsed.is_entirely_blank === undefined) {
                throw new Error("Invalid LLM response format: missing points_awarded or is_entirely_blank");
            }

            return {
                ...questionData,
                points_awarded: Array.isArray(parsed.points_awarded) ? parsed.points_awarded : [],
                total_correct_points_found: parsed.total_correct_points_found !== undefined ? parseInt(parsed.total_correct_points_found, 10) : undefined,
                is_entirely_blank: parsed.is_entirely_blank || false,
                justification: parsed.justification || "No justification provided.",
                constructive_feedback: parsed.constructive_feedback || "Review rubric."
            };

        } catch (error: any) {
            attempt++;
            console.warn(`[Infinite Retry] gradeSingleQuestion attempt ${attempt} failed for Question ${questionData.questionId}: ${error.message}`);

            let backoffTime = 2000; // Flat 2 second delay for Edge Serverless
            await delay(backoffTime);
        }
    }
}
