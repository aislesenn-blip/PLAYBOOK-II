import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { TextractClient, DetectDocumentTextCommand } from "https://esm.sh/@aws-sdk/client-textract@3.370.0";
import { getDocument } from "https://esm.sh/pdfjs-dist@3.11.174/legacy/build/pdf.js";

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";

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
      .select('aws_access_key, aws_secret_key, aws_region, deepseek_api_key')
      .eq('institution_id', institutionId)
      .single();

    if (secretError || !secretData?.aws_access_key || !secretData?.aws_secret_key || !secretData?.aws_region || !secretData?.deepseek_api_key) {
        throw new Error("Missing AWS Textract credentials or DeepSeek API key in the secure vault.");
    }

    const deepseekKey = secretData.deepseek_api_key;
    const awsAccessKey = secretData.aws_access_key;
    const awsSecretKey = secretData.aws_secret_key;
    const awsRegion = secretData.aws_region;

    // 3. Download the PDF from Storage
    const { data: fileData, error: fileError } = await supabaseClient
      .storage
      .from('exams_bucket')
      .download(session.pdf_storage_path);

    if (fileError) throw fileError;

    // 4. Load the PDF using pdf.js to extract text natively, bypassing Textract limits for multi-page PDFs
    // AWS Textract sync APIs only accept single-page PDFs. Rather than complex Deno canvas/image conversion
    // (which lacks native canvas support), we can use pdf.js to extract the raw text directly if the exams are digital.
    // If they are scanned images, AWS Textract Async APIs (S3 requirement) or returning an error is required on the backend.
    // Given the constraints of the edge environment without a canvas API, we will extract pure text via pdf.js.
    const arrayBuffer = await fileData.arrayBuffer();
    const pdfBytes = new Uint8Array(arrayBuffer);

    const pdf = await getDocument({ data: pdfBytes, useSystemFonts: true }).promise;
    let extractedText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(" ");
        extractedText += pageText + "\n\n---PAGE_BREAK---\n\n";
    }

    if (!extractedText.trim()) {
         throw new Error("Could not extract text from this PDF. If this is a purely scanned handwritten document, the backend Edge Function requires digital text extraction. Please use the Teacher Dashboard (Frontend) to grade handwritten exams via OCR.");
    }

    let sessionTotalScore = 0;
    let successfulStudentsCount = 0;

    // 6. Grading via DeepSeek
    const gradingPrompt = `Here is the marking scheme:\n${session.marking_scheme}\n\nHere is the extracted text from the bulk exam document containing multiple students:\n${extractedText}`;

    // deepseek-reasoner does not support temperature=0.0 or response_format: json_object
    const deepseekReq = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${deepseekKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'deepseek-reasoner',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: gradingPrompt }
            ]
        })
    });

    if (!deepseekReq.ok) {
        const errorText = await deepseekReq.text();
        throw new Error(`DeepSeek API error: ${deepseekReq.status} ${errorText}`);
    }

    const aiResponse = await deepseekReq.json();
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
                const marks = parseFloat(q.score !== undefined ? q.score : q.marks_awarded);
                if (!isNaN(marks)) student_total_score += marks;
            });
        }

        const { error: insertError } = await supabaseClient
            .from('exam_submissions')
            .insert({
                session_id: session_id,
                student_name: student.name !== undefined ? student.name : student.studentName || `Unknown Student ${i+1}`,
                registration_number: student.id !== undefined ? student.id : student.registrationNumber || `ID-UNKNOWN-${i+1}`,
                pdf_storage_path: session.pdf_storage_path,
                total_score: student_total_score,
                max_score: student.max !== undefined ? student.max : student.maxScore || 100,
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
