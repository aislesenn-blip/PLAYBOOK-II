-- Run this in the Supabase SQL Editor to add the LMS features

-- 1. Add session type and due dates to sessions (so they can be assignments)
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS session_type TEXT DEFAULT 'physical' CHECK (session_type IN ('physical', 'digital')),
ADD COLUMN IF NOT EXISTS due_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS description TEXT;

-- 2. Add course materials table for sharing notes
CREATE TABLE IF NOT EXISTS public.course_materials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    file_url TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on materials
ALTER TABLE public.course_materials ENABLE ROW LEVEL SECURITY;

-- Policies for course materials
CREATE POLICY "Professors manage materials" ON public.course_materials FOR ALL USING (
    course_id IN (SELECT id FROM public.courses WHERE professor_id = auth.uid())
);
CREATE POLICY "Students view enrolled materials" ON public.course_materials FOR SELECT USING (
    course_id IN (SELECT course_id FROM public.class_enrollments WHERE student_id IN (SELECT id FROM public.students WHERE auth_id = auth.uid()))
);

-- Update the Supabase cache
NOTIFY pgrst, 'reload schema';
