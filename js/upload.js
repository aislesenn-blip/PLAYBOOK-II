document.addEventListener('DOMContentLoaded', () => {

    const form = document.getElementById('upload-form');
    const schemeFileInput = document.getElementById('scheme-file');
    const examsFileInput = document.getElementById('exams-file');

    // Update filenames
    schemeFileInput.addEventListener('change', (e) => {
        if(e.target.files[0]) {
            document.getElementById('scheme-filename').textContent = e.target.files[0].name;
        }
    });
    examsFileInput.addEventListener('change', (e) => {
        if(e.target.files[0]) {
            document.getElementById('exams-filename').textContent = e.target.files[0].name;
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const sessionName = document.getElementById('session-name').value;
        const schemeFile = schemeFileInput.files[0];
        const examsFile = examsFileInput.files[0];

        if (!schemeFile || !examsFile || !sessionName) {
            alert('Please provide a session name, marking scheme, and exams PDF.');
            return;
        }

        const overlay = document.getElementById('loading-overlay');
        const statusEl = document.getElementById('loading-status');
        const detailEl = document.getElementById('loading-detail');
        overlay.classList.add('active');

        try {
            statusEl.textContent = 'Reading Marking Scheme...';
            const markingSchemeText = await schemeFile.text();

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
                gradedCount: 0
            };
            await window.PlaybookDB.saveSession(sessionData);

            // Grade Each Student
            let totalScore = 0;
            let highestScore = 0;

            for (let i = 0; i < studentExams.length; i++) {
                statusEl.textContent = `AI Grading Student ${i + 1} of ${studentExams.length}...`;
                detailEl.textContent = 'Evaluating responses and generating feedback.';

                // Send all pages of the student's exam to the API
                const pages = studentExams[i];

                const gradingResult = await window.PlaybookAI.analyzeExamWithAI(pages, markingSchemeText);

                const studentData = {
                    id: `${sessionId}-${i}`,
                    sessionId: sessionId,
                    studentName: gradingResult.studentName || `Student ${i+1}`,
                    pages: studentExams[i], // Store images for review
                    grading: gradingResult
                };

                await window.PlaybookDB.saveStudent(studentData);

                // Update Session Stats
                sessionData.gradedCount++;
                totalScore += gradingResult.totalScore;
                if(gradingResult.totalScore > highestScore) highestScore = gradingResult.totalScore;
                await window.PlaybookDB.saveSession(sessionData);
            }

            // Finalize Session
            sessionData.status = 'Pending Review';
            sessionData.averageScore = Math.round(totalScore / studentExams.length);
            sessionData.highestScore = highestScore;
            await window.PlaybookDB.saveSession(sessionData);

            window.location.href = `review.html?session=${sessionId}`;

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
