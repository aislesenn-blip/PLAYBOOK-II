-- Drop the old column if it exists and add the new one
ALTER TABLE public.institution_secrets
DROP COLUMN IF EXISTS openrouter_api_key;

ALTER TABLE public.institution_secrets
ADD COLUMN IF NOT EXISTS siliconflow_api_key TEXT;
