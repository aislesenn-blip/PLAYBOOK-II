document.addEventListener('DOMContentLoaded', () => {

    const form = document.getElementById('upload-form');
    const schemeFileInput = document.getElementById('scheme-file');
    const examsFileInput = document.getElementById('exams-file');

    // Smart Pre-Processor Logic
    const optimizeBtn = document.getElementById('optimize-scheme-btn');
    const resetBtn = document.getElementById('reset-scheme-btn');
    const rawContainer = document.getElementById('raw-scheme-container');
    const optimizedContainer = document.getElementById('optimized-scheme-container');
    const rawTextarea = document.getElementById('raw-scheme-text');
    const optimizedTextarea = document.getElementById('optimized-scheme-text');

    // Handle .txt upload and dump into textarea
    schemeFileInput.addEventListener('change', async (e) => {
        if(e.target.files[0]) {
            const text = await e.target.files[0].text();
            rawTextarea.value = text;
        }
    });

    optimizeBtn.addEventListener('click', async () => {
        if (!rawTextarea.value.trim()) {
            alert('Please paste or upload a raw scheme first.');
            return;
        }

        optimizeBtn.textContent = 'Formatting...';
        optimizeBtn.disabled = true;

        try {
            const structured = await window.PlaybookAI.optimizeMarkingScheme(rawTextarea.value);
            optimizedTextarea.value = structured;

            rawContainer.style.display = 'none';
            optimizedContainer.style.display = 'block';
        } catch (e) {
            console.error(e);
            alert(`Failed to optimize: ${e.message}`);
        } finally {
            optimizeBtn.textContent = 'Auto-Format Scheme';
            optimizeBtn.disabled = false;
        }
    });

    resetBtn.addEventListener('click', () => {
        optimizedContainer.style.display = 'none';
        rawContainer.style.display = 'block';
        optimizedTextarea.value = '';
    });
    examsFileInput.addEventListener('change', (e) => {
        if(e.target.files[0]) {
            document.getElementById('exams-filename').textContent = e.target.files[0].name;
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const sessionName = document.getElementById('session-name').value;
        const examsFile = examsFileInput.files[0];

        // Decide which scheme text to use
        let markingSchemeText = optimizedTextarea.value.trim();
        if (!markingSchemeText) {
            markingSchemeText = rawTextarea.value.trim();
        }

        if (!markingSchemeText || !examsFile || !sessionName) {
            alert('Please provide a session name, define a marking scheme, and upload an exams PDF.');
            return;
        }

        const overlay = document.getElementById('loading-overlay');
        const statusEl = document.getElementById('loading-status');
        const detailEl = document.getElementById('loading-detail');
        overlay.classList.add('active');

        try {
            statusEl.textContent = 'Processing PDF...';
            detailEl.textContent = 'Extracting pages and detecting separators.';

            // Read PDF
            const arrayBuffer = await examsFile.arrayBuffer();
            const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;

            const studentExams = []; // Array of arrays of data URLs
            let currentStudentPages = [];

            for (let i = 1; i <= pdf.numPages; i++) {
                detailEl.textContent = `Analyzing page ${i} of ${pdf.numPages}...`;

                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: 1.5 });
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d', { willReadFrequently: true });
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                await page.render({ canvasContext: context, viewport: viewport }).promise;

                // Detect Blank Page (Separator)
                const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                const isBlank = checkIsBlank(imageData.data);

                // If it's blank and we have current pages, it's a separator
                if (isBlank && currentStudentPages.length > 0) {
                    studentExams.push(currentStudentPages);
                    currentStudentPages = [];
                } else if (!isBlank) {
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                    currentStudentPages.push(dataUrl);
                }
            }

            // Push last student if no trailing blank page
            if (currentStudentPages.length > 0) {
                studentExams.push(currentStudentPages);
            }

            if (studentExams.length === 0) {
                throw new Error("No non-blank pages found in PDF.");
            }

            statusEl.textContent = 'Initializing Database...';
            const sessionId = Date.now().toString();

            const sessionData = {
                id: sessionId,
                name: sessionName,
                date: new Date().toLocaleDateString(),
                status: 'Grading...',
                totalStudents: studentExams.length,
                gradedCount: 0,
                accumulatedTotalScore: 0,
                highestScore: 0
            };
            await window.PlaybookDB.saveSession(sessionData);

            // Setup Real-time UI Elements
            const realtimeLogContainer = document.getElementById('realtime-log-container');
            const realtimeLog = document.getElementById('realtime-log');
            const cancelBtn = document.getElementById('cancel-grading-btn');

            realtimeLogContainer.style.display = 'block';
            cancelBtn.style.display = 'inline-block';
            realtimeLog.innerHTML = '';

            // Retrieve API key for worker
            const apiKey = localStorage.getItem('PLAYBOOK_API_KEY');

            // Initialize Web Worker
            let worker = new Worker('js/worker.js');

            cancelBtn.onclick = async () => {
                if (worker) {
                    worker.terminate();
                    worker = null;

                    // Update session status to Partial
                    sessionData.status = 'Pending Review (Partial)';
                    if (sessionData.gradedCount > 0) {
                        sessionData.averageScore = Math.round(sessionData.accumulatedTotalScore / sessionData.gradedCount);
                    }
                    await window.PlaybookDB.saveSession(sessionData);

                    alert('Grading cancelled. You can review the students graded so far.');
                    window.location.href = `review.html?session=${sessionId}`;
                }
            };

            worker.onmessage = async (msg) => {
                const { type, payload } = msg.data;

                if (type === 'PROGRESS_UPDATE') {
                    statusEl.textContent = `Playbook Grading Student ${payload.studentIndex + 1} of ${payload.totalStudents}...`;
                    detailEl.textContent = 'Evaluating responses and generating feedback in the background.';
                }
                else if (type === 'STUDENT_GRADED') {
                    const { studentData, studentIndex, totalStudents } = payload;

                    // Re-verify the single source of truth for total score
                    let calcTotalScore = 0;
                    if (studentData.grading && studentData.grading.questions && Array.isArray(studentData.grading.questions)) {
                        studentData.grading.questions.forEach(q => {
                            const marks = parseFloat(q.marks_awarded);
                            if (!isNaN(marks)) calcTotalScore += marks;
                        });
                    }

                    // Override any hallucinated totals with our programmatic calculation
                    studentData.grading.totalScore = calcTotalScore;

                    // Save individual student to IndexedDB instantly
                    await window.PlaybookDB.saveStudent(studentData);

                    // Update running totals in session immediately
                    sessionData.gradedCount++;
                    sessionData.accumulatedTotalScore += calcTotalScore;
                    if (calcTotalScore > sessionData.highestScore) {
                        sessionData.highestScore = calcTotalScore;
                    }
                    await window.PlaybookDB.saveSession(sessionData);

                    // Update UI Log
                    const li = document.createElement('li');
                    li.style.padding = '0.3rem 0';
                    li.style.borderBottom = '1px solid #eee';
                    li.innerHTML = `<strong>[Student ${studentIndex + 1}/${totalStudents}]</strong> Graded ${studentData.studentName} - Score: ${calcTotalScore}`;
                    realtimeLog.appendChild(li);

                    // Scroll to bottom of log
                    realtimeLogContainer.scrollTop = realtimeLogContainer.scrollHeight;
                }
                else if (type === 'ALL_DONE') {
                    worker.terminate();
                    worker = null;

                    // Finalize Session
                    sessionData.status = 'Pending Review';
                    if (sessionData.gradedCount > 0) {
                        sessionData.averageScore = Math.round(sessionData.accumulatedTotalScore / sessionData.gradedCount);
                    }
                    await window.PlaybookDB.saveSession(sessionData);

                    statusEl.textContent = 'Grading Complete!';
                    detailEl.textContent = 'Redirecting to review...';

                    setTimeout(() => {
                        window.location.href = `review.html?session=${sessionId}`;
                    }, 500);
                }
                else if (type === 'ERROR') {
                    console.error("Worker error:", payload.message);
                    alert(`An error occurred during background grading: ${payload.message}`);
                    worker.terminate();
                    overlay.classList.remove('active');
                }
            };

            worker.onerror = (err) => {
                console.error("Worker failed:", err);
                alert("Fatal error in grading worker.");
                worker.terminate();
                overlay.classList.remove('active');
            };

            // Start the Worker
            worker.postMessage({
                type: 'START_GRADING',
                payload: {
                    studentExams,
                    markingSchemeText,
                    sessionId,
                    apiKey
                }
            });

        } catch (error) {
            console.error(error);
            alert(`An error occurred: ${error.message}`);
            overlay.classList.remove('active');
        }
    });

    function checkIsBlank(pixels) {
        // Simple heuristic: if 99% of pixels are white (or very light gray), it's blank
        let whiteCount = 0;
        const threshold = 240; // R, G, B > 240 is considered white
        const totalPixels = pixels.length / 4;

        for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i] > threshold && pixels[i+1] > threshold && pixels[i+2] > threshold) {
                whiteCount++;
            }
        }
        return (whiteCount / totalPixels) > 0.99;
    }
});
