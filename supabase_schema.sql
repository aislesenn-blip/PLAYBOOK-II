-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. TABLE CREATION

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
    description TEXT,
    join_code TEXT UNIQUE,
    academic_year TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
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

CREATE TABLE public.sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE,
    professor_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    marking_scheme TEXT,
    exam_instructions TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'needs_review', 'completed', 'failed')),
    publish_status TEXT DEFAULT 'draft',
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
    text_content TEXT,
    total_score NUMERIC DEFAULT 0,
    max_score NUMERIC DEFAULT 100,
    grading_data JSONB,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'needs_review', 'completed', 'failed')),
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

-- 2. SECURITY DEFINER FUNCTIONS
-- (These safely bypass RLS to prevent Infinite Recursion)

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

-- 3. ROW LEVEL SECURITY (RLS) ENABLEMENT

ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grade_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appeals ENABLE ROW LEVEL SECURITY;

-- 4. RLS POLICIES

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
    institution_id = public.get_user_institution_id() AND public.get_user_role() = 'admin'
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
CREATE POLICY "Students view enrolled courses" ON public.courses FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.class_enrollments
        WHERE course_id = courses.id
        AND student_id IN (SELECT id FROM public.students WHERE auth_id = auth.uid())
    )
);

CREATE POLICY "Professors manage sessions" ON public.sessions FOR ALL USING (professor_id = auth.uid());
CREATE POLICY "Students view enrolled sessions" ON public.sessions FOR SELECT USING (course_id IN (SELECT course_id FROM public.class_enrollments WHERE student_id IN (SELECT id FROM public.students WHERE auth_id = auth.uid())));

-- STUDENTS & ENROLLMENTS: Student access.
CREATE POLICY "Students view own profile" ON public.students FOR SELECT USING (auth.uid() = auth_id);
CREATE POLICY "Students update own profile" ON public.students FOR UPDATE USING (auth.uid() = auth_id);

CREATE POLICY "Students view own enrollments" ON public.class_enrollments FOR SELECT USING (
    student_id IN (SELECT id FROM public.students WHERE auth_id = auth.uid())
);

-- EXAM SUBMISSIONS: Professors can only access submissions tied to their own sessions.
CREATE POLICY "Professors manage submissions" ON public.exam_submissions FOR ALL USING (
    session_id IN (SELECT id FROM public.sessions WHERE professor_id = auth.uid())
);
CREATE POLICY "Students view own submissions" ON public.exam_submissions FOR SELECT USING (
    registration_number IN (SELECT registration_number FROM public.students WHERE auth_id = auth.uid())
    AND session_id IN (SELECT id FROM public.sessions WHERE publish_status = 'published')
);

-- OVERRIDES
CREATE POLICY "Professors log overrides" ON public.grade_overrides FOR ALL USING (changed_by = auth.uid());

-- APPEALS
CREATE POLICY "Students manage own appeals" ON public.appeals FOR ALL USING (student_id IN (SELECT id FROM public.students WHERE auth_id = auth.uid()));
CREATE POLICY "Professors manage session appeals" ON public.appeals FOR ALL USING (
    submission_id IN (SELECT id FROM public.exam_submissions WHERE session_id IN (SELECT id FROM public.sessions WHERE professor_id = auth.uid()))
);

-- 5. STORAGE BUCKETS (FOR EXAM PDFS)

-- Insert the bucket into the storage.buckets table
INSERT INTO storage.buckets (id, name, public)
VALUES ('exams_bucket', 'exams_bucket', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('course_materials', 'course_materials', true)
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

-- Allow professors to upload course materials
CREATE POLICY "Professors can upload materials"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'course_materials');

-- Allow professors and enrolled students to read materials
-- Storage object 'owner' allows the uploader to read it.
-- We also allow all authenticated users to read it since it's shared materials.
-- (Strictly speaking, the DB table RLS protects the URL. If they have the URL and are authenticated, they can download.)
CREATE POLICY "Authenticated users can read course materials"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'course_materials');

-- 6. TRIGGERS & AUTO-PROVISIONING

-- Trigger to automatically create a student profile when a new user signs up via Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- We assume any standard signup from the student portal creates a student record
  -- ON CONFLICT DO NOTHING ensures idempotency if inserted manually
  INSERT INTO public.students (auth_id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (auth_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 7. RPC FUNCTIONS

-- Student Portal: Join a Class
CREATE OR REPLACE FUNCTION public.api_join_class(p_join_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_student_id UUID;
    v_course_id UUID;
BEGIN
    -- 1. Get the student ID from the auth.uid()
    SELECT id INTO v_student_id
    FROM public.students
    WHERE auth_id = auth.uid();

    IF v_student_id IS NULL THEN
        RAISE EXCEPTION 'Student profile not found.';
    END IF;

    -- 2. Find the course by join code
    SELECT id INTO v_course_id
    FROM public.courses
    WHERE join_code = p_join_code;

    IF v_course_id IS NULL THEN
        RAISE EXCEPTION 'Invalid join code.';
    END IF;

    -- 3. Insert into class_enrollments (ignoring duplicates via conflict)
    INSERT INTO public.class_enrollments (student_id, course_id)
    VALUES (v_student_id, v_course_id)
    ON CONFLICT (student_id, course_id) DO NOTHING;

    RETURN jsonb_build_object('success', true, 'message', 'Successfully joined class.');
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_submit_work(
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
    FROM public.students WHERE auth_id = auth.uid() LIMIT 1;
    IF v_student_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Student not found');
    END IF;

    INSERT INTO public.exam_submissions (
        session_id, student_name, registration_number, text_content, pdf_storage_path, status
    ) VALUES (
        p_session_id, v_student_name, v_reg_num, p_text_content, p_pdf_path, 'pending'
    ) RETURNING id INTO v_submission_id;

    RETURN jsonb_build_object('success', true, 'submission_id', v_submission_id);
END;
$$;
