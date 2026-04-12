-- SQL ya kuongeza gemini_api_key kwenye table ya institution_secrets
ALTER TABLE public.institution_secrets ADD COLUMN IF NOT EXISTS gemini_api_key text;
NOTIFY pgrst, 'reload schema';
