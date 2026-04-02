-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 1. TABLE CREATION
-- ==========================================

CREATE TABLE public.institutions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    domain TEXT UNIQUE NOT NULL, -- For SSO routing
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Separate vault for the API key to prevent frontend exposure
CREATE TABLE public.institution_secrets (
    institution_id UUID PRIMARY KEY REFERENCES public.institutions(id) ON DELETE CASCADE,
    openrouter_api_key TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    institution_id UUID REFERENCES public.institutions(id) ON DELETE SET NULL,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'professor' CHECK (role IN ('professor', 'admin')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    professor_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    academic_year TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE,
    professor_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    join_code TEXT UNIQUE, -- 6-digit alphanumeric code for students to join/submit
    marking_scheme TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'needs_review', 'completed', 'failed')),
    publish_status TEXT DEFAULT 'draft' CHECK (publish_status IN ('draft', 'published')),
    total_students INT DEFAULT 0,
    average_score NUMERIC DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.exam_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
    student_name TEXT,
    registration_number TEXT,
    pdf_storage_path TEXT,
    text_content TEXT, -- For online typed assignments
    total_score NUMERIC DEFAULT 0,
    max_score NUMERIC DEFAULT 100,
    grading_data JSONB,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'needs_review', 'completed', 'failed')),
    error_log TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE public.students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- If using real auth later
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    registration_number TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.class_enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
    course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(student_id, course_id)
);

CREATE TABLE public.appeals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID REFERENCES public.exam_submissions(id) ON DELETE CASCADE,
    student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'rejected', 'approved')),
    teacher_response TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE public.grade_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID REFERENCES public.exam_submissions(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    original_ai_score NUMERIC NOT NULL,
    new_teacher_score NUMERIC NOT NULL,
    justification TEXT,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    changed_by UUID REFERENCES public.users(id) ON DELETE CASCADE
);

-- ==========================================
-- 2. SECURITY DEFINER FUNCTIONS
-- (These safely bypass RLS to prevent Infinite Recursion)
-- ==========================================

CREATE OR REPLACE FUNCTION public.get_user_institution_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER SET search_path = public
STABLE
AS $$
    SELECT institution_id FROM public.users WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER SET search_path = public
STABLE
AS $$
    SELECT role FROM public.users WHERE id = auth.uid();
$$;

-- Safely prevents regular users from registering as an Admin if one already exists
CREATE OR REPLACE FUNCTION public.admin_exists_for_institution(inst_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER SET search_path = public
STABLE
AS $$
    SELECT EXISTS(
        SELECT 1 FROM public.users WHERE institution_id = inst_id AND role = 'admin'
    );
$$;

-- ==========================================
-- 3. ROW LEVEL SECURITY (RLS) ENABLEMENT
-- ==========================================

ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grade_overrides ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- 4. RLS POLICIES
-- ==========================================

-- INSTITUTIONS: Anyone can read/insert to allow onboarding, but only Admins can update their own.
CREATE POLICY "Allow public insert on institutions" ON public.institutions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public select on institutions" ON public.institutions FOR SELECT USING (true);
CREATE POLICY "Admins update institution" ON public.institutions FOR UPDATE USING (id = public.get_user_institution_id() AND public.get_user_role() = 'admin');

-- SECRETS (VAULT): Strictly locked to Admins of that specific institution.
-- SECRETS (VAULT): Strictly locked to Admins of that specific institution for Updates.
-- SECRETS (VAULT): Strictly locked to Admins of that specific institution.
-- SECRETS (VAULT): Strictly locked to Admins of that specific institution for Updates.
-- Professors MUST be able to read the key to perform client-side grading.
CREATE POLICY "Admins manage secrets" ON public.institution_secrets FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid()
        AND institution_id = public.institution_secrets.institution_id
        AND role = 'admin'
    )
) WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid()
        AND institution_id = public.institution_secrets.institution_id
        AND role = 'admin'
    )
);

CREATE POLICY "Professors can read secrets for grading" ON public.institution_secrets FOR SELECT USING (
    institution_id = public.get_user_institution_id()
);

-- USERS: Registration logic and colleague visibility.
CREATE POLICY "Users insert own profile" ON public.users FOR INSERT WITH CHECK (
    auth.uid() = id AND
    (
        role = 'professor' OR
        (role = 'admin' AND NOT public.admin_exists_for_institution(institution_id))
    )
);
CREATE POLICY "Users view colleagues" ON public.users FOR SELECT USING (id = auth.uid() OR institution_id = public.get_user_institution_id());
CREATE POLICY "Admins update users" ON public.users FOR UPDATE USING (institution_id = public.get_user_institution_id() AND public.get_user_role() = 'admin');

