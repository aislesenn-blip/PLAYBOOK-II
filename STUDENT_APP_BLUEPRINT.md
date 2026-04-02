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
Allows a student to link their account to a professor's class using a 6-digit Join Code.

*   **Endpoint:** `supabase.rpc('api_join_class', { p_student_auth_id, p_join_code })`
*   **Parameters:**
    *   `p_student_auth_id` (UUID): The authenticated student's Supabase Auth ID.
    *   `p_join_code` (TEXT): The 6-digit alphanumeric code provided by the teacher.
*   **Returns:** JSON Object `{ "success": boolean, "message": string, "course_id": UUID, "error": string }`

### B. Submitting an Assignment (`api_submit_work`)
Allows a student to submit a PDF or typed text for grading. The submission starts in a 'pending' state awaiting the teacher's batch AI grading process.

*   **Endpoint:** `supabase.rpc('api_submit_work', { p_student_auth_id, p_session_id, p_text_content, p_pdf_path })`
*   **Parameters:**
    *   `p_student_auth_id` (UUID): The authenticated student's ID.
    *   `p_session_id` (UUID): The specific assignment/session ID they are submitting to.
    *   `p_text_content` (TEXT): The content of the submission if it is a typed online assignment (can be null).
    *   `p_pdf_path` (TEXT): The path within the `exams_bucket` Storage where the uploaded PDF resides (can be null).
*   **Returns:** JSON Object `{ "success": boolean, "submission_id": UUID, "error": string }`

### C. Fetching Grades & Appeals
You will use standard Supabase client methods to query the database, relying on RLS to keep data secure.

*   **View Published Grades:**
    *   Query the `exam_submissions` table where `student_name` matches the user and `status = 'completed'` AND `publish_status = 'published'`. Do not display grades if `publish_status = 'draft'`.
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