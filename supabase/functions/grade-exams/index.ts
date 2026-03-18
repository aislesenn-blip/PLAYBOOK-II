import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

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