-- COURSES & SESSIONS: Locked to the specific professor.
CREATE POLICY "Professors manage courses" ON public.courses FOR ALL USING (professor_id = auth.uid());
CREATE POLICY "Professors manage sessions" ON public.sessions FOR ALL USING (professor_id = auth.uid());

-- EXAM SUBMISSIONS: Professors can only access submissions tied to their own sessions.
CREATE POLICY "Professors manage submissions" ON public.exam_submissions FOR ALL USING (
    session_id IN (SELECT id FROM public.sessions WHERE professor_id = auth.uid())
);

-- OVERRIDES
CREATE POLICY "Professors log overrides" ON public.grade_overrides FOR ALL USING (changed_by = auth.uid());

-- NEW TABLES RLS (Students, Enrollments, Appeals)
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appeals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students manage own profile" ON public.students FOR ALL USING (auth.uid() = auth_id);
CREATE POLICY "Students see own enrollments" ON public.class_enrollments FOR SELECT USING (student_id IN (SELECT id FROM public.students WHERE auth_id = auth.uid()));
CREATE POLICY "Professors view enrollments" ON public.class_enrollments FOR SELECT USING (course_id IN (SELECT id FROM public.courses WHERE professor_id = auth.uid()));
CREATE POLICY "Students manage own appeals" ON public.appeals FOR ALL USING (student_id IN (SELECT id FROM public.students WHERE auth_id = auth.uid()));
CREATE POLICY "Professors manage session appeals" ON public.appeals FOR ALL USING (
    submission_id IN (SELECT id FROM public.exam_submissions WHERE session_id IN (SELECT id FROM public.sessions WHERE professor_id = auth.uid()))
);


-- ==========================================
-- 5. API RPC FUNCTIONS FOR HEADLESS STUDENT PORTAL
-- ==========================================

-- Function for a student to join a class via a Join Code
CREATE OR REPLACE FUNCTION public.api_join_class(p_student_auth_id UUID, p_join_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_course_id UUID;
    v_student_id UUID;
BEGIN
    -- Find the course by join code (assuming sessions have join codes linking them to courses, or joining a specific session)
    -- In this model, let's assume the join_code on the session grants access to that session.
    SELECT course_id INTO v_course_id FROM public.sessions WHERE join_code = p_join_code LIMIT 1;

    IF v_course_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid join code');
    END IF;

    SELECT id INTO v_student_id FROM public.students WHERE auth_id = p_student_auth_id LIMIT 1;

    IF v_student_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Student profile not found');
    END IF;

    INSERT INTO public.class_enrollments (student_id, course_id)
    VALUES (v_student_id, v_course_id)
    ON CONFLICT (student_id, course_id) DO NOTHING;

    RETURN jsonb_build_object('success', true, 'message', 'Joined successfully', 'course_id', v_course_id);
END;
$$;


-- Function for a student to submit work
CREATE OR REPLACE FUNCTION public.api_submit_work(
    p_student_auth_id UUID,
    p_session_id UUID,
    p_text_content TEXT,
    p_pdf_path TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_student_id UUID;
    v_student_name TEXT;
    v_reg_num TEXT;
    v_submission_id UUID;
BEGIN
    SELECT id, full_name, registration_number INTO v_student_id, v_student_name, v_reg_num
    FROM public.students WHERE auth_id = p_student_auth_id LIMIT 1;

    IF v_student_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Student not found');
    END IF;

    INSERT INTO public.exam_submissions (
        session_id,
        student_name,
        registration_number,
        text_content,
        pdf_storage_path,
        status
    ) VALUES (
        p_session_id,
        v_student_name,
        v_reg_num,
        p_text_content,
        p_pdf_path,
        'pending'
    ) RETURNING id INTO v_submission_id;

    RETURN jsonb_build_object('success', true, 'submission_id', v_submission_id);
END;
$$;


-- ==========================================
-- 6. STORAGE BUCKETS (FOR EXAM PDFS)
-- ==========================================

-- Insert the bucket into the storage.buckets table
INSERT INTO storage.buckets (id, name, public)
VALUES ('exams_bucket', 'exams_bucket', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS Policies
-- Allow authenticated users (professors) to upload exams
CREATE POLICY "Authenticated users can upload exams"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'exams_bucket');

-- Allow users to read files they uploaded
CREATE POLICY "Users can view their own exams"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'exams_bucket' AND auth.uid() = owner);
