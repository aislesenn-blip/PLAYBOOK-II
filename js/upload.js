// js/upload.js
// Supabase Edge Function Integration for Background Grading




document.addEventListener('DOMContentLoaded', async () => {

    const overlay = document.getElementById('loading-overlay');
    const statusEl = document.getElementById('loading-status');
    const detailEl = document.getElementById('loading-detail');

    window.resumeSession = async function resumeSession(meta) {
        overlay.classList.add('active');
        statusEl.textContent = 'Resuming Session...';
        detailEl.textContent = `Preparing to grade remaining exams for ${meta.sessionName}...`;

        await processQueue(meta);
    }

    async function processQueue(meta) {
        const { sessionId, markingSchemeText, explicitMaxMarks, storagePath } = meta;
        let totalStudentsGraded = await window.PlaybookQueue.getCompletedCount(sessionId);
        let sessionTotalScore = 0; // In a full implementation, we'd persist the running total, or just let the dashboard recalculate it. For now we just query existing submissions.

        // Fetch existing score to resume correctly
        try {
            const { data } = await window.supabaseClient.from('exam_submissions').select('total_score').eq('session_id', sessionId);
            if (data) {
                sessionTotalScore = data.reduce((sum, s) => sum + s.total_score, 0);
                totalStudentsGraded = data.length; // More accurate
            }
        } catch(e) {}

        let nextChunk = await window.PlaybookQueue.getNextPendingChunk(sessionId);

        while (nextChunk) {
            const pendingCount = await window.PlaybookQueue.getPendingCount(sessionId);

            // UI Update for Live Review Theater & Queue
            statusEl.textContent = `Grading Student ${totalStudentsGraded + 1}...`;
            detailEl.textContent = `${pendingCount} students remaining in queue. Analyzing pages via Playbook API.`;

            // If we have at least 1 graded, show the review button
            if (totalStudentsGraded > 0 && !document.getElementById('live-review-btn')) {
                const btn = document.createElement('a');
                btn.id = 'live-review-btn';
                btn.href = `review.html?session=${sessionId}`;
                btn.target = '_blank';
                btn.className = 'btn';
                btn.style.marginTop = '1rem';
                btn.style.backgroundColor = '#10b981'; // green-500
                btn.textContent = 'Review Graded Students Now (Opens in new tab)';
                detailEl.parentNode.appendChild(btn);

                // Also update the session status to needs_review immediately
                try {
                    await window.supabaseClient.from('sessions').update({
                        status: 'needs_review'
                    }).eq('id', sessionId);
                } catch(e) {}
            }

            try {
                let gradedStudents = await window.PlaybookAI.gradeBatchExams(nextChunk.images, markingSchemeText);

                for (let i = 0; i < gradedStudents.length; i++) {
                    const student = gradedStudents[i];
                    let studentTotal = 0;

                    const parsedQuestions = student.questions || student.evaluations || student.results || [];
                    if (parsedQuestions && Array.isArray(parsedQuestions)) {
                        parsedQuestions.forEach(q => {
                            const qScore = parseFloat(q.score) || parseFloat(q.marks_awarded) || 0;
                            studentTotal += qScore;
                        });
                    }

                    await window.supabaseClient.from('exam_submissions').insert({
                        session_id: sessionId,
                        student_name: student.name !== undefined ? student.name : student.studentName || `Unknown Student ${totalStudentsGraded + i + 1}`,
                        registration_number: student.id !== undefined ? student.id : student.registrationNumber || `ID-UNKNOWN-${totalStudentsGraded + i + 1}`,
                        pdf_storage_path: storagePath,
                        total_score: studentTotal,
                        max_score: explicitMaxMarks,
                        grading_data: { questions: parsedQuestions },
                        status: 'completed',
                        completed_at: new Date().toISOString()
                    });

                    sessionTotalScore += studentTotal;
                }

                totalStudentsGraded += gradedStudents.length;
                await window.PlaybookQueue.markChunkCompleted(nextChunk.id);
            } catch (aiErr) {
                console.error("AI Error on chunk", nextChunk.id, aiErr);
                alert(`Grading paused due to an error on chunk ${nextChunk.id}. Please try resuming the session later. Error: ${aiErr.message}`);
                overlay.classList.remove('active');
                return; // Break out to preserve the pending chunk for resumption
            }

            nextChunk = await window.PlaybookQueue.getNextPendingChunk(sessionId);
        }

        // Finished all chunks
        statusEl.textContent = 'Finalizing Results...';
        detailEl.textContent = `Successfully graded ${totalStudentsGraded} students in total.`;

        const sessionAverage = totalStudentsGraded > 0 ? (sessionTotalScore / totalStudentsGraded) : 0;
        await window.supabaseClient.from('sessions').update({
            status: 'needs_review',
            total_students: totalStudentsGraded,
            average_score: sessionAverage
        }).eq('id', sessionId);

        await window.PlaybookQueue.deleteMeta(sessionId);

        statusEl.textContent = 'Grading Complete!';
        detailEl.textContent = 'Exams are ready for Human-in-the-Loop review. Redirecting...';

        setTimeout(() => {
            window.location.href = `index.html`;
        }, 3000);
    }



    const sessionUser = requireAuth(['professor', 'admin']);
    if (!sessionUser) return;

    // --- CHECK FOR PENDING SESSION IN QUEUE ---
    try {
        if (window.PlaybookQueue) {
            const pending = await window.PlaybookQueue.getFirstPendingSession();
            if (pending) {
                const resume = confirm(`You have an unfinished grading session ("${pending.meta.sessionName}") with ${pending.pendingCount} exams remaining. Would you like to resume it now?\n\nClick OK to resume, or Cancel to start a new session (the old one will be cleared from your local browser).`);
                if (resume) {
                    resumeSession(pending.meta);
                    return; // Stop normal init
                } else {
                    await window.PlaybookQueue.deleteAllChunksForSession(pending.meta.sessionId);
                    await window.PlaybookQueue.deleteMeta(pending.meta.sessionId);
                }
            }
        }
    } catch (e) {
        console.error("Queue check failed:", e);
    }


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

    // Handle .txt / .pdf upload and dump into textarea
    schemeFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            // Show a quick loading state
            const prevText = rawTextarea.value;
            rawTextarea.value = "Reading document, please wait...";

            if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                try {
                    const arrayBuffer = await file.arrayBuffer();
                    const pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;

                    if (pdfjsLib && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
                        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                    }

                    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                    let imagesArray = [];

                    rawTextarea.value = `Rendering ${pdfDoc.numPages} pages for Vision AI...`;

                    for (let i = 1; i <= pdfDoc.numPages; i++) {
                        const page = await pdfDoc.getPage(i);
                        // Scale up for AI processing (1.5) just like exams
                        const aiViewport = page.getViewport({ scale: 1.5 });
                        const aiCanvas = document.createElement('canvas');
                        const aiCtx = aiCanvas.getContext('2d');
                        aiCanvas.height = aiViewport.height;
                        aiCanvas.width = aiViewport.width;
                        aiCtx.fillStyle = '#FFFFFF';
                        aiCtx.fillRect(0, 0, aiCanvas.width, aiCanvas.height);

                        await page.render({ canvasContext: aiCtx, viewport: aiViewport }).promise;
                        const dataUrl = aiCanvas.toDataURL('image/jpeg', 0.8);
                        imagesArray.push(dataUrl);

                        // Free memory
                        aiCanvas.width = 0; aiCanvas.height = 0;
                    }

                    rawTextarea.value = "Sending scanned images to Playbook AI for OCR and Formatting. Please wait...";

                    // Directly call the AI to optimize from images
                    try {
                        const structured = await window.PlaybookAI.optimizeMarkingScheme(imagesArray);
                        optimizedTextarea.value = structured;

                        rawContainer.style.display = 'none';
                        optimizedContainer.style.display = 'block';
                    } catch (aiError) {
                        console.error("AI Error:", aiError);
                        alert(`Failed to analyze scanned PDF: ${aiError.message}`);
                        rawTextarea.value = prevText;
                    }

                } catch (error) {
                    console.error("Error reading PDF:", error);
                    alert("Failed to read PDF file: " + error.message);
                    rawTextarea.value = prevText;
                }
            } else {
                try {
                    const text = await file.text();
                    rawTextarea.value = text;
                } catch (error) {
                     alert("Failed to read file.");
                     rawTextarea.value = prevText;
                }
            }
        }
        // Reset the file input so the same file can be selected again
        e.target.value = '';
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
        const totalExamMarksInput = document.getElementById('total-exam-marks');
        const explicitMaxMarks = totalExamMarksInput ? parseFloat(totalExamMarksInput.value) || 100 : 100;
        const examsFile = examsFileInput.files[0];

        // Decide which scheme text to use
        let markingSchemeText = optimizedTextarea.value.trim();
        if (!markingSchemeText || optimizedContainer.style.display === 'none') {
            markingSchemeText = rawTextarea.value.trim();
        }

        // Disable required attribute temporarily if hidden to allow form submission
        if (optimizedContainer.style.display === 'none') {
            optimizedTextarea.removeAttribute('required');
        } else {
            optimizedTextarea.setAttribute('required', '');
        }

        if (!examsFile || !sessionName) {
            alert('Please provide a session name and upload an exams PDF.');
            return;
        }


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
                    const pixel = pixelBuffer[i];
                    // Extract RGB components (little-endian: ABGR)
                    const r = pixel & 0xFF;
                    const g = (pixel >> 8) & 0xFF;
                    const b = (pixel >> 16) & 0xFF;

                    // Consider pixels darker than #EBEBEB to be actual ink,
                    // avoiding false positives from scanned paper artifacts or anti-aliasing.
                    if (r < 235 || g < 235 || b < 235) {
                        nonWhitePixels++;
                    }
                }
                const inkCoverage = nonWhitePixels / Math.floor(pixelBuffer.length / 10);
                return inkCoverage < 0.005; // Less than 0.5% dark pixels means blank
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


            // Step B: Save chunks to IndexedDB Queue
            statusEl.textContent = 'Building Queue...';
            detailEl.textContent = `Saving ${studentChunks.length} students to local storage to prevent data loss...`;

            const meta = {
                sessionId: savedSession.id,
                sessionName: document.getElementById('session-name').value,
                markingSchemeText: markingSchemeText,
                explicitMaxMarks: explicitMaxMarks,
                storagePath: storagePath
            };
            await window.PlaybookQueue.saveMeta(meta);

            for (let chunkIdx = 0; chunkIdx < studentChunks.length; chunkIdx++) {
                const chunkImageDataUrls = studentChunks[chunkIdx];
                await window.PlaybookQueue.saveChunk({
                    id: `${savedSession.id}_chunk_${chunkIdx}`,
                    sessionId: savedSession.id,
                    images: chunkImageDataUrls,
                    status: 'pending'
                });
            }

            // Step C: Process the Queue (Start Live Review Theater)
            await processQueue(meta);

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
