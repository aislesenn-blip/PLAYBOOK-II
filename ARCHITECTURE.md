# Playbook: Global Enterprise Architecture Blueprint

**Role:** Lead Enterprise Architect & Senior EdTech Engineer
**Vision:** Transitioning Playbook from a local-first prototype to a global, enterprise-grade SaaS platform capable of solving 100% of the grading problem via Physical Scanned Exams and Digital "Student Portal" Assignments.

---

## 1. Dual-Interface Architecture & Auth

The system will strictly separate the Educator experience from the Student experience to maximize security and minimize friction.

*   **Teacher Dashboard (Authenticated & Secure):**
    *   **Auth:** Supabase Auth (Email/Password, OAuth via Google/Microsoft for educators).
    *   **Role:** The command center. Teachers authenticate here to create sessions (Assignments), configure Marking Schemes, store their Groq and DeepSeek API Keys (BYOK) securely in the database, view Analytics, and review/override AI decisions.
*   **Student Submission Portal (Frictionless "Digital Drop"):**
    *   **Auth:** Anonymous/Lightweight. No account creation required.
    *   **Role:** A streamlined frontend where students enter a 6-digit alphanumeric "Join Code" (e.g., `HIST202-A`), their Name, and Registration Number. Upon validation of the code against the database, they upload their PDF.
    *   **Security:** Supabase Row Level Security (RLS) ensures students can only `INSERT` into the `submissions` table for a valid Assignment Code and can only `SELECT` their own specific grading result via an ephemeral session token generated upon submission.

## 2. The "Digital Drop" Workflow

1.  **Creation:** Teacher creates an assignment in the Dashboard. Supabase generates a unique `join_code`.
2.  **Access:** Student visits `playbook.app/drop`, enters the `join_code`.
3.  **Upload:** Student uploads a PDF. The frontend uploads the file directly to a secure Supabase Storage bucket (`student_submissions`).
4.  **Trigger:** A new record is inserted into the Supabase `submissions` table containing the `file_url`, `student_name`, and `assignment_id`.
5.  **Event:** This database `INSERT` triggers a Supabase Webhook/Database trigger that fires off the grading pipeline asynchronously.

## 3. The BYOK Security Proxy (Crucial)

To execute grading without exposing the Teacher's Groq and DeepSeek API keys to the student-facing frontend, we must route all AI requests through a secure backend proxy.

*   **Architecture:** Supabase Edge Functions.
*   **The Flow:**
    1.  When a student submits a paper, the Edge Function is triggered.
    2.  The Edge Function queries the `users` table (bypassing RLS via a Service Role key internally) to look up the `api_key` associated with the `teacher_id` linked to that `assignment_id`.
    3.  The Edge Function encrypts/decrypts the key at rest using a master vault key or Supabase Vault.
    4.  The Edge Function constructs the payload (fetching the Marking Scheme and the Student's PDF from Supabase Storage).
    5.  The Edge Function first calls Groq (Llama 3.2 Vision) for OCR/Vision extraction.
    6.  The Edge Function then passes the extracted text to DeepSeek for rigorous, deterministic grading.
    6.  The result is written back to the `submissions` table.
*   **Result:** The student's browser *never* touches the APIs or the Teacher's API key.

## 4. The "Offline" Grading Engine

Teachers must be able to upload a 200-page bulk PDF and immediately close their laptops.

*   **Architecture:** Asynchronous Task Queue (e.g., Supabase Edge Functions invoked asynchronously, or a dedicated worker cluster like Inngest/Trigger.dev connected to Supabase).
*   **The Flow (Physical Upload):**
    1.  Teacher uploads the 200-page PDF to Supabase Storage.
    2.  A lightweight Edge Function instantly splits the PDF by detecting blank pages (using a serverless PDF library) and creates 50 individual `submission` rows in the database marked as `status: PENDING`.
    3.  The frontend receives a `202 Accepted` and the teacher can close the tab.
    4.  A background worker listens for `PENDING` submissions and processes them one by one, updating the database row to `status: GRADED`.
    5.  The Teacher Dashboard uses Supabase Realtime to listen to row updates and animate progress bars if the teacher happens to leave the tab open.

## 5. Extreme Speed & Concurrency

Processing hundreds of physical scans or simultaneous digital drops requires massive parallelization without crashing the architecture.

*   **Stateless Workers:** Supabase Edge Functions scale horizontally and automatically. If 200 students submit at once, 200 instances of the Edge Function can spin up simultaneously.
*   **Connection Pooling:** We use Supabase PgBouncer (connection pooling) to ensure that 200 simultaneous writes to the `submissions` table do not exhaust the Postgres database connections.
*   **Storage Throughput:** Supabase Storage leverages a global CDN, ensuring that downloading 200 PDFs simultaneously into the Edge Functions happens with extremely low latency.

## 6. The BYOK Rate Limit Challenge (Intelligent Queueing)

Concurrency is great, but API rate limits (e.g., "Tier 1: 20 RPM") will reject 200 simultaneous calls from the same API key.

*   **Architecture:** Distributed Task Queue with Concurrency Limits (e.g., Upstash Redis + Supabase, or a queueing service like BullMQ/Trigger.dev).
*   **The Strategy:**
    1.  Instead of triggering 200 Edge Functions immediately, the `INSERT` webhook pushes the grading jobs into a Redis-backed Queue.
    2.  The Queue is partitioned by `teacher_api_key` (or `teacher_id`).
    3.  We enforce a strict **Concurrency Limit per Queue Partition** (e.g., Max 5 concurrent active jobs per Teacher).
    4.  **Exponential Backoff & Jitter:** If the APIs returns a `429 Too Many Requests`, the worker catches the error, delays the job (e.g., waits 10 seconds, then 20, then 40), and safely retries without failing the student's submission.
*   **Result:** 200 students can submit at 11:59 PM. The system accepts all of them instantly (UI shows "Submitted - Grading in Progress"), but the queue strictly drips them to the APIs at a safe rate of 5 at a time, protecting the Teacher's key.

## 7. 100% Accuracy & Storage

To guarantee deterministic grading and zero hallucinations across both scanned images and digital text:

*   **Database Schema (JSONB):** The `submissions` table will have a `grading_result` column of type `JSONB`. This strictly enforces the storage of our Four-Tier evaluation schema (Sub-question ID, Marks Awarded, Max Marks, Answer Status, Justification, Constructive Feedback).
*   **Prompt Engineering Lock-in:** The `SYSTEM_PROMPT` (containing the Semantic Equivalence, Sandwich Method, and missing/skipped rules) is stored as a version-controlled constant in the Edge Function.
*   **Temperature Control:** The Groq Vision payload will remain hardcoded to `temperature: 0.0` inside the Edge Function and Client to prevent creative hallucinations. Due to API constraints, `deepseek-reasoner` relies solely on prompt engineering since temperature overrides and strict JSON structure constraints aren't supported.
*   **Two-Step Pipeline:** The input is converted to text by Groq (Llama 3.2 OCR/Vision), guaranteeing that DeepSeek only operates on pure text data for reasoning.
*   **Single Source of Truth:** The backend explicitly ignores any `totalScore` hallucinated by the LLM. Before the Edge Function writes to the database, a strict Postgres function (or Edge Function logic) executes a programmatic `Array.reduce` over the `JSONB` array to mathematically calculate and lock in the final score.