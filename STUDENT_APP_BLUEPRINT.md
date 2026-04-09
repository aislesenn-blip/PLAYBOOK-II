# Playbook Student Portal - Architecture & Engineering Blueprint

This document serves as the master blueprint for a Level 8 AI Engineer agent to construct the **Playbook Student Portal** repository from scratch. The Student Portal acts as the "Headless Frontend" for the existing Playbook ecosystem.

## 1. Architectural Philosophy

The existing Playbook repository acts as the central "Brain". It houses:
- The Supabase PostgreSQL database (the single source of truth).
- All AI logic (Edge Functions & Task Queues).
- Security (Row Level Security & API Key Vaults).
- The Teacher-facing Administrative Dashboard.

The **Student Portal** (the new repository you are building) is purely a data-entry and presentation layer. It must be incredibly lightweight, fast, and feature a "Billion Dollar App" aesthetic.

**Core Rules:**
- **No SQL Definitions:** You will not create a new database. You will connect to the existing Supabase instance via its URL and Anon Key.
- **No Complex Logic:** Do not build grading logic. The Student Portal only submits data and retrieves data via RPC calls.
- **Mobile-First UX:** The primary user flow is on mobile devices. Use large typography (16px base, 24px+ headers), generous touch targets (56px min-height), pill-shaped buttons, rounded inputs (16px radius), and soft drop shadows instead of edge-bleeding borders.

---

## 2. API Integration Specifications (The Bridge)

The Student Portal communicates with the backend exclusively through secure Postgres RPC functions (Stored Procedures) that have already been created in the main repository.

### A. Joining a Class (`api_join_class`)
Allows a student to link their account to a professor's class using a 6-digit Join Code. Note: The Join Code is associated with the *Course* itself, not an individual assignment.

*   **Endpoint:** `supabase.rpc('api_join_class', { p_join_code })`
*   **Parameters:**
    *   `p_join_code` (TEXT): The 6-digit alphanumeric code provided by the teacher (tied to the `courses` table).
*   **Returns:** JSON Object `{ "success": boolean, "message": string, "course_id": UUID, "error": string }`

### B. Submitting an Assignment (`api_submit_work`)
Allows a student to submit a PDF or typed text for grading. The submission starts in a 'pending' state awaiting the teacher's batch AI grading process.

*   **Endpoint:** `supabase.rpc('api_submit_work', { p_session_id, p_text_content, p_pdf_path })`
*   **Parameters:**
    *   `p_session_id` (UUID): The specific assignment/session ID they are submitting to.
    *   `p_text_content` (TEXT): The content of the submission if it is a typed online assignment (can be null).
    *   `p_pdf_path` (TEXT): The path within the `exams_bucket` Storage where the uploaded PDF resides (can be null).
*   **Returns:** JSON Object `{ "success": boolean, "submission_id": UUID, "error": string }`

### C. Fetching Grades & Appeals
You will use standard Supabase client methods to query the database, relying on RLS to keep data secure.

*   **View Published Grades:**
    *   Query the `exam_submissions` table where `registration_number` matches the user's registration number and `status = 'completed'`, and join with the `sessions` table to ensure `publish_status = 'published'`. The database RLS policies enforce that you can only read your own submissions from published sessions.
*   **Submitting an Appeal:**
    *   Perform an `INSERT` into the `appeals` table containing the `submission_id`, `student_id`, `question_id`, and a text `reason`.

---

## 3. Required Pages & Flow

1.  **Auth (Login/Register):**
    *   Standard Supabase Auth flow. Registers a user into `auth.users` and maps them to the `public.students` table.
2.  **Dashboard (Home):**
    *   Displays a list of enrolled classes.
    *   Contains a prominent "Join Class" button that opens a modal requesting the 6-digit Join Code.
    *   Shows a feed of "Pending Assignments" and "Recently Graded" tasks.
3.  **Assignment Detail / Submission Page:**
    *   Shows instructions or the marking scheme rubric (if permitted by the teacher).
    *   Provides two options: Upload PDF or an inline Text Editor.
    *   Once submitted, displays a massive, satisfying green checkmark: "Submission Secured. Awaiting Professor's Review."
4.  **Grade Review Page:**
    *   Once a grade is published, displays the AI evaluation beautifully.
    *   Shows the score per question, AI feedback, and constructive notes.
    *   Includes a small "Dispute/Appeal" button next to each question block.

## 4. Execution Directives for the Agent
1.  Initialize a standard front-end stack (e.g., Vite + React/Vanilla JS + TailwindCSS).
2.  Install the `@supabase/supabase-js` client.
3.  Implement the UI strictly adhering to the "Billion Dollar App" mobile-first aesthetics.
4.  Connect the UI to the backend using the RPC functions defined in Section 2.
5.  Ensure all states (Loading, Error, Success) are clearly communicated to the user without exposing raw backend errors.

---

## Appendix A: SQL Setup Script

The following SQL has been added to the main Playbook repository to support the Headless Student App. If you need to recreate or verify the backend state, use this script:

```sql
CREATE TABLE public.students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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

-- Note: The `courses` table now includes `join_code TEXT UNIQUE`
-- The `sessions` table now includes `publish_status TEXT DEFAULT 'draft'`
-- The `exam_submissions` table now includes `text_content TEXT`

CREATE OR REPLACE FUNCTION public.api_join_class(p_join_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_course_id UUID;
    v_student_id UUID;
BEGIN
    SELECT id INTO v_course_id FROM public.courses WHERE join_code = p_join_code LIMIT 1;
    IF v_course_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid join code');
    END IF;
    SELECT id INTO v_student_id FROM public.students WHERE auth_id = auth.uid() LIMIT 1;
    IF v_student_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Student profile not found');
    END IF;

    INSERT INTO public.class_enrollments (student_id, course_id)
    VALUES (v_student_id, v_course_id)
    ON CONFLICT (student_id, course_id) DO NOTHING;

    RETURN jsonb_build_object('success', true, 'message', 'Joined successfully', 'course_id', v_course_id);
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
```