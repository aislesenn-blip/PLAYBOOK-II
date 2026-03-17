-- Playbook Enterprise Supabase Schema
-- This schema defines the full production backend for multi-tenant universities.

-- 1. INSTITUTIONS
-- Schools or universities that purchase the license.
-- They store the OpenRouter API key so individual teachers don't have to.
CREATE TABLE institutions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    domain TEXT UNIQUE NOT NULL, -- e.g., 'stanford.edu' for SSO
    openrouter_api_key TEXT, -- Encrypted at the application layer before saving
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. USERS (PROFESSORS & ADMINS)
-- Links to Supabase Auth (auth.users)
CREATE TABLE users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'professor' CHECK (role IN ('professor', 'admin')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. COURSES
-- A professor can have multiple courses (e.g., Biology 101, History 202)
CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    professor_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    academic_year TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. GRADING SESSIONS (EXAMS)
-- A batch of exams uploaded by a professor for a specific course
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    professor_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL, -- e.g., "Midterm 1"
    marking_scheme TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    total_students INT DEFAULT 0,
    average_score NUMERIC DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. STUDENT EXAM SUBMISSIONS (THE ASYNC QUEUE)
-- Individual student exams. This acts as the queue for Edge Functions.
CREATE TABLE exam_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    student_name TEXT,
    registration_number TEXT,
    pdf_storage_path TEXT NOT NULL, -- Path to the PDF in Supabase Storage
    total_score NUMERIC DEFAULT 0,
    max_score NUMERIC DEFAULT 100,
    grading_data JSONB, -- The final JSON output from the AI
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_log TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- 6. AUDIT LOG (HUMAN IN THE LOOP)
-- Tracks when a teacher overrides an AI grade. Crucial for enterprise trust and fine-tuning.
CREATE TABLE grade_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID REFERENCES exam_submissions(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    original_ai_score NUMERIC NOT NULL,
    new_teacher_score NUMERIC NOT NULL,
    justification TEXT,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    changed_by UUID REFERENCES users(id) ON DELETE CASCADE
);

-- ROW LEVEL SECURITY (RLS) POLICIES

ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE grade_overrides ENABLE ROW LEVEL SECURITY;

-- INSTITUTIONS: Admins can view/update their own institution
CREATE POLICY "Admins can manage their institution" ON institutions
    FOR ALL USING (id IN (SELECT institution_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- USERS: Users can read users in their own institution. Admins can manage them.
CREATE POLICY "Users can view colleagues" ON users
    FOR SELECT USING (institution_id IN (SELECT institution_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Admins can manage users" ON users
    FOR ALL USING (institution_id IN (SELECT institution_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- COURSES: Professors manage their own courses
CREATE POLICY "Professors manage own courses" ON courses
    FOR ALL USING (professor_id = auth.uid());

-- SESSIONS: Professors manage their own sessions
CREATE POLICY "Professors manage own sessions" ON sessions
    FOR ALL USING (professor_id = auth.uid());

-- EXAM SUBMISSIONS: Professors view/manage submissions for their sessions
CREATE POLICY "Professors manage own student submissions" ON exam_submissions
    FOR ALL USING (session_id IN (SELECT id FROM sessions WHERE professor_id = auth.uid()));

-- OVERRIDES: Tracked by the professor who made them
CREATE POLICY "Professors can log overrides" ON grade_overrides
    FOR ALL USING (changed_by = auth.uid());
