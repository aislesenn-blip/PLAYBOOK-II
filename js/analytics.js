document.addEventListener('DOMContentLoaded', async () => {

    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session');

    if (!sessionId) {
        alert("No session provided.");
        window.location.href = 'index.html';
        return;
    }

    let session, students;

    try {
        session = await window.PlaybookDB.getSession(sessionId);
        students = await window.PlaybookDB.getStudentsBySession(sessionId);

        if (!session || !students || students.length === 0) {
            throw new Error("Session or students not found");
        }

        document.getElementById('analytics-title').textContent = `Analytics: ${session.name}`;
        document.getElementById('stat-total').textContent = students.length;
        document.getElementById('stat-avg').textContent = `${session.averageScore || 0}%`;
        document.getElementById('stat-high').textContent = `${session.highestScore || 0}%`;

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
                    const qId = q.questionId !== undefined ? q.questionId : q.questionNumber;
                    const marksAwarded = q.marks_awarded !== undefined ? q.marks_awarded : q.score;
                    const maxMarks = q.max_marks !== undefined ? q.max_marks : q.maxScore;

                    if (!questionScores[qId]) {
                        questionScores[qId] = { total: 0, count: 0, title: q.questionTitle };
                    }
                    questionScores[qId].total += (parseFloat(marksAwarded) / parseFloat(maxMarks));
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
                csv += `"${regNo}","${st.studentName}",${score},${max}\n`;
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

            let grade = 'F';
            let gradeColor = 'var(--error-color)';
            if (percentage >= 90) { grade = 'A'; gradeColor = 'var(--success-color)'; }
            else if (percentage >= 80) { grade = 'B'; gradeColor = 'var(--success-color)'; }
            else if (percentage >= 70) { grade = 'C'; gradeColor = 'var(--highlight-color)'; }
            else if (percentage >= 60) { grade = 'D'; gradeColor = 'var(--highlight-color)'; }

            const regNo = st.registrationNumber || 'Unknown ID';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${regNo}</td>
                <td>${st.studentName}</td>
                <td>${score} / ${max}</td>
                <td><span class="score-badge" style="color: ${gradeColor};">${grade}</span></td>
                <td><a href="#" class="download-feedback-link" data-studentid="${st.id}">Download Feedback</a></td>
            `;
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
        let content = `========================================\n`;
        content += `PLAYBOOK - STUDENT FEEDBACK REPORT\n`;
        content += `========================================\n\n`;
        content += `Session: ${session.name}\n`;
        content += `Student: ${student.studentName}\n`;
        content += `Registration No: ${student.registrationNumber || 'Unknown ID'}\n`;

        const score = student.grading ? student.grading.totalScore : 0;
        const max = student.grading ? student.grading.maxScore : 100;
        content += `Total Score: ${score} / ${max}\n\n`;
        content += `----------------------------------------\n\n`;

        if (student.grading && student.grading.questions) {
            student.grading.questions.forEach(q => {
                const qId = q.questionId !== undefined ? q.questionId : q.questionNumber;
                const marksAwarded = q.marks_awarded !== undefined ? q.marks_awarded : q.score;
                const maxMarks = q.max_marks !== undefined ? q.max_marks : q.maxScore;
                const justification = q.justification !== undefined ? q.justification : q.analysis;
                const constructiveFeedback = q.constructive_feedback !== undefined ? q.constructive_feedback : q.feedback;

                content += `Question ${qId}: ${q.questionTitle}\n`;
                content += `Score: ${marksAwarded} / ${maxMarks}\n\n`;
                content += `Playbook Justification:\n${justification}\n\n`;
                content += `Constructive Feedback:\n${constructiveFeedback}\n\n`;
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
        a.setAttribute('download', `${student.studentName.replace(/\s+/g, '_')}_Feedback.txt`);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

});