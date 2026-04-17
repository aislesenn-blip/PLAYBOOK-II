document.addEventListener("DOMContentLoaded", async () => {
    // 1. Strict Auth Check (Matches Upload Navigation)
    const sessionUser = requireAuth(['professor', 'admin']);
    if (!sessionUser) return;

    // Cache the API keys so UE Engine can use them
    if (typeof window.PlaybookAI !== 'undefined' && typeof window.PlaybookAI.getSecureKey === 'function') {
        try {
            await window.PlaybookAI.getSecureKey();
        } catch(e) {
            console.warn("Could not pre-fetch API keys. Engine might fail if not cached.", e);
        }
    }

    const startBtn = document.getElementById("start-ue-btn");
    const schemeText = document.getElementById("ue-scheme-text");
    const studentText = document.getElementById("ue-student-text");
    const terminal = document.getElementById("ue-terminal");

    // Setup Target Classes (Dummy for sandbox, logic for DB)
    const classSelect = document.getElementById("target-class");
    if (window.PlaybookDB && typeof window.PlaybookDB.getCourses === 'function') {
        try {
            const courses = await window.PlaybookDB.getCourses();
            if (courses && courses.length > 0) {
                courses.forEach(c => {
                    const option = document.createElement("option");
                    option.value = c.id;
                    option.textContent = c.name;
                    classSelect.appendChild(option);
                });
            }
        } catch (e) {
            console.error("Failed to load courses:", e);
        }
    }

    function logTerminal(msg, type="info") {
        terminal.style.display = "block";
        const p = document.createElement("p");
        if (type === "warn") p.className = "log-warn";
        else if (type === "error") p.className = "log-error";
        else p.className = "log-info";
        p.textContent = `> ${msg}`;
        terminal.appendChild(p);
        terminal.scrollTop = terminal.scrollHeight;
    }

    startBtn.addEventListener("click", async () => {
        const rawScheme = schemeText.value.trim();
        const rawStudent = studentText.value.trim();
        const sessionName = document.getElementById("session-name").value.trim() || "Manual Test Session";
        const courseId = classSelect.value || null;

        if (!rawScheme || !rawStudent) {
            alert("Please paste both the Marking Scheme JSON and the Student Answers JSON.");
            return;
        }

        let goldenJson;
        let studentAnswersJson;
        try {
            goldenJson = JSON.parse(rawScheme);
        } catch(e) {
            alert("Invalid JSON format in the Marking Scheme box. Ensure it is strict JSON.");
            return;
        }

        try {
            studentAnswersJson = JSON.parse(rawStudent);
        } catch(e) {
            alert("Invalid JSON format in the Student Answers box. Ensure it is strictly { 'Q1': 'text' }.");
            return;
        }

        startBtn.disabled = true;
        startBtn.textContent = "Executing Vectors...";
        terminal.innerHTML = "";
        logTerminal("Initializing Neuro-Symbolic Engine...");

        try {
            // Initialize Engine
            const engine = new window.UEGraphExecutor(goldenJson);

            logTerminal("Running Sliding Window Chunking and Vector Math...");

            // Format for engine matching: The frontend will pass {"questions": { "Q1": "...", "Q2": "..." }}
            // We pass it directly into execute
            const results = await engine.execute(studentAnswersJson);

            logTerminal(`Execution Complete. Score: ${results.totalScore}. Saving to DB...`, "success");

            // 1. Create a real session in the DB (Fully authenticated)
            let sessionId = "sandbox-session-" + Date.now();
            const sess = await window.PlaybookDB.saveSession({
                name: sessionName,
                course_id: courseId,
                professor_id: sessionUser.user_id, // Vital for RLS
                publish_status: 'draft',
                total_submissions: 1
            });
            if (sess) sessionId = sess.id;

            // Save to DB
            let regNo = `REG-${Date.now()}`;
            let stuName = "Manual Upload Student";

            await window.PlaybookDB.saveStudentGradeUE(sessionId, regNo, stuName, results);
            logTerminal(`Saved results to database. Redirecting...`);

            setTimeout(() => {
                window.location.href = `review.html?session=${sessionId}`;
            }, 1500);

        } catch (error) {
            console.error(error);
            logTerminal(`Fatal Error: ${error.message}`, "error");
        } finally {
            startBtn.disabled = false;
            startBtn.textContent = "Execute Deterministic Grading";
        }
    });
});
