import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const GOOGLE_AI_API_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 })
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
      .select('gemini_api_key')
      .eq('institution_id', institutionId)
      .single();

    if (secretError || !secretData?.gemini_api_key) {
        throw new Error("No Google AI Studio API key configured for this institution.");
    }

    const apiKey = secretData.gemini_api_key;

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
    const googleAIReq = await fetch(GOOGLE_AI_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'gemini-2.5-flash', // Required model: Massive context window native PDF handling
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

    if (!googleAIReq.ok) {
        const errorText = await googleAIReq.text();
        throw new Error(`Google AI Studio API error: ${googleAIReq.status} ${errorText}`);
    }

    const aiResponse = await googleAIReq.json();
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
        const student_max_score = student.max !== undefined ? student.max : (student.maxScore || 100);

        if (student.questions) {
            student.questions.forEach((q: any) => {
                let marks = parseFloat(q.score !== undefined ? q.score : q.marks_awarded);
                if (!isNaN(marks)) {
                    const qMax = parseFloat(q.max !== undefined ? q.max : (q.max_score !== undefined ? q.max_score : q.max_marks));
                    if (!isNaN(qMax) && qMax > 0 && marks > qMax) {
                        marks = qMax;
                        q.score = marks;
                    }
                    student_total_score += marks;
                }
            });
        }

        if (student_total_score > student_max_score) {
            student_total_score = student_max_score;
        }

        const { error: insertError } = await supabaseClient
            .from('exam_submissions')
            .insert({
                session_id: session_id,
                student_name: student.name !== undefined ? student.name : student.studentName || `Unknown Student ${i+1}`,
                registration_number: student.id !== undefined ? student.id : student.registrationNumber || `ID-UNKNOWN-${i+1}`,
                pdf_storage_path: session.pdf_storage_path,
                total_score: student_total_score,
                max_score: student_max_score,
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
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
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
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
