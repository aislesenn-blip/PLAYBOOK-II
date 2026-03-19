import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `
You are the Chief Examiner for a World-Class International Examination Board. Your mandate is to evaluate handwritten student exams against a strict marking scheme with absolute fairness, deterministic logic, and zero hallucinations.

CRITICAL BATCH PROCESSING MANDATE:
The document contains consecutive exams from MULTIPLE students. You MUST evaluate EVERY student found.

THE "NO GHOST GRADING" RULE (ABSOLUTE MANDATE):
You are STRICTLY FORBIDDEN from skipping any question. Your JSON output MUST contain an evaluation object for EVERY SINGLE QUESTION defined in the marking scheme. If a student completely skipped a question, you MUST include it with "answer_status": "Skipped", "marks_awarded": 0, and "constructive_feedback": "You did not attempt this question."

*** THE 4 TIERS OF EVALUATION ***
1. SEMANTIC EQUIVALENCE: DO NOT penalize for poor English or missing exact keywords if the SCIENTIFIC MEANING is correct. Award full marks for correct concepts.
2. PROPORTIONAL MATH: For multi-point questions, mathematically reward what is present. (e.g., 2 valid reasons out of 5 required = 40% of marks).
3. THE FATAL FLAW: If the student's answer contains fundamentally incorrect concepts, the score MUST BE 0. No pity marks for wrong science. Be ruthless.
4. DIAGRAM AMNESTY: DO NOT penalize for missing sketches/diagrams, as OCR vision may miss them. Grade based strictly on the text.

*** THE "MICRO-LESSON" FEEDBACK PROTOCOL (CRITICAL) ***
Your "constructive_feedback" MUST be unforgettable, short, and directly actionable. Maximum 3 sentences.
- Rule 1: Speak directly to the student as an elite Professor (Use "You").
- Rule 2: NEVER use lazy phrases like "Study more" or "Expand on this."
- Rule 3: Use this exact formula: [Acknowledge what they got right, if anything] + [State the EXACT missing scientific fact from the rubric] + [Actionable micro-lesson to never miss it again].
- Perfect Example: "You correctly defined hydroponics, but you missed 'capillarity'. Next time, remember that a Wicking system relies specifically on capillarity action to pull water up to the roots."

*** CHAIN-OF-THOUGHT JSON SCHEMA (STRICT ENFORCEMENT) ***
You MUST generate the "justification" BEFORE the "marks_awarded" to prevent hallucinations. Output ONLY valid JSON. No markdown formatting.

{
  "students": [
    {
      "studentName": "Extracted Name or 'Unknown'",
      "registrationNumber": "Extracted ID or 'Unknown'",
      "maxScore": 100,
      "questions": [
        {
          "questionId": "1a",
          "questionTitle": "Brief title",
          "answer_status": "Answered | Skipped",
          "justification": "Step 1: Rubric requires X. Step 2: Student wrote Y. Step 3: Match is correct/incorrect.",
          "marks_awarded": 2,
          "max_marks": 5,
          "constructive_feedback": "The strict Micro-Lesson feedback as defined above."
        }
      ]
    }
  ]
}
`;

