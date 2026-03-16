# Playbook Zero-Hallucination Architecture Strategy

The AI engine in Playbook operates in a highly constrained environment to ensure absolute fidelity to the teacher's marking scheme and to eliminate any possibility of "academic fraud" or hallucination.

## Core Architectural Pillars

1. **Strict Evaluation Confinement (The "Sandbox" Rule)**
   The AI is explicitly forbidden from generating answers, deriving alternative correct methods unless explicitly authorized, or inferring knowledge not present in the marking scheme. If a student's answer relies on facts outside the scheme, the AI must mark it as incorrect or, at best, ungradable without human intervention.

2. **Explicit Answer Status Triage**
   Before evaluating the *content* of an answer, the AI must perform a triage step: did the student even attempt the question?
   - The JSON output schema mandates an `answer_status` field for every question, strictly constrained to `["Answered", "Skipped"]`.
   - If the AI identifies a blank space, generic filler text (e.g., "I don't know"), or irrelevant text for a specific question, it must immediately classify it as `"Skipped"`.
   - Any question classified as `"Skipped"` automatically forces the score assigned to `0`. No "participation points" or effort points are permitted unless explicitly defined by the scheme.

3. **Schema-Enforced Extraction**
   The AI communicates its evaluation strictly through a predefined JSON schema. This ensures deterministic parsing by the frontend.
   - The extraction phase strictly identifies core metadata: `studentName` and `registrationNumber`. If not found, these default to placeholders, but the AI is not permitted to guess.
   - For evaluations, the schema demands a `score` (numeric), a `justification` (mapping the decision directly to the marking scheme criteria), and `feedback` (constructive notes for the student).

4. **Human-in-the-Loop Override**
   While the AI provides a comprehensive first pass, the architecture ensures the educator retains final authority.
   - The frontend (`review.html`) renders the AI's triage state (e.g., prominently displaying a red "SKIPPED" badge).
   - The UI provides immediate, frictionless "Override" controls allowing the teacher to adjust the score if the AI's strict confinement misjudged a valid alternative approach or if a skipped question requires manual review.

## Implementation Details

These architectural rules are embedded deep within the `SYSTEM_PROMPT` in `js/ai.js`, ensuring that every request to the OpenRouter API is bounded by these constraints. The prompt heavily emphasizes keywords like "ZERO TOLERANCE," "FORBIDDEN," and "STRICTLY." By combining prompt engineering with strict JSON schema enforcement and frontend visual cues, Playbook guarantees a highly reliable, deterministic grading process.
