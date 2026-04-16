// js/ue.js
// Frontend Logic for the UE Integration Mode (OCR + Vector Grading)

document.addEventListener("DOMContentLoaded", async () => {
    // Check Auth
    let sessionUser;
    if (window.PlaybookDB && typeof window.PlaybookDB.requireAuth === 'function') {
        sessionUser = await window.PlaybookDB.requireAuth(['Teacher', 'Administrator']);
    } else {
        console.warn("Auth disabled or unavailable in sandbox.");
        sessionUser = { user_id: 'sandbox-teacher' };
    }

    const startBtn = document.getElementById("start-ue-btn");
    const schemeText = document.getElementById("ue-scheme-text");
    const studentFileInput = document.getElementById("student-file");
    const uploadZone = document.getElementById("upload-zone");
    const fileListEl = document.getElementById("file-list");
    const schemeFileInput = document.getElementById("scheme-file");
    const optimizeSchemeBtn = document.getElementById("optimize-scheme-btn");

    const inputPhase = document.getElementById("input-phase");
    const processingPhase = document.getElementById("processing-phase");
    const realtimeLog = document.getElementById("realtime-log");
    const loadingStatus = document.getElementById("loading-status");
    const loadingDetail = document.getElementById("loading-detail");

    let uploadedStudentFiles = []; // Expects { file: File, base64Images: [] }

    // Setup Target Classes (Dummy for sandbox, logic for DB)
    const classSelect = document.getElementById("target-class");
    if (window.PlaybookDB && typeof window.PlaybookDB.getTeacherCourses === 'function') {
        try {
            const courses = await window.PlaybookDB.getTeacherCourses(sessionUser.user_id);
            if (courses && courses.length > 0) {
                courses.forEach(c => {
                    const option = document.createElement("option");
                    option.value = c.course_id;
                    option.textContent = c.name;
                    classSelect.appendChild(option);
                });
            }
        } catch (e) {
            console.error("Failed to load courses:", e);
        }
    }

    // Handle Marking Scheme Optimization
    optimizeSchemeBtn.addEventListener("click", async () => {
        const rawText = schemeText.value.trim();
        if (!rawText) {
            alert("Please paste the marking scheme text or upload a document first.");
            return;
        }

        optimizeSchemeBtn.disabled = true;
        optimizeSchemeBtn.innerText = "Formatting JSON...";

        try {
            const goldenJson = await window.compileGoldenJSON(localStorage.getItem('PLAYBOOK_GEMINI_API_KEY') || 'mock-key', rawText);

            document.getElementById("optimized-scheme-text").value = JSON.stringify(goldenJson, null, 2);
            document.getElementById("optimized-scheme-container").style.display = "block";
            schemeText.parentElement.style.display = "none";
        } catch (e) {
            console.error(e);
            alert("Failed to auto-format scheme: " + e.message);
        } finally {
            optimizeSchemeBtn.disabled = false;
            optimizeSchemeBtn.innerText = "Auto-Format Scheme";
        }
    });

    document.getElementById("reset-scheme-btn").addEventListener("click", () => {
        document.getElementById("optimized-scheme-container").style.display = "none";
        schemeText.parentElement.style.display = "block";
        document.getElementById("optimized-scheme-text").value = "";
    });

    // Scheme File Upload handler
    schemeFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const fileName = file.name.toLowerCase();
        const fileType = file.type;

        if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
            try {
                schemeFileInput.parentElement.innerText = 'Extracting PDF...';

                // Native PDF text extraction
                const arrayBuffer = await file.arrayBuffer();
                const pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;
                const pdfDoc = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
                let fullText = "";
                for (let i = 1; i <= pdfDoc.numPages; i++) {
                    const page = await pdfDoc.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => item.str).join(" ");
                    fullText += pageText + "\n";
                }
                schemeText.value = fullText;

            } catch (err) {
                console.error("PDF Extraction failed, falling back to OCR", err);
                alert("Could not extract raw text. Please use AI Vision.");
            } finally {
                schemeFileInput.parentElement.innerText = 'Upload Document';
                schemeFileInput.parentElement.appendChild(schemeFileInput);
            }
        }
    });

    // Drag and Drop Student Exams
    uploadZone.addEventListener('click', () => studentFileInput.click());
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.style.backgroundColor = 'var(--bg-color)';
    });
    uploadZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        uploadZone.style.backgroundColor = 'transparent';
    });
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.style.backgroundColor = 'transparent';
        if (e.dataTransfer.files.length) {
            handleStudentFiles(e.dataTransfer.files);
        }
    });
    studentFileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            handleStudentFiles(e.target.files);
        }
    });

    async function handleStudentFiles(files) {
        // Clear previous
        uploadedStudentFiles = [];
        fileListEl.innerHTML = "";

        for (let i=0; i<files.length; i++) {
            const file = files[i];
            const li = document.createElement("div");
            li.style.marginBottom = "0.5rem";
            li.innerHTML = `<strong>${file.name}</strong> (Pending Processing)`;
            fileListEl.appendChild(li);

            // Convert to Base64 Images for Gemini
            let base64Images = [];
            const fileType = file.type;
            const fileName = file.name.toLowerCase();

            try {
                if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
                    li.innerHTML = `<strong>${file.name}</strong> (Rasterizing PDF...)`;
                    const arrayBuffer = await file.arrayBuffer();
                    const pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;
                    const pdfDoc = await pdfjsLib.getDocument({data: arrayBuffer}).promise;

                    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
                        const page = await pdfDoc.getPage(pageNum);
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
                } else if (fileType.startsWith('image/') || fileName.endsWith('.png') || fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
                    li.innerHTML = `<strong>${file.name}</strong> (Reading Image...)`;
                    base64Images = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = (event) => resolve([event.target.result]);
                        reader.readAsDataURL(file);
                    });
                } else {
                     li.innerHTML = `<span style="color: red;"><strong>${file.name}</strong> (Unsupported format)</span>`;
                     continue;
                }

                uploadedStudentFiles.push({ file, base64Images });
                li.innerHTML = `<span style="color: var(--success-color);"><strong>${file.name}</strong> (Ready)</span>`;

            } catch (e) {
                console.error(e);
                li.innerHTML = `<span style="color: red;"><strong>${file.name}</strong> (Failed to process)</span>`;
            }
        }
    }


    function appendLog(msg, type="info") {
        const li = document.createElement("li");
        li.style.marginBottom = "0.25rem";
        const time = new Date().toLocaleTimeString();
        if (type === "warn") li.style.color = "#d97706";
        if (type === "error") li.style.color = "#dc2626";
        if (type === "success") li.style.color = "#16a34a";
        li.textContent = `[${time}] ${msg}`;
        realtimeLog.appendChild(li);
        realtimeLog.parentElement.scrollTop = realtimeLog.parentElement.scrollHeight;
    }

    startBtn.addEventListener("click", async () => {
        let schemeSource = document.getElementById("optimized-scheme-text").value.trim();
        if (!schemeSource) schemeSource = schemeText.value.trim();

        if (!schemeSource) {
            alert("Please provide the Marking Scheme (Text or JSON).");
            return;
        }
        if (uploadedStudentFiles.length === 0) {
             alert("Please upload at least one student exam (PDF or Image).");
             return;
        }

        const sessionName = document.getElementById("session-name").value.trim() || "Local Test Session";
        const courseId = classSelect.value || null;

        // Transition UI
        inputPhase.style.display = "none";
        processingPhase.style.display = "flex";
        realtimeLog.innerHTML = "";

        appendLog("Initializing AI OCR and Neuro-Symbolic Vector Engine...");

        let goldenJson;
        try {
            // Check if it's already JSON
            if (schemeSource.startsWith('{')) {
                goldenJson = JSON.parse(schemeSource);
                appendLog("Valid Golden JSON detected.");
            } else {
                 throw new Error("Not JSON");
            }
        } catch(e) {
            appendLog("Raw text detected. Compiling to Golden JSON...", "warn");
            try {
                goldenJson = await window.compileGoldenJSON(localStorage.getItem('PLAYBOOK_GEMINI_API_KEY') || 'mock-key', schemeSource);
                appendLog("Golden JSON compiled successfully.", "success");
            } catch (err) {
                 appendLog("Fatal: Failed to compile marking scheme: " + err.message, "error");
                 loadingStatus.textContent = "Execution Failed";
                 return;
            }
        }

        const engine = new window.UEGraphExecutor(goldenJson);

        try {
            // 1. Create a dummy/real session in the DB
            let sessionId = "sandbox-session-" + Date.now();
            if (window.PlaybookDB && typeof window.PlaybookDB.createSession === 'function') {
                const sess = await window.PlaybookDB.createSession(sessionName, courseId, 'sandbox'); // Assuming sandbox id if course_id missing
                if (sess) sessionId = sess.session_id;
            }

            // Loop through uploaded exams
            for (let i = 0; i < uploadedStudentFiles.length; i++) {
                const doc = uploadedStudentFiles[i];
                loadingStatus.textContent = `Processing Student ${i+1}/${uploadedStudentFiles.length}`;
                appendLog(`Running AI OCR Extractor on ${doc.file.name}...`);

                // OCR Extraction via AI
                // The AI returns an array of students (usually 1 if it's a single exam doc)
                const aiExtractedData = await window.PlaybookAI.extractStudentExamsUE(doc.base64Images, goldenJson);

                for (const student of aiExtractedData) {
                     const stuName = student.student_name || "Unknown Student";
                     const regNo = student.student_id || `REG-${Date.now()}`;
                     appendLog(`Extracted Identity: ${stuName} (${regNo})`, "success");

                     // Run the Graph Execution
                     appendLog(`Running Semantic Vector Executions for ${stuName}...`);
                     const results = await engine.execute(student.questions);

                     appendLog(`Grading complete! Deterministic Score: ${results.totalScore}`, "success");

                     // Save to DB
                     if (window.PlaybookDB && typeof window.PlaybookDB.saveStudentGradeUE === 'function') {
                         await window.PlaybookDB.saveStudentGradeUE(sessionId, regNo, stuName, results);
                         appendLog(`Saved results to database.`);
                     } else {
                         // Mock save for sandbox viewing
                         localStorage.setItem(`sandbox_ue_result_${sessionId}`, JSON.stringify({
                              studentName: stuName,
                              studentId: regNo,
                              totalScore: results.totalScore,
                              breakdown: results.breakdown
                         }));
                     }
                }
            }

            loadingStatus.textContent = "Grading Complete!";
            loadingDetail.textContent = "Taking you to the Review screen to check the results...";

            setTimeout(() => {
                // If in a real environment, go to review.html. In pure sandbox, we might simulate it.
                // For now, we redirect exactly as upload.html does.
                window.location.href = `review.html?session=${sessionId}`;
            }, 2500);

        } catch (error) {
            console.error(error);
            appendLog(`Fatal Runtime Error: ${error.message}`, "error");
            loadingStatus.textContent = "Execution Failed";
        }
    });

});
