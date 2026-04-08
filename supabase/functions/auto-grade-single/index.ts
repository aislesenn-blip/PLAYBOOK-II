import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

serve(async (req) => {
  try {
    // Check if the request is a POST request
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response('Unauthorized', { status: 401 })
    }

    const { submission_id } = await req.json()
    if (!submission_id) {
      return new Response(JSON.stringify({ error: 'Missing submission_id' }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      })
    }

    // Initialize Supabase client
    // We use the service role key to bypass RLS for background tasks,
    // ensuring we can access secrets and update submissions securely.
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Fetch the submission details
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
      return new Response(JSON.stringify({ error: 'Failed to fetch submission' }), { status: 500 })
    }

    // Acknowledge the webhook quickly and process asynchronously
    // In Deno Deploy / Supabase Edge Functions, we can just return a 200 response immediately
    // and let the asynchronous execution continue in the background using edge function lifecycle,
    // but the most reliable way without lifecycle issues is to do the processing here
    // since we want to be sure it completes. We will process synchronously for simplicity and robustness.

    await processGrading(supabase, submission)

    return new Response(JSON.stringify({ success: true, message: 'Processing started/completed' }), {
      headers: { "Content-Type": "application/json" },
      status: 200
    })

  } catch (error) {
    console.error('Webhook error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500
    })
  }
})

async function processGrading(supabase, submission) {
  try {
    // 1. Mark as processing
    await supabase
      .from('exam_submissions')
      .update({ status: 'processing' })
      .eq('id', submission.id)

    const institutionId = submission.sessions.courses.institution_id
    const instructions = submission.sessions.exam_instructions

    // 2. Fetch the OpenRouter API Key for the institution
    const { data: secrets, error: secretsError } = await supabase
      .from('institution_secrets')
      .select('openrouter_api_key')
      .eq('institution_id', institutionId)
      .single()

    if (secretsError || !secrets?.openrouter_api_key) {
        throw new Error('API key not found for institution')
    }

    const openRouterApiKey = secrets.openrouter_api_key

    // 3. Extract content
    let studentText = submission.text_content

    // If there is a PDF but no text, we would ideally extract it.
    // For single digital auto-pilot, the student portal sends `text_content` directly.

    // 4. Grade using Anthropic Claude-3.7-Sonnet via OpenRouter
    const aiScore = await gradeWithAI(studentText, instructions, openRouterApiKey)

    // 5. Update submission with results (Auto-pilot sets it directly to completed)
    await supabase
      .from('exam_submissions')
      .update({
        status: 'completed',
        total_score: aiScore.total_score,
        grading_data: aiScore.grading_data,
        completed_at: new Date().toISOString()
      })
      .eq('id', submission.id)

  } catch (err) {
    console.error("Auto-grade processing failed:", err)
    // Update status to failed
    await supabase
      .from('exam_submissions')
      .update({
        status: 'failed',
        error_log: err.message
      })
      .eq('id', submission.id)
  }
}

async function gradeWithAI(studentContent, markingScheme, apiKey) {
  // Simple prompt structure similar to what we do in JS, adapted for single pass single question
  // In a robust scenario, we would parse the scheme, but here we treat it as a single block for auto-pilot
  const systemPrompt = `You are an expert, deterministically strict academic grader.
You are given a marking scheme and a student's answer.
Your task is to grade the student's answer against the marking scheme.

MARKING SCHEME:
${markingScheme}

Analyze the student's response carefully. Check for correct concepts based on the scheme.

CRITICAL INSTRUCTIONS:
1. Output MUST be valid JSON only. No markdown formatting, no backticks.
2. The JSON must strictly match this structure:
{
  "justification": "Step-by-step reasoning...",
  "constructive_feedback": "Feedback for the student...",
  "total_correct_points_found": 5,
  "is_entirely_blank": false
}
`

  const userPrompt = `STUDENT ANSWER TO EVALUATE:\n\n${studentContent || '[NO ANSWER PROVIDED]'}`

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://playbook.edu",
      "X-Title": "Playbook Auto-Pilot"
    },
    body: JSON.stringify({
      model: "anthropic/claude-3.7-sonnet",
      temperature: 0.0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const rawContent = data.choices[0].message.content.trim();

  try {
      const parsed = JSON.parse(rawContent);
      return {
          total_score: parsed.total_correct_points_found || 0,
          grading_data: [
              {
                  questionId: 'Q1',
                  aiExtractedQuestion: 'Auto-Pilot Assessment',
                  studentAnswerTranscription: studentContent,
                  expectedItems: 100, // Safe default or parsed from scheme
                  maxMarks: 100,
                  correctPointsFound: parsed.total_correct_points_found || 0,
                  scoreAwaredByAI: parsed.total_correct_points_found || 0,
                  justification: parsed.justification || 'No justification provided.',
                  constructiveFeedback: parsed.constructive_feedback || '',
                  isEntirelyBlank: parsed.is_entirely_blank || false
              }
          ]
      }
  } catch (e) {
      throw new Error("Failed to parse AI output: " + e.message + " Raw: " + rawContent);
  }
}