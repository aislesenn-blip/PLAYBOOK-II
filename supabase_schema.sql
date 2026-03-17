-- Playbook Enterprise Supabase Schema
-- This schema defines the full production backend for multi-tenant universities.
-- IT FIXES PREVIOUS INFINITE RECURSION ISSUES AND ADDS INSERT POLICIES

-- Ensure uuid-ossp extension is enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. INSTITUTIONS
CREATE TABLE institutions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    domain TEXT UNIQUE NOT NULL, -- e.g., 'stanford.edu' for SSO
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 1.5 SECURE VAULT FOR API KEYS
CREATE TABLE institution_secrets (
    institution_id UUID PRIMARY KEY REFERENCES institutions(id) ON DELETE CASCADE,
    openrouter_api_key TEXT, -- Should be encrypted at app layer or using Supabase Vault extension
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. USERS (PROFESSORS & ADMINS)
CREATE TABLE users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'professor' CHECK (role IN ('professor', 'admin')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. COURSES
CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    professor_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    academic_year TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. GRADING SESSIONS (EXAMS)
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    professor_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    marking_scheme TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    total_students INT DEFAULT 0,
    average_score NUMERIC DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. STUDENT EXAM SUBMISSIONS (THE ASYNC QUEUE)
CREATE TABLE exam_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    student_name TEXT,
    registration_number TEXT,
    pdf_storage_path TEXT NOT NULL,
    total_score NUMERIC DEFAULT 0,
    max_score NUMERIC DEFAULT 100,
    grading_data JSONB,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_log TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- 6. AUDIT LOG (HUMAN IN THE LOOP)
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

-- SECURITY DEFINER FUNCTIONS TO PREVENT RECURSION
-- This function runs as the database owner, bypassing RLS to check the user's institution.
CREATE OR REPLACE FUNCTION get_user_institution_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT institution_id FROM users WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT role FROM users WHERE id = auth.uid();
$$;

-- Securely checks if an admin already exists for an institution without triggering RLS.
-- This prevents the privilege escalation attack during registration where a user might
-- circumvent subquery RLS checks.
CREATE OR REPLACE FUNCTION admin_exists_for_institution(inst_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS(
      SELECT 1 FROM users WHERE institution_id = inst_id AND role = 'admin'
  );
$$;

-- ROW LEVEL SECURITY (RLS) POLICIES

ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE grade_overrides ENABLE ROW LEVEL SECURITY;

-- SECURE VAULT POLICIES
-- Only admins of the institution can read/update the secret
CREATE POLICY "Admins manage their institution secrets" ON institution_secrets
    FOR ALL USING (institution_id = get_user_institution_id() AND get_user_role() = 'admin');

-- INSTITUTIONS POLICIES
-- Allow anonymous inserts for the admin registration flow
CREATE POLICY "Allow public insert on institutions for registration" ON institutions
    FOR INSERT WITH CHECK (true);

-- Allow reading institutions for registration flow to check domain
CREATE POLICY "Allow public select on institutions for registration" ON institutions
    FOR SELECT USING (true);

-- Admins can update their own institution
CREATE POLICY "Admins can update their institution" ON institutions
    FOR UPDATE USING (id = get_user_institution_id() AND get_user_role() = 'admin');

-- USERS POLICIES
-- Allow inserting a user record during signup (the auth.uid() must match the inserted id)
-- Also ensure they can only insert themselves as a 'professor' to prevent privilege escalation.
-- The very first admin is created by a separate secure database function or trigger in production.
-- For this MVP/registration flow, we use a SECURITY DEFINER function to securely check if an admin
-- already exists, preventing RLS circumvention in subqueries.
CREATE POLICY "Allow users to insert their own profile" ON users
    FOR INSERT WITH CHECK (
        auth.uid() = id AND
        (
            role = 'professor' OR
            (role = 'admin' AND NOT admin_exists_for_institution(institution_id))
        )
    );

-- Users can read their own profile and colleagues
CREATE POLICY "Users can view colleagues" ON users
    FOR SELECT USING (
        id = auth.uid() OR
        institution_id = get_user_institution_id()
    );

-- Admins can update users in their institution
CREATE POLICY "Admins can update users" ON users
    FOR UPDATE USING (
        institution_id = get_user_institution_id() AND
        get_user_role() = 'admin'
    );

-- COURSES POLICIES
CREATE POLICY "Professors manage own courses" ON courses
    FOR ALL USING (professor_id = auth.uid());

-- SESSIONS POLICIES
CREATE POLICY "Professors manage own sessions" ON sessions
    FOR ALL USING (professor_id = auth.uid());

-- EXAM SUBMISSIONS POLICIES
CREATE POLICY "Professors manage own student submissions" ON exam_submissions
    FOR ALL USING (
        session_id IN (SELECT id FROM sessions WHERE professor_id = auth.uid())
    );

-- OVERRIDES POLICIES
CREATE POLICY "Professors can log overrides" ON grade_overrides
    FOR ALL USING (changed_by = auth.uid());
