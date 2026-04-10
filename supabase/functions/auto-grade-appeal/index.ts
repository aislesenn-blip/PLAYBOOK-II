import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

const APPEAL_SYSTEM_PROMPT = `You are a Senior Academic Examiner handling a Tier-1 student dispute.
Your objective is to deeply and rigorously re-evaluate a specific question against the marking scheme, considering the student's argument.

You will be provided with:
1. The Marking Scheme / Rubric.
2. The Question data (including the original AI feedback).
3. The Student's Answer.
4. The Student's Appeal Reason.

MANDATES:
- If the student makes a valid point and their answer aligns with the marking scheme, you MUST grant them the points and explain why.
- If the student is incorrect, you MUST firmly explain why their answer fails to meet the criteria, directly quoting the marking scheme if necessary.
- Output ONLY raw JSON. No conversational text. No markdown blocks.

JSON SCHEMA:
{
  "is_score_changed": boolean,
  "new_correct_points_found": integer (if changed, the new total correct points; if not changed, the original score),
  "ai_response_to_student": "A detailed, constructive explanation addressing the student directly. (e.g. 'I have reviewed your appeal. While you mentioned X, the rubric requires Y.')"
}`;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Custom JSON parser to prevent LLM hallucination crashes
function parseLLMJSON(content: string) {
    if (!content || !content.trim()) {
        return { is_score_changed: false, new_correct_points_found: 0, ai_response_to_student: "Empty response from AI." };
    }

    let cleaned = content.replace(/^```[^\n]*\n|\n```$/g, '').trim();
    if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
        const firstBrace = cleaned.indexOf('{');
        const firstBracket = cleaned.indexOf('[');
        const startIdx = (firstBrace !== -1 && firstBracket !== -1) ? Math.min(firstBrace, firstBracket) : Math.max(firstBrace, firstBracket);
        if (startIdx !== -1) {
            cleaned = cleaned.substring(startIdx);
        }
    }

    try {
        return JSON.parse(cleaned);
    } catch (e) {
        console.warn("Failed to parse AI JSON natively, attempting structural repair.");
        return { is_score_changed: false, new_correct_points_found: 0, ai_response_to_student: "Error parsing AI decision logic." };
    }
}

async function fetchOpenRouter(apiKey: string, systemPrompt: string, userContent: string, title: string) {
    let attempt = 0;
    while (attempt < 3) {
        try {
            const bodyPayload: any = {
                model: "anthropic/claude-3.7-sonnet",
                temperature: 0.0,
                seed: 42,
                top_p: 0.1,
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userContent }
                ]
            };

            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://playbook.edu",
                    "X-Title": title
                },
                body: JSON.stringify(bodyPayload)
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`OpenRouter API error (${response.status}): ${errText}`);
            }

            const data = await response.json();
            return data.choices[0].message.content.trim();

        } catch (error: any) {
            attempt++;
            console.warn(`Appeal OpenRouter attempt ${attempt} failed: ${error.message}`);
            await delay(2000 * attempt);
        }
    }
    throw new Error("Failed to contact LLM after 3 attempts.");
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { headers: corsHeaders, status: 405 })
    }

    const { appeal_id } = await req.json()
    if (!appeal_id) {
      return new Response(JSON.stringify({ error: 'Missing appeal_id' }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. Fetch Appeal and relations
    const { data: appeal, error: appealError } = await supabase
      .from('appeals')
      .select(`
        *,
        exam_submissions (
            id, text_content, grading_data, total_score,
            sessions ( exam_instructions, course_id, courses ( institution_id ) )
        )
      `)
      .eq('id', appeal_id)
      .single()

    if (appealError || !appeal) {
      return new Response(JSON.stringify({ error: 'Failed to fetch appeal' }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }

    const submission = appeal.exam_submissions;
    const institutionId = submission.sessions.courses.institution_id;
    const rawInstructions = submission.sessions.exam_instructions || '';

    // 2. Fetch API Key
    const { data: secrets, error: secretsError } = await supabase
      .from('institution_secrets')
      .select('openrouter_api_key')
      .eq('institution_id', institutionId)
      .single()

    if (secretsError || !secrets?.openrouter_api_key) {
        throw new Error('API key not found for institution')
    }

    const openRouterApiKey = secrets.openrouter_api_key;

    // 3. Reconstruct context
    // If the appeal is for 'entire_exam', we provide the full text. If specific question, we filter.
    // For V1, the frontend hardcodes 'entire_exam', so we send the whole thing for comprehensive review.

    let userPrompt = `Marking Scheme:\n---\n${rawInstructions}\n---\n\n`;
    userPrompt += `Student's Raw Submission:\n---\n${submission.text_content}\n---\n\n`;

    // Add current grading context so AI knows what it previously decided
    if (submission.grading_data) {
        userPrompt += `Current Grading Breakdown:\n---\n${JSON.stringify(submission.grading_data, null, 2)}\n---\n\n`;
    }

    userPrompt += `Student's Appeal Dispute Reason:\n---\n"${appeal.reason}"\n---\n\n`;
    userPrompt += `Based on the marking scheme, the student's submission, and their dispute reason, perform a deep re-evaluation. Are they correct? Determine if their total score should be adjusted. Output only JSON.`;

    // 4. Call AI
    const rawAIResponse = await fetchOpenRouter(openRouterApiKey, APPEAL_SYSTEM_PROMPT, userPrompt, "Playbook Deep-Dive Appeal",);
    const parsedDecision = parseLLMJSON(rawAIResponse);

    // 5. Apply Updates
    if (parsedDecision.is_score_changed) {

        // This is a simplistic total score update since 'entire_exam' is the current architecture.
        // A true per-question architecture would recalculate `calculateDeterministicScores`.
        // For now, we trust the AI's holistic integer output for the resolution.
        const newScore = parsedDecision.new_correct_points_found || submission.total_score;

        await supabase
            .from('exam_submissions')
            .update({ total_score: newScore })
            .eq('id', submission.id);

        // Record previous score
        await supabase
            .from('appeals')
            .update({ previous_score: submission.total_score })
            .eq('id', appeal.id);
    }

    // Mark as AI Resolved
    await supabase
        .from('appeals')
        .update({
            status: 'ai_resolved',
            ai_response: parsedDecision.ai_response_to_student
        })
        .eq('id', appeal.id);

    return new Response(JSON.stringify({ success: true, message: 'Tier-1 AI Appeal Resolution completed' }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    })

  } catch (error: any) {
    console.error('Appeal Webhook error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    })
  }
})
