import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const GOOGLE_AI_API_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

const OPTIMIZE_PROMPT = `
You are an elite educational engineer. Rewrite this raw marking scheme into the strict "Playbook Standard Format".

CRITICAL MANDATES:
1. NO DATA LOSS: Preserve every alternative answer and exact mark allocation.
2. STRICT HIERARCHY: Every single question/sub-question MUST have its own block. Do not merge sub-questions.
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 })
  }

  try {
    const { raw_scheme } = await req.json();

    if (!raw_scheme) {
      throw new Error("Missing raw_scheme");
    }

    // Extract the JWT token from the Authorization header to identify the user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error("Missing Authorization header");
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get the user from the JWT to find their institution
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);

    if (userError || !user) {
        throw new Error("Unauthorized");
    }

    // Fetch user's institution
    const { data: userData, error: profileError } = await supabaseClient
      .from('users')
      .select('institution_id')
      .eq('id', user.id)
      .single();

    if (profileError || !userData?.institution_id) {
        throw new Error("User institution not found.");
    }

    // Fetch the Institution's API Key securely
    const { data: secretData, error: secretError } = await supabaseClient
      .from('institution_secrets')
      .select('gemini_api_key')
      .eq('institution_id', userData.institution_id)
      .single();

    if (secretError || !secretData?.gemini_api_key) {
        throw new Error("No Google AI Studio API key configured for this institution.");
    }

    const apiKey = secretData.gemini_api_key;

    const googleAIReq = await fetch(GOOGLE_AI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gemini-2.0-pro-exp-02-05',
        temperature: 0.0,
        max_tokens: 8192,
        messages: [
          { role: 'system', content: OPTIMIZE_PROMPT },
          { role: 'user', content: raw_scheme }
        ]
      })
    });

    if (!googleAIReq.ok) {
        const errorText = await googleAIReq.text();
        throw new Error(`Google AI Studio API error: ${googleAIReq.status} ${errorText}`);
    }

    const aiResponse = await googleAIReq.json();
    let content = aiResponse.choices[0].message.content;

    if (content.startsWith('```')) {
        content = content.replace(/^```[^\n]*\n|\n```$/g, '');
    }

    return new Response(JSON.stringify({ formatted_scheme: content }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error("Format Scheme Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
