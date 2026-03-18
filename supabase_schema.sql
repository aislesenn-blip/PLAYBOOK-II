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
    marking_scheme TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
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
    total_score NUMERIC DEFAULT 0,
    max_score NUMERIC DEFAULT 100,
    grading_data JSONB,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_log TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
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
CREATE POLICY "Admins manage secrets" ON public.institution_secrets FOR ALL USING (
    institution_id = public.get_user_institution_id() AND public.get_user_role() = 'admin'
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
