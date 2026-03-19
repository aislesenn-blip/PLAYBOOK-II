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
            const imageDataUrls = [];

            let sessionTotalScore = 0;
            let totalStudentsGraded = 0;
            const CHUNK_SIZE = 5; // Process 5 pages per API call to prevent OOM and token exhaustion

            for (let startIndex = 1; startIndex <= numPages; startIndex += CHUNK_SIZE) {
                const endIndex = Math.min(startIndex + CHUNK_SIZE - 1, numPages);
                const chunkImageDataUrls = [];

                statusEl.textContent = `Processing Pages ${startIndex} to ${endIndex} of ${numPages}...`;
                detailEl.textContent = 'Extracting and rendering exam chunks...';

                // Convert chunk of pages to image Data URLs
                for (let i = startIndex; i <= endIndex; i++) {
                    const page = await pdfDoc.getPage(i);
                    // Lower scale (1.5) to keep payload sizes manageable for 128k context windows
                    const viewport = page.getViewport({ scale: 1.5 });
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;

                    await page.render({ canvasContext: ctx, viewport: viewport }).promise;

                    // Compress image as JPEG
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                    chunkImageDataUrls.push(dataUrl);

                    // Free memory
                    canvas.width = 0;
                    canvas.height = 0;
                }

                detailEl.textContent = `Analyzing chunk via secure Playbook API proxy. Do not close.`;

                // Trigger AI Engine natively via browser for this chunk
                const gradedStudents = await window.PlaybookAI.gradeBatchExams(chunkImageDataUrls, markingSchemeText);

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
