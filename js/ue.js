// js/ue.js
// Frontend Logic for the UE Text Paste Mode

document.addEventListener("DOMContentLoaded", () => {
    const startBtn = document.getElementById("start-ue-btn");
    const resetBtn = document.getElementById("reset-ue-btn");
    const schemeText = document.getElementById("ue-scheme-text");
    const studentText = document.getElementById("ue-student-text");

    const inputPhase = document.getElementById("input-phase");
    const reviewPhase = document.getElementById("review-phase");
    const terminal = document.getElementById("ue-terminal");

    const rubricContainer = document.getElementById("rubric-container");
    const finalScoreEl = document.getElementById("final-score");

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

        if (!rawScheme || !rawStudent) {
            alert("Please paste both the Marking Scheme JSON and the Student Text.");
            return;
        }

        let goldenJson;
        try {
            goldenJson = JSON.parse(rawScheme);
        } catch(e) {
            alert("Invalid JSON format in the Marking Scheme box. Ensure it is strict JSON.");
            return;
        }

        startBtn.disabled = true;
        startBtn.textContent = "Executing Vectors...";
        terminal.innerHTML = "";
        logTerminal("Initializing Neuro-Symbolic Engine...");

        try {
            // Initialize Engine
            const engine = new window.UEGraphExecutor(goldenJson);

            // Format input for engine
            // The engine expects { "Q1": "text...", "Q2": "text..." }
            // In paste mode, we just pass the entire text as Q1 to zero-skip scan everything
            const studentAnswers = {
                "FullExam": rawStudent
            };

            logTerminal("Running Sliding Window Chunking and Vector Math...");
            const results = await engine.execute(studentAnswers);

            logTerminal("Execution Complete. Rendering Results.", "success");

            renderResults(results, goldenJson);

            inputPhase.style.display = "none";
            reviewPhase.style.display = "block";

        } catch (error) {
            console.error(error);
            logTerminal(`Fatal Error: ${error.message}`, "error");
        } finally {
            startBtn.disabled = false;
            startBtn.textContent = "Execute Deterministic Grading";
        }
    });

    resetBtn.addEventListener("click", () => {
        inputPhase.style.display = "block";
        reviewPhase.style.display = "none";
        terminal.style.display = "none";
        rubricContainer.innerHTML = "";
    });

    function renderResults(results, goldenJson) {
        finalScoreEl.textContent = results.totalScore;
        rubricContainer.innerHTML = "";

        const breakdown = results.breakdown;

        for (const [qId, data] of Object.entries(breakdown)) {
            const card = document.createElement("div");
            card.className = "rubric-card";
            card.style.border = "1px solid var(--border-color)";
            card.style.borderRadius = "var(--radius-sm)";
            card.style.padding = "1rem";
            card.style.marginBottom = "1rem";

            // Header
            const header = document.createElement("div");
            header.style.display = "flex";
            header.style.justifyContent = "space-between";
            header.style.alignItems = "center";
            header.style.marginBottom = "0.75rem";
            header.style.paddingBottom = "0.5rem";
            header.style.borderBottom = "1px solid var(--border-color)";

            const titleWrap = document.createElement("div");
            const title = document.createElement("h4");
            title.textContent = `${data.title} (${qId})`;
            title.style.margin = "0";
            titleWrap.appendChild(title);

            const scorePill = document.createElement("div");
            scorePill.style.padding = "0.25rem 0.5rem";
            scorePill.style.borderRadius = "99px";
            scorePill.style.fontWeight = "bold";
            scorePill.style.fontSize = "0.9rem";

            if (data.score === data.max_marks) {
                scorePill.style.backgroundColor = "#dcfce7";
                scorePill.style.color = "#166534";
            } else if (data.score > 0) {
                scorePill.style.backgroundColor = "#fef9c3";
                scorePill.style.color = "#854d0e";
            } else {
                scorePill.style.backgroundColor = "#fee2e2";
                scorePill.style.color = "#991b1b";
            }
            scorePill.textContent = `${data.score} / ${data.max_marks} Pts`;

            header.appendChild(titleWrap);
            header.appendChild(scorePill);
            card.appendChild(header);

            // Justification / Feedback
            const justDiv = document.createElement("div");
            justDiv.style.fontSize = "0.9rem";
            justDiv.style.color = "var(--text-secondary)";
            justDiv.style.lineHeight = "1.5";

            // Format logs cleanly
            const logs = data.justification.split(" | ");
            let listHtml = "<ul style='margin-top: 0.5rem; padding-left: 1.5rem;'>";
            logs.forEach(log => {
                let color = "inherit";
                if (log.includes("Fatal") || log.includes("✗") || log.includes("failed") || log.includes("incorrect")) color = "#dc2626"; // red
                if (log.includes("✓") || log.includes("correctly")) color = "#16a34a"; // green
                if (log.includes("⚠️") || log.includes("slightly off")) color = "#d97706"; // orange

                listHtml += `<li style="color: ${color}; margin-bottom: 0.25rem;">${log}</li>`;
            });
            listHtml += "</ul>";

            justDiv.innerHTML = `<strong>Engine Audit Log:</strong> ${listHtml}`;
            card.appendChild(justDiv);

            rubricContainer.appendChild(card);
        }
    }
});
