// js/upload.js
// Supabase Edge Function Integration for Background Grading




document.addEventListener('DOMContentLoaded', async () => {

    const sessionUser = requireAuth(['professor', 'admin']);
    if (!sessionUser) return;

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

    // File name display
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

        if (!examsFile || !sessionName) {
            alert('Please provide a session name and upload an exams PDF.');
            return;
        }

        const overlay = document.getElementById('loading-overlay');
        const statusEl = document.getElementById('loading-status');
        const detailEl = document.getElementById('loading-detail');
        overlay.classList.add('active');

        try {
            statusEl.textContent = 'Preparing Upload...';
            detailEl.textContent = 'Connecting to Playbook Edge Network.';

            // 1. Create a "Pending" Session in Supabase
            const newSession = {
                professor_id: sessionUser.user_id,
                name: sessionName,
                marking_scheme: markingSchemeText,
                status: 'pending',
                total_students: 0 // Will update once backend splits PDF
            };

            const savedSession = await window.PlaybookDB.saveSession(newSession);

            // 2. Upload PDF to Supabase Storage Bucket ('exams_bucket')
            statusEl.textContent = 'Uploading Exam PDF...';
            detailEl.textContent = 'Securely transferring file to cloud storage.';

            const filePath = `sessions/${savedSession.id}/${Date.now()}_${examsFile.name}`;
            const { data, error } = await window.supabaseClient.storage
                .from('exams_bucket')
                .upload(filePath, examsFile);

            if (error) {
                // Rollback session
                await window.supabaseClient.from('sessions').delete().eq('id', savedSession.id);
                throw error;
            }

            const storagePath = data.path;

            // 3. Update Session to Processing
            await window.supabaseClient.from('sessions').update({
                status: 'processing',
                pdf_storage_path: storagePath
            }).eq('id', savedSession.id);

            statusEl.textContent = 'Grading Engine Active...';
            detailEl.textContent = 'Playbook AI is analyzing the document. Please do not close this window.';

            // 4. Distributed Client-Side Processing
            // Convert PDF to Base64 Images natively using pdf.js to guarantee model compatibility (e.g. GPT-4o)
            const arrayBuffer = await examsFile.arrayBuffer();

            // Initialize pdf.js
            const pdfjsLib = window['pdfjs-dist/build/pdf'];
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

            const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const numPages = pdfDoc.numPages;

            // Helper function to detect if a page is mostly blank (using simple pixel variance)
            function isCanvasBlank(canvas, ctx) {
                const pixelBuffer = new Uint32Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
                let nonWhitePixels = 0;
                // Sample every 10th pixel for performance
                for (let i = 0; i < pixelBuffer.length; i += 10) {
                    // Check if pixel is not fully white (ignoring alpha channel for standard PDF render)
                    if ((pixelBuffer[i] & 0x00FFFFFF) !== 0x00FFFFFF) {
                        nonWhitePixels++;
                    }
                }
                const inkCoverage = nonWhitePixels / (pixelBuffer.length / 10);
                return inkCoverage < 0.005; // Less than 0.5% non-white pixels usually means blank
            }

            let sessionTotalScore = 0;
            let totalStudentsGraded = 0;

            // Step A: Group pages into chunks by blank page detection
            statusEl.textContent = 'Scanning Document...';
            detailEl.textContent = `Detecting blank page separators across ${numPages} pages...`;

            const studentChunks = [];
            let currentStudentPages = [];

            for (let i = 1; i <= numPages; i++) {
                const page = await pdfDoc.getPage(i);
                // Lower scale (1.0) for fast blank detection
                const viewport = page.getViewport({ scale: 1.0 });
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                // Fill white background first
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                await page.render({ canvasContext: ctx, viewport: viewport }).promise;

                const isBlank = isCanvasBlank(canvas, ctx);

                // Scale up for AI processing (1.5)
                const aiViewport = page.getViewport({ scale: 1.5 });
                const aiCanvas = document.createElement('canvas');
                const aiCtx = aiCanvas.getContext('2d');
                aiCanvas.height = aiViewport.height;
                aiCanvas.width = aiViewport.width;
                aiCtx.fillStyle = '#FFFFFF';
                aiCtx.fillRect(0, 0, aiCanvas.width, aiCanvas.height);

                await page.render({ canvasContext: aiCtx, viewport: aiViewport }).promise;
                const dataUrl = aiCanvas.toDataURL('image/jpeg', 0.8);

                if (isBlank && currentStudentPages.length > 0) {
                    studentChunks.push([...currentStudentPages]);
                    currentStudentPages = [];
                } else if (!isBlank) {
                    currentStudentPages.push(dataUrl);
                }

                // Free memory
                canvas.width = 0; canvas.height = 0;
                aiCanvas.width = 0; aiCanvas.height = 0;
            }

            if (currentStudentPages.length > 0) {
                studentChunks.push(currentStudentPages);
            }

            // Step B: Grade each student sequentially
            for (let chunkIdx = 0; chunkIdx < studentChunks.length; chunkIdx++) {
                const chunkImageDataUrls = studentChunks[chunkIdx];

                statusEl.textContent = `Grading Student ${chunkIdx + 1} of ${studentChunks.length}...`;
                detailEl.textContent = `Analyzing ${chunkImageDataUrls.length} pages for this student via Playbook API. Do not close.`;

                // Trigger AI Engine natively via browser for this chunk
                let gradedStudents = [];
                try {
                    gradedStudents = await window.PlaybookAI.gradeBatchExams(chunkImageDataUrls, markingSchemeText);
                } catch (aiErr) {
                    console.error("AI Error on chunk", chunkIdx, aiErr);
                    continue;
                }

                // Insert each student into exam_submissions natively
                for (let i = 0; i < gradedStudents.length; i++) {
                    const student = gradedStudents[i];
                    let studentTotal = 0;
                    let maxTotal = 0;

                    // Defensive Mapping: Catch common LLM schema deviations
                    const parsedQuestions = student.questions || student.evaluations || student.results || [];

                    // Calculate Triage Score from streamlined keys
                    if (parsedQuestions && Array.isArray(parsedQuestions)) {
                        parsedQuestions.forEach(q => {
                            const qScore = parseFloat(q.score) || parseFloat(q.marks_awarded) || 0;
                            const qMax = parseFloat(q.max) || parseFloat(q.max_marks) || 0;

                            studentTotal += qScore;
                            maxTotal += qMax;
                        });
                    }

                    // Ensure max Score isn't 0
                    maxTotal = maxTotal > 0 ? maxTotal : (student.max || student.maxScore || 100);

                    try {
                        await window.supabaseClient.from('exam_submissions').insert({
                            session_id: savedSession.id,
                            student_name: student.name !== undefined ? student.name : student.studentName || `Unknown Student ${totalStudentsGraded + i + 1}`,
                            registration_number: student.id !== undefined ? student.id : student.registrationNumber || `ID-UNKNOWN-${totalStudentsGraded + i + 1}`,
                            pdf_storage_path: storagePath,
                            total_score: studentTotal,
                            max_score: maxTotal,
                            grading_data: { questions: parsedQuestions },
                            status: 'completed',
                            completed_at: new Date().toISOString()
                        });

                        sessionTotalScore += studentTotal;
                    } catch (dbErr) {
                        console.error("Failed to insert student:", student, dbErr);
                    }
                }

                totalStudentsGraded += gradedStudents.length;

                // Explicitly clear memory of current chunk images to prevent OOM
                chunkImageDataUrls.length = 0;
            }

            statusEl.textContent = 'Finalizing Results...';
            detailEl.textContent = `Successfully graded ${totalStudentsGraded} students in total.`;

            // 5. Update Session to Needs Review
            const sessionAverage = totalStudentsGraded > 0 ? (sessionTotalScore / totalStudentsGraded) : 0;
            await window.supabaseClient.from('sessions').update({
                status: 'needs_review',
                total_students: totalStudentsGraded,
                average_score: sessionAverage
            }).eq('id', savedSession.id);

            statusEl.textContent = 'Grading Complete!';
            detailEl.textContent = 'Exams are ready for Human-in-the-Loop review. Redirecting...';

            setTimeout(() => {
                window.location.href = `index.html`;
            }, 3000);

        } catch (error) {
            // Attempt to mark session as failed
            try {
                const sessionName = document.getElementById('session-name').value;
                if (sessionName) {
                    // Try to find the pending session and fail it
                    const { data } = await window.supabaseClient.from('sessions').select('id').eq('name', sessionName).order('created_at', { ascending: false }).limit(1);
                    if (data && data.length > 0) {
                         await window.supabaseClient.from('sessions').update({ status: 'failed', error_log: error.message }).eq('id', data[0].id);
                    }
                }
            } catch (e) {}

            console.error(error);
            alert(`Upload failed: ${error.message}`);
            overlay.classList.remove('active');
        }
    });

});