serve(async (req) => {
  // CORS Headers
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      }
    });
  }

  let session_id_from_req: string | null = null;

  try {
    const reqData = await req.json();
    session_id_from_req = reqData.session_id;

    if (!session_id_from_req) {
        throw new Error("Missing session_id");
    }

    const session_id = session_id_from_req;

    // Extract the JWT token from the Authorization header to identify the user securely
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error("Missing Authorization header");
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '' // Service role bypasses RLS
    );

    // Get the user from the JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);

    if (userError || !user) {
        throw new Error("Unauthorized");
    }

    // 1. Fetch the Session data and implicitly verify ownership
    const { data: session, error: sessionError } = await supabaseClient
      .from('sessions')
      .select('*, users(institution_id)')
      .eq('id', session_id)
      .single();

    if (session.professor_id !== user.id) {
        throw new Error("Unauthorized: You do not own this session.");
    }

    if (sessionError) throw sessionError;

    // 2. Fetch the Institution's API Key
    const institutionId = session.users.institution_id;
    const { data: secretData, error: secretError } = await supabaseClient
      .from('institution_secrets')
      .select('openrouter_api_key')
      .eq('institution_id', institutionId)
      .single();

    if (secretError || !secretData?.openrouter_api_key) {
        throw new Error("No OpenRouter API key configured for this institution.");
    }

    const apiKey = secretData.openrouter_api_key;

    // 3. Download the PDF from Storage
    const { data: fileData, error: fileError } = await supabaseClient
      .storage
      .from('exams_bucket')
      .download(session.pdf_storage_path);

    if (fileError) throw fileError;

    // 4. Safely convert large PDF Blob to base64
    const arrayBuffer = await fileData.arrayBuffer();
    const pdfBytes = new Uint8Array(arrayBuffer);

    let binary = '';
    const len = pdfBytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(pdfBytes[i]);
    }
    const base64PDF = btoa(binary);

    let sessionTotalScore = 0;
    let successfulStudentsCount = 0;

    // 5. Grade the ENTIRE batch PDF via Gemini 2.0 Flash natively
    const openRouterReq = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'google/gemini-2.0-flash-001', // Required model: Massive context window native PDF handling
            temperature: 0.0,
            seed: 42,
            max_tokens: 8192, // Explicitly required so the LLM doesn't truncate massive batch JSON arrays mid-sentence
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: [
                        { type: "text", text: `Here is the marking scheme:\n${session.marking_scheme}\n\nHere is the bulk exam document containing multiple students:` },
                        { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64PDF}` } }
                    ]
                }
            ],
            response_format: { type: "json_object" }
        })
    });

    if (!openRouterReq.ok) {
        const errorText = await openRouterReq.text();
        throw new Error(`OpenRouter API error: ${openRouterReq.status} ${errorText}`);
    }

    const aiResponse = await openRouterReq.json();
    let content = aiResponse.choices[0].message.content;

    if (content.startsWith('```json')) content = content.replace(/^```json\n|\n```$/g, '');
    else if (content.startsWith('```')) content = content.replace(/^```\n|\n```$/g, '');

    const parsedData = JSON.parse(content);

    if (!parsedData.students || !Array.isArray(parsedData.students)) {
        throw new Error("AI did not return a valid 'students' array.");
    }

    // Insert Graded Submissions for EACH student found in the batch
    for (let i = 0; i < parsedData.students.length; i++) {
        const student = parsedData.students[i];

        let student_total_score = 0;
        if (student.questions) {
            student.questions.forEach((q: any) => {
                const marks = parseFloat(q.marks_awarded);
                if (!isNaN(marks)) student_total_score += marks;
            });
        }

        const { error: insertError } = await supabaseClient
            .from('exam_submissions')
            .insert({
                session_id: session_id,
                student_name: student.studentName || `Unknown Student ${i+1}`,
                registration_number: student.registrationNumber || `ID-UNKNOWN-${i+1}`,
                pdf_storage_path: session.pdf_storage_path,
                total_score: student_total_score,
                max_score: student.maxScore || 100,
                grading_data: { questions: student.questions },
                status: 'needs_review',
                completed_at: new Date().toISOString()
            });

        if (insertError) {
            console.error(`Failed to insert student ${i}:`, insertError);
        } else {
            sessionTotalScore += student_total_score;
            successfulStudentsCount++;
        }
    }

    // 6. Mark Session as needs_review (Crucial for the Human-in-the-Loop workflow)
    const sessionAverage = successfulStudentsCount > 0 ? (sessionTotalScore / successfulStudentsCount) : 0;
    const { error: updateError } = await supabaseClient
      .from('sessions')
      .update({
        status: 'needs_review',
        total_students: successfulStudentsCount,
        average_score: sessionAverage
      })
      .eq('id', session_id);

    if (updateError) throw updateError;

    return new Response(JSON.stringify({ success: true, message: "Grading complete" }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (error) {
    console.error("Edge Function Error:", error);

    // Try to update session to failed if possible
    try {
        if (session_id_from_req) {
             const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
             await supabaseClient.from('sessions').update({ status: 'failed', error_log: error.message }).eq('id', session_id_from_req);
        }
    } catch (e) {
        console.error("Failed to update session to failed state", e);
    }

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});
