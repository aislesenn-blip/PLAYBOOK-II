# Playbook Student Portal & Platform Architecture

This document provides a comprehensive overview of the end-to-end logic for registration, joining classes, assignment upload, grading, and release of grades on the Playbook platform.

---

## 1. Registration (Educators vs. Students)

### Educator Registration (Teacher Dashboard)
- Teachers and Administrators register via the `register.html` page, powered by `js/register.js`.
- The architecture uses a multi-tenant model. An Admin registers an Institution first, then Professors register under that domain.
- **Supabase Workflow:**
  1. Creates an Auth user (`supabaseClient.auth.signUp`).
  2. For Admins: Creates an institution record in the `public.institutions` table.
  3. For both: Creates a profile record in the `public.users` table with the respective role (`admin` or `professor`).

### Student Registration (Student Portal)
- Students do not need a heavy account setup. The Student Portal uses a lightweight approach.
- **Supabase Workflow:**
  1. Standard Supabase Auth flow creates a user in `auth.users`.
  2. An automatic database trigger `handle_new_user()` intercepts the signup.
  3. The trigger inserts a corresponding student record into `public.students` table (mapping `auth_id`, `email`, and `full_name`).

**Database Trigger Code:**
```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
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
```

---

## 2. Joining Classes

Students join a class from the Student Portal using a 6-digit alphanumeric Join Code provided by the Professor.

- The Join Code maps directly to a specific Course in the `public.courses` table.
- A student enters the code in the UI, which calls a Postgres RPC function securely over the Supabase client.

**RPC Call (`api_join_class`):**
```sql
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
    SELECT id INTO v_student_id FROM public.students WHERE auth_id = auth.uid();
    IF v_student_id IS NULL THEN
        RAISE EXCEPTION 'Student profile not found.';
    END IF;

    -- 2. Find the course by join code
    SELECT id INTO v_course_id FROM public.courses WHERE join_code = p_join_code;
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
```

---

## 3. Uploading Assignments

Students submit digital assignments (typed text or uploaded PDF) to a specific assignment "Session".

- Uploaded PDFs are stored in the secure Supabase storage bucket `exams_bucket`.
- The backend maps the submission to the `public.exam_submissions` table via a secure RPC call.
- The `exam_submissions` row initially gets a `status` of `'pending'`.

**RPC Call (`api_submit_work`):**
```sql
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

    -- Inserts submission and defaults status to 'pending'
    INSERT INTO public.exam_submissions (
        session_id, student_name, registration_number, text_content, pdf_storage_path, status
    ) VALUES (
        p_session_id, v_student_name, v_reg_num, p_text_content, p_pdf_path, 'pending'
    ) RETURNING id INTO v_submission_id;

    RETURN jsonb_build_object('success', true, 'submission_id', v_submission_id);
END;
$$;
```

---

## 4. Grading

Grading is purely controlled by the Professor via a "Teacher-Controlled Batching" workflow. It is NOT automatically triggered.

### AI Engine (Client-Side Distributed Processing in `js/ai.js`)
The application utilizes a robust two-pass Map-Reduce grading logic using the OpenRouter API (Gemini). The API key is securely retrieved from the vault (`public.institution_secrets`) and processed from the Professor's browser.

**Pass 1: Segmentation (Map Phase)**
The AI extracts the student's name/ID and transcribes each answer against the marking scheme, identifying `answer_status` (Answered or Skipped) and `expected_number_of_items`.

**Pass 2: Single-Question Evaluation**
For each transcribed answer, a strictly constrained prompt evaluates the semantic correctness based on the rubric.
- It returns an integer `total_correct_points_found`.
- It performs NO proportional math (handled by JavaScript) to avoid hallucinated calculations.
- Concurrency limits (e.g., `Semaphore(3)`) protect against API Rate Limits.

**Pass 3: Deterministic Aggregation (Reduce Phase)**
JavaScript takes the AI output and computes the final score securely:
```javascript
// From calculateDeterministicScores() in js/ai.js
let aiCalculatedMarks = (correctPointsFound / expectedItems) * maxMarks;
let finalScore = Math.min(aiCalculatedMarks, maxMarks);
q.score = finalScore;
q.marks_awarded = Math.round(finalScore * 100) / 100;
```

**Database Save:**
The finalized JSON grading structure is saved to the `grading_data` column in `public.exam_submissions`, and the row status is set to `'completed'`.

---

## 5. Releasing Grades

Student visibility is gated at the Session (Assignment) level, not individually per submission.

1. **Professor Publishes:** The professor goes to the Analytics Dashboard (`analytics.html`) and clicks "Publish Grades".
2. **Database Update:** This calls a Supabase query setting `publish_status = 'published'` on the `public.sessions` table.

**Code from `js/db.js`:**
```javascript
async publishSession(sessionId) {
    const { error } = await supabaseClient
        .from('sessions')
        .update({ publish_status: 'published' })
        .eq('id', sessionId);
    if (error) throw error;
}
```

3. **Student View:** Students fetching their grades in the Student Portal retrieve them via a query that joins `exam_submissions` and `sessions`, relying on Row Level Security (RLS) to enforce that they can only see their own work *if* the session is published.

**RLS Policy:**
```sql
CREATE POLICY "Students view own submissions" ON public.exam_submissions FOR SELECT USING (
    registration_number IN (SELECT registration_number FROM public.students WHERE auth_id = auth.uid())
    AND session_id IN (SELECT id FROM public.sessions WHERE publish_status = 'published')
);
```