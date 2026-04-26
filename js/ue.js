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
    const schemeUpload = document.getElementById("ue-scheme-upload");
    const schemeStatus = document.getElementById("ue-scheme-status");

    const studentText = document.getElementById("ue-student-text");
    const studentUpload = document.getElementById("ue-student-upload");
    const studentStatus = document.getElementById("ue-student-status");

    const terminal = document.getElementById("ue-terminal");

    // File to Base64 Helper
    const fileToBase64 = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });

    // Setup Target Classes
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

    // Auto-Process Scheme Upload
    schemeUpload.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        schemeStatus.textContent = "Extracting scheme text...";
        try {
            let extractedText = "";
            if (file.name.endsWith('.pdf')) {
                extractedText = await window.PlaybookAI.extractTextFromPDF(file);
            } else if (file.name.endsWith('.docx')) {
                extractedText = await window.PlaybookAI.extractTextFromWord(file);
            } else if (file.type.startsWith('image/')) {
                const base64 = await fileToBase64(file);
                extractedText = await window.PlaybookAI.extractMarkingSchemeOCR([base64]);
            }

            schemeStatus.textContent = "Formatting via AI Compiler...";
            const optimized = await window.PlaybookAI.optimizeMarkingScheme(extractedText);

            schemeStatus.textContent = "Compiling Golden JSON...";
            const goldenJson = await window.compileGoldenJSON(await window.PlaybookAI.getSecureKey(), optimized);

            schemeText.value = JSON.stringify(goldenJson, null, 2);
            schemeStatus.textContent = "Golden JSON compiled successfully!";
            schemeStatus.style.color = "var(--success-color)";
        } catch (error) {
            schemeStatus.textContent = "Compilation Error: " + error.message;
            schemeStatus.style.color = "var(--error-color)";
        }
    });

    // Handle Execution
    startBtn.addEventListener("click", async () => {
        let rawScheme = schemeText.value.trim();
        let rawStudent = studentText.value.trim();
        const sessionName = document.getElementById("session-name").value.trim();
        const courseId = classSelect.value || null;

        if (!sessionName || !courseId) {
            alert('Please select a Target Class and provide a Session Name before executing.');
            return;
        }

        startBtn.disabled = true;
        startBtn.textContent = "Processing Documents...";
        terminal.innerHTML = "";

        let goldenJson;
        let studentAnswersJson;

        try {
            // Validate Scheme
            if (!rawScheme) {
                logTerminal("Marking scheme is required. Please paste JSON or upload a document.", "error");
                throw new Error("Marking scheme is required.");
            }
            try {
                goldenJson = JSON.parse(rawScheme);
            } catch(e) {
                logTerminal("Invalid JSON format in the Marking Scheme box. Ensure it was compiled correctly.", "error");
                throw new Error("Invalid JSON format in Marking Scheme.");
            }

            // Process Student Document if uploaded
            const studentFile = studentUpload.files[0];
            let studentNameStr = "Manual Upload Student";
            let studentRegNoStr = `REG-${Date.now()}`;

            if (studentFile && !rawStudent) {
                // Strict File Type Validation mirroring upload.js
                const validTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
                if (!validTypes.includes(studentFile.type)) {
                    logTerminal(`Invalid file type selected: ${studentFile.name}. Only PDF and images are supported.`, "error");
                    throw new Error("Invalid file type.");
                }

                logTerminal("Extracting logic from uploaded student exam...", "info");
                let base64Payload = null;

                if (studentFile.name.endsWith('.pdf')) {
                    const arrayBuffer = await studentFile.arrayBuffer();
                    const pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;
                    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

                    let base64Images = [];
                    for (let i = 1; i <= pdfDoc.numPages; i++) {
                        const page = await pdfDoc.getPage(i);
                        const viewport = page.getViewport({ scale: 1.5 });
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;
                        ctx.fillStyle = '#FFFFFF';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
                        base64Images.push(canvas.toDataURL('image/jpeg', 0.8));
                    }
                    base64Payload = base64Images;
                } else if (studentFile.type.startsWith('image/')) {
                    base64Payload = [await fileToBase64(studentFile)];
                }

                logTerminal("Sending chunks to PlaybookAI Mass-Extractor...", "info");
                const extractionResults = await window.PlaybookAI.extractStudentExamsUE(base64Payload, goldenJson);

                const studentData = extractionResults[0];
                if (studentData.student_name) studentNameStr = studentData.student_name;
                if (studentData.student_id) studentRegNoStr = studentData.student_id;

                // UE mapping structure
                studentAnswersJson = studentData.questions.reduce((acc, q) => {
                    acc[q.questionId] = q.text;
                    return acc;
                }, {});

                studentText.value = JSON.stringify(studentAnswersJson, null, 2);
                studentStatus.textContent = "Extraction complete!";
                studentStatus.style.color = "var(--success-color)";
            } else if (rawStudent) {
                try {
                    studentAnswersJson = JSON.parse(rawStudent);
                } catch(e) {
                    throw new Error("Invalid JSON format in the Student Answers box.");
                }
            } else {
                throw new Error("Please upload a student exam or paste their JSON answers.");
            }

            logTerminal("Initializing Holistic Exam Engine (Gemini 2.5 Pro)...");

            // Format parameters for holistic grading
            const schemePayload = typeof goldenJson === 'object' ? JSON.stringify(goldenJson) : rawScheme;
            const studentPayload = typeof studentAnswersJson === 'object' ? JSON.stringify(studentAnswersJson) : rawStudent;

            logTerminal("Executing Ultra-Precision Holistic Master Prompt...");
            const rawResults = await window.PlaybookAI.gradeExamHolistically(schemePayload, studentPayload);

            logTerminal("Applying Strict Math Aggregation via JS Engine...");
            // Reuse the existing deterministic aggregator
            const finalData = window.PlaybookAI.calculateDeterministicScores ?
                window.PlaybookAI.calculateDeterministicScores({ questions: rawResults.questions }, "") :
                { questions: rawResults.questions, totalScore: rawResults.questions.reduce((sum, q) => sum + (parseFloat(q.score) || 0), 0) };

            logTerminal(`Execution Complete. Total Score Calculated: ${finalData.totalScore || 0}. Saving to DB...`, "success");

            // 1. Create a real session in the DB (Fully authenticated)
            let sessionId;
            const sess = await window.PlaybookDB.saveSession({
                name: sessionName,
                course_id: courseId,
                professor_id: sessionUser.user_id, // Vital for RLS
                publish_status: 'draft',
                total_submissions: 1
            });
            if (sess) sessionId = sess.id;

            // Save to DB using the extracted or generated names
            await window.PlaybookDB.saveStudentGradeUE(sessionId, studentRegNoStr, studentNameStr, finalData, studentAnswersJson);
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
