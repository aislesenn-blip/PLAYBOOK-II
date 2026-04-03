-- Run this in the Supabase SQL Editor to add the missing column for exam instructions
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS exam_instructions TEXT DEFAULT '';

-- Update the Supabase cache
NOTIFY pgrst, 'reload schema';
