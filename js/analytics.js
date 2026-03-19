document.addEventListener('DOMContentLoaded', async () => {

    const sessionUser = requireAuth(['professor', 'admin']);
    if (!sessionUser) return;

    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session');

    let session, students;

    if (!sessionId) {
        // Fallback: If no session ID is provided in URL, try to load the most recent session
        try {
            const allSessions = await window.PlaybookDB.getAllSessions();
            if (allSessions && allSessions.length > 0) {
                // Sort by ID (timestamp) descending to get the newest
                allSessions.sort((a, b) => Number(b.id) - Number(a.id));
                const mostRecentSession = allSessions[0];
                window.location.href = `analytics.html?session=${mostRecentSession.id}`;
                return;
            } else {
                alert("No sessions available to analyze. Please upload and grade exams first.");
                window.location.href = 'index.html';
                return;
            }
        } catch (e) {
            alert("No session provided and failed to load recent sessions.");
            window.location.href = 'index.html';
            return;
        }
    }

    try {
        session = await window.PlaybookDB.getSession(sessionId);
        students = await window.PlaybookDB.getSubmissionsBySession(sessionId);

        if (!session || !students || students.length === 0) {
            throw new Error("Session or students not found");
        }

        document.getElementById('analytics-title').textContent = `Analytics: ${session.name}`;
        document.getElementById('stat-total').textContent = students.length;
        document.getElementById('stat-avg').textContent = `${session.average_score || 0}%`;
        document.getElementById('stat-high').textContent = `${session.highest_score || 0}%`; // Note: highest_score might need to be computed or added to schema

        // Calculate distribution and question performance
        const distribution = {
            '<60': 0, '60-69': 0, '70-79': 0, '80-89': 0, '90+': 0
        };
        const questionScores = {};

        students.forEach(st => {
            const score = st.grading ? st.grading.totalScore : 0;
            const max = st.grading ? st.grading.maxScore : 100;
            const percentage = (score / max) * 100;

            if (percentage >= 90) distribution['90+']++;
            else if (percentage >= 80) distribution['80-89']++;
            else if (percentage >= 70) distribution['70-79']++;
            else if (percentage >= 60) distribution['60-69']++;
            else distribution['<60']++;

            if (st.grading && st.grading.questions) {
                st.grading.questions.forEach(q => {
                    const qId = q.qId !== undefined ? q.qId : q.questionId !== undefined ? q.questionId : q.questionNumber;
                    const marksAwarded = q.score !== undefined ? q.score : q.marks_awarded;
                    const maxMarks = q.max !== undefined ? q.max : q.max_marks !== undefined ? q.max_marks : q.maxScore;
                    const questionTitle = q.title !== undefined ? q.title : q.questionTitle;

                    if (!questionScores[qId]) {
                        questionScores[qId] = { total: 0, count: 0, title: questionTitle };
                    }

                    const parsedAwarded = parseFloat(marksAwarded) || 0;
                    const parsedMax = parseFloat(maxMarks) || 1; // prevent divide by zero

                    questionScores[qId].total += (parsedAwarded / parsedMax);
                    questionScores[qId].count++;
                });
            }
        });

        // Determine lowest performing question
        let lowestQ = '-';
        let lowestAvg = 1.1; // above 1
        for (const [qNum, data] of Object.entries(questionScores)) {
            const avg = data.total / data.count;
            if (avg < lowestAvg) {
                lowestAvg = avg;
                lowestQ = `Q${qNum}`;
            }
        }
        document.getElementById('stat-lowest-q').textContent = lowestQ;

        // Render Chart
        const chartContainer = document.getElementById('chart-container');
        let maxCount = Math.max(...Object.values(distribution));
        if (maxCount === 0) maxCount = 1;

        for (const [label, count] of Object.entries(distribution)) {
            const height = (count / maxCount) * 100;
            chartContainer.innerHTML += `
                <div class="bar" style="height: ${height}%;">
                    <span class="bar-value">${count}</span>
                    <span class="bar-label">${label}</span>
                </div>
            `;
        }

        // Load custom scale for letter grading
        // Update default colors to use semantic CSS variable names
        let scaleData = [
            { min: 90, max: 100, label: 'A', color: 'var(--success-text)' },
            { min: 80, max: 89.9, label: 'B', color: 'var(--success-text)' },
            { min: 70, max: 79.9, label: 'C', color: 'var(--partial-text)' },
            { min: 60, max: 69.9, label: 'D', color: 'var(--neutral-text)' },
            { min: 0, max: 59.9, label: 'F', color: 'var(--neutral-text)' }
        ];

        try {
            const savedScale = await window.PlaybookDB.getSetting('grading_scale');
            if (savedScale && Array.isArray(savedScale.value)) {
                scaleData = savedScale.value;
            }
        } catch(e) {}

        // Render Insights
        const insightsList = document.getElementById('insights-list');
        if (lowestQ !== '-') {
            insightsList.innerHTML = `
                <li class="mb-1"><strong>Area of Concern:</strong> ${lowestQ} had the lowest average score (${Math.round(lowestAvg * 100)}%).</li>
                <li><strong>Actionable Advice:</strong> Consider a brief review session on this topic before the next assignment based on student feedback.</li>
            `;
        } else {
            insightsList.innerHTML = `<li>No insights generated yet.</li>`;
        }

        // Render Student Table
        const tbody = document.getElementById('students-table-body');
        renderTable(students, tbody);

        // Search functionality
        document.getElementById('student-search').addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const filtered = students.filter(st => st.studentName.toLowerCase().includes(term));
            renderTable(filtered, tbody);
        });

        // CSV Download
        document.getElementById('download-csv-btn').addEventListener('click', () => {
            let csv = 'Registration No.,Name,Score,Max Score\n';
            students.forEach(st => {
                const score = st.grading ? st.grading.totalScore : 0;
                const max = st.grading ? st.grading.maxScore : 100;
                const regNo = st.registrationNumber || 'Unknown ID';
                const studentName = st.studentName || 'Unknown Student';
                csv += `"${regNo}","${studentName}",${score},${max}\n`;
            });
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.setAttribute('hidden', '');
            a.setAttribute('href', url);
            a.setAttribute('download', `${session.name.replace(/\s+/g, '_')}_Results.csv`);
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });

        // Download All Feedback
        document.getElementById('download-all-feedback-btn').addEventListener('click', () => {
            let allFeedbackContent = `========================================\n`;
            allFeedbackContent += `PLAYBOOK - MASTER FEEDBACK REPORT\n`;
            allFeedbackContent += `Session: ${session.name}\n`;
            allFeedbackContent += `Total Students: ${students.length}\n`;
            allFeedbackContent += `Average Score: ${session.averageScore || 0}%\n`;
            allFeedbackContent += `========================================\n\n\n`;

            students.forEach((student, index) => {
                const regNo = student.registrationNumber || 'Unknown ID';
                const studentName = student.studentName || 'Unknown Student';

                allFeedbackContent += `[STUDENT ${index + 1} OF ${students.length}]\n`;
                allFeedbackContent += `Student: ${studentName}\n`;
                allFeedbackContent += `Registration No: ${regNo}\n`;

                const score = student.grading ? student.grading.totalScore : 0;
                const max = student.grading ? student.grading.maxScore : 100;
                allFeedbackContent += `Total Score: ${score} / ${max}\n\n`;

                if (student.grading && student.grading.questions) {
                    student.grading.questions.forEach(q => {
                        const qId = q.qId !== undefined ? q.qId : q.questionId !== undefined ? q.questionId : q.questionNumber;
                        const marksAwarded = q.score !== undefined ? q.score : q.marks_awarded;
                        const maxMarks = q.max !== undefined ? q.max : q.max_marks !== undefined ? q.max_marks : q.maxScore;
                        const questionTitle = q.title !== undefined ? q.title : q.questionTitle;
                        const constructiveFeedback = q.feedback !== undefined ? q.feedback : q.constructive_feedback || "No actionable feedback provided.";

                        allFeedbackContent += `Question ${qId}: ${questionTitle}\n`;
                        allFeedbackContent += `Score: ${marksAwarded} / ${maxMarks}\n`;
                        allFeedbackContent += `Feedback:\n${constructiveFeedback}\n\n`;
                    });
                } else {
                    allFeedbackContent += `No detailed grading data available.\n\n`;
                }

                allFeedbackContent += `--------------------------------------------------\n\n\n`;
            });

            const blob = new Blob([allFeedbackContent], { type: 'text/plain' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.setAttribute('hidden', '');
            a.setAttribute('href', url);
            a.setAttribute('download', `${session.name.replace(/\s+/g, '_')}_Master_Feedback.txt`);
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });

    } catch (e) {
        console.error(e);
        alert("Failed to load analytics data.");
    }

    function renderTable(data, tbody) {
        tbody.innerHTML = '';
        data.forEach((st, idx) => {
            const score = st.grading ? st.grading.totalScore : 0;
            const max = st.grading ? st.grading.maxScore : 100;
            const percentage = (score / max) * 100;

            let grade = '?';
            let gradeColor = 'var(--text-primary)';
            let badgeClass = 'neutral';

            // Apply custom scale logic
            for (let i = 0; i < scaleData.length; i++) {
                if (percentage >= scaleData[i].min && percentage <= scaleData[i].max) {
                    grade = scaleData[i].label;
                    gradeColor = scaleData[i].color || gradeColor;

                    if (percentage >= 80) badgeClass = ''; // uses default success styling
                    else if (percentage >= 70) badgeClass = 'partial';

                    break;
                }
            }

            const regNo = st.registrationNumber || 'Unknown ID';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="reg-no-cell"></td>
                <td class="student-name-cell"></td>
                <td>${score} / ${max}</td>
                <td><span class="score-badge ${badgeClass}" style="color: ${gradeColor};">${grade}</span></td>
                <td><a href="#" class="download-feedback-link" data-studentid="${st.id}">Download Feedback</a></td>
            `;
            tr.querySelector('.reg-no-cell').textContent = regNo;
            tr.querySelector('.student-name-cell').textContent = st.studentName;
            tbody.appendChild(tr);
        });

        // Attach event listeners to the newly created links
        const feedbackLinks = tbody.querySelectorAll('.download-feedback-link');
        feedbackLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const studentId = e.target.getAttribute('data-studentid');
                const student = data.find(s => s.id === studentId);
                if (student) {
                    downloadStudentFeedback(student, session);
                }
            });
        });
    }

    function downloadStudentFeedback(student, session) {
        const regNo = student.registrationNumber || 'Unknown ID';
        const studentName = student.studentName || 'Unknown Student';

        let content = `========================================\n`;
        content += `PLAYBOOK - STUDENT FEEDBACK REPORT\n`;
        content += `========================================\n\n`;
        content += `Session: ${session.name}\n`;
        content += `Student: ${studentName}\n`;
        content += `Registration No: ${regNo}\n`;

        const score = student.grading ? student.grading.totalScore : 0;
        const max = student.grading ? student.grading.maxScore : 100;
        content += `Total Score: ${score} / ${max}\n\n`;
        content += `----------------------------------------\n\n`;

        if (student.grading && student.grading.questions) {
            student.grading.questions.forEach(q => {
                const qId = q.qId !== undefined ? q.qId : q.questionId !== undefined ? q.questionId : q.questionNumber;
                const marksAwarded = q.score !== undefined ? q.score : q.marks_awarded;
                const maxMarks = q.max !== undefined ? q.max : q.max_marks !== undefined ? q.max_marks : q.maxScore;
                const questionTitle = q.title !== undefined ? q.title : q.questionTitle;
                const constructiveFeedback = q.feedback !== undefined ? q.feedback : q.constructive_feedback || "No actionable feedback provided.";

                content += `Question ${qId}: ${questionTitle}\n`;
                content += `Score: ${marksAwarded} / ${maxMarks}\n\n`;
                content += `Feedback:\n${constructiveFeedback}\n\n`;
                content += `----------------------------------------\n\n`;
            });
        } else {
            content += `No detailed grading data available.\n`;
        }

        const blob = new Blob([content], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.setAttribute('hidden', '');
        a.setAttribute('href', url);
        a.setAttribute('download', `${studentName.replace(/\s+/g, '_')}_Feedback.txt`);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

});