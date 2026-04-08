-- Add auto_grade_enabled to sessions
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS auto_grade_enabled BOOLEAN DEFAULT false;

-- Create extension for pg_net to call Edge Functions from Database Triggers
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Update the Supabase cache
NOTIFY pgrst, 'reload schema';
