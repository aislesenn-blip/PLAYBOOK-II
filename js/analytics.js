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

    // Load custom scale for letter grading (Moved outside try block for scope access by renderTable)
    // Update default colors to use semantic CSS variable names
    let scaleData = [
        { min: 90, max: 100, label: 'A', color: 'var(--success-text)' },
        { min: 80, max: 89.9, label: 'B', color: 'var(--success-text)' },
        { min: 70, max: 79.9, label: 'C', color: 'var(--partial-text)' },
        { min: 60, max: 69.9, label: 'D', color: 'var(--neutral-text)' },
        { min: 0, max: 59.9, label: 'F', color: 'var(--neutral-text)' }
    ];

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

        // Comprehensive Report
        const compReportBtn = document.getElementById('download-comprehensive-report-btn');
        if (compReportBtn) {
            compReportBtn.addEventListener('click', async (e) => {
                const btn = e.target;
                const originalText = btn.textContent;
                btn.disabled = true;

                const loadingOverlay = document.getElementById('loading-overlay');
                const loadingStatus = document.getElementById('loading-status');
                if (loadingOverlay && loadingStatus) {
                    loadingStatus.textContent = "Generating Comprehensive Report...";
                    loadingOverlay.classList.add('active');
                }

                try {
                    const allSessions = await window.PlaybookDB.getSessions();
                    if (!allSessions || allSessions.length === 0) {
                        alert("No sessions available for report.");
                        return;
                    }

                    // Sort sessions newest first
                    allSessions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

                    let totalSubmissions = 0;
                    const sessionData = [];

                    // Fetch submissions for all sessions
                    for (const s of allSessions) {
                        const subs = await window.PlaybookDB.getSubmissionsBySession(s.id);
                        if (subs && subs.length > 0) {
                            totalSubmissions += subs.length;
                            sessionData.push({ session: s, submissions: subs });
                        }
                    }

                    if (sessionData.length === 0) {
                        alert("No submissions found across any sessions.");
                        return;
                    }

                    const containerWrapper = document.getElementById('comprehensive-report-container');
                    const template = document.getElementById('comprehensive-report-template');
                    const contentArea = document.getElementById('cr-content-area');

                    // Reset content area
                    contentArea.innerHTML = '';

                    // Update cover page
                    document.getElementById('cr-date').textContent = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                    document.getElementById('cr-total-tests').textContent = sessionData.length;
                    document.getElementById('cr-total-submissions').textContent = totalSubmissions;

                    // Generate Session Pages
                    sessionData.forEach((data, index) => {
                        const { session, submissions } = data;

                        // Calculate averages
                        let totalScoreSum = 0;
                        let maxScoreSum = 0;
                        submissions.forEach(st => {
                            totalScoreSum += st.grading ? st.grading.totalScore : 0;
                            maxScoreSum += st.grading ? st.grading.maxScore : 100;
                        });
                        const avgPercentage = maxScoreSum > 0 ? ((totalScoreSum / maxScoreSum) * 100).toFixed(1) : 0;

                        // Roster HTML
                        let sessionHtml = `
                            <div style="page-break-before: always; min-height: 1000px; padding-top: 40px; box-sizing: border-box;">
                                <div style="border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 30px;">
                                    <div style="font-size: 14px; font-weight: 600; color: #3b82f6; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Test ${sessionData.length - index}</div>
                                    <h2 style="margin: 0; font-size: 32px; font-weight: 700; color: #0f172a;">${session.name}</h2>
                                    <div style="display: flex; gap: 20px; margin-top: 15px; color: #64748b; font-size: 16px;">
                                        <span><strong>${submissions.length}</strong> Students</span>
                                        <span><strong>${avgPercentage}%</strong> Average</span>
                                    </div>
                                </div>

                                <h3 style="font-size: 20px; color: #1e293b; margin-bottom: 15px;">Student Roster & Marks</h3>
                                <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                                    <thead>
                                        <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
                                            <th style="padding: 12px; text-align: left; color: #64748b; font-weight: 600;">Reg No.</th>
                                            <th style="padding: 12px; text-align: left; color: #64748b; font-weight: 600;">Name</th>
                                            <th style="padding: 12px; text-align: right; color: #64748b; font-weight: 600;">Score</th>
                                            <th style="padding: 12px; text-align: center; color: #64748b; font-weight: 600;">Grade</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                        `;

                        // Sort submissions by score descending
                        const sortedSubs = [...submissions].sort((a, b) => {
                            const aPerc = a.grading ? (a.grading.totalScore / a.grading.maxScore) : 0;
                            const bPerc = b.grading ? (b.grading.totalScore / b.grading.maxScore) : 0;
                            return bPerc - aPerc;
                        });

                        sortedSubs.forEach((st, i) => {
                            const score = st.grading ? st.grading.totalScore : 0;
                            const max = st.grading ? st.grading.maxScore : 100;
                            const percentage = (score / max) * 100;

                            let grade = '?';
                            let gradeBg = '#f1f5f9';
                            let gradeColor = '#64748b';

                            for (let i = 0; i < scaleData.length; i++) {
                                if (percentage >= scaleData[i].min && percentage <= scaleData[i].max) {
                                    grade = scaleData[i].label;
                                    if (percentage >= 80) { gradeBg = '#dcfce7'; gradeColor = '#166534'; }
                                    else if (percentage >= 70) { gradeBg = '#fef9c3'; gradeColor = '#854d0e'; }
                                    else { gradeBg = '#fee2e2'; gradeColor = '#991b1b'; }
                                    break;
                                }
                            }

                            sessionHtml += `
                                <tr style="border-bottom: 1px solid #e2e8f0; page-break-inside: avoid;">
                                    <td style="padding: 12px; color: #475569;">${st.registrationNumber || '-'}</td>
                                    <td style="padding: 12px; font-weight: 500; color: #0f172a;">${st.studentName || 'Unknown'}</td>
                                    <td style="padding: 12px; text-align: right; color: #475569;">${score} / ${max}</td>
                                    <td style="padding: 12px; text-align: center;">
                                        <span style="background: ${gradeBg}; color: ${gradeColor}; padding: 4px 12px; border-radius: 9999px; font-weight: 600; font-size: 12px;">${grade}</span>
                                    </td>
                                </tr>
                            `;
                        });

                        sessionHtml += `
                                    </tbody>
                                </table>
                            </div>
                        `;

                        contentArea.innerHTML += sessionHtml;

                        // Student Showcase (Top 1 from this session if available)
                        if (sortedSubs.length > 0) {
                            const topStudent = sortedSubs[0];
                            const stScore = topStudent.grading ? topStudent.grading.totalScore : 0;
                            const stMax = topStudent.grading ? topStudent.grading.maxScore : 100;

                            let showcaseHtml = `
                                <div style="page-break-before: always; min-height: 1000px; padding-top: 40px; box-sizing: border-box;">
                                    <div style="border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 30px;">
                                        <div style="font-size: 14px; font-weight: 600; color: #8b5cf6; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Student Showcase</div>
                                        <h2 style="margin: 0; font-size: 28px; font-weight: 700; color: #0f172a;">${topStudent.studentName}</h2>
                                        <div style="display: flex; gap: 20px; margin-top: 10px; color: #64748b;">
                                            <span>Test: ${session.name}</span>
                                            <span>Score: <strong>${stScore}/${stMax}</strong></span>
                                        </div>
                                    </div>
                                    <h3 style="font-size: 18px; color: #1e293b; margin-bottom: 20px;">Personalized Feedback Sample</h3>
                                    <div style="display: flex; flex-direction: column; gap: 20px;">
                            `;

                            if (topStudent.grading && topStudent.grading.questions) {
                                // Take top 3 questions to fit on page
                                const qsToDisplay = topStudent.grading.questions.slice(0, 3);
                                qsToDisplay.forEach(q => {
                                    const qId = q.qId !== undefined ? q.qId : q.questionId !== undefined ? q.questionId : q.questionNumber;
                                    const marksAwarded = q.score !== undefined ? q.score : q.marks_awarded;
                                    const maxMarks = q.max !== undefined ? q.max : q.max_marks !== undefined ? q.max_marks : q.maxScore || 1;
                                    const title = q.title !== undefined ? q.title : q.questionTitle;
                                    const feedback = q.feedback !== undefined ? q.feedback : q.constructive_feedback || "No actionable feedback provided.";

                                    showcaseHtml += `
                                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1); page-break-inside: avoid;">
                                            <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                                                <h4 style="margin: 0; font-size: 16px; color: #0f172a;">Q${qId}: ${title}</h4>
                                                <div style="font-weight: 600; color: #3b82f6;">${marksAwarded}/${maxMarks}</div>
                                            </div>
                                            <div style="font-size: 14px; color: #475569; line-height: 1.5; white-space: pre-wrap;">${window.escapeHTML ? window.escapeHTML(feedback) : feedback}</div>
                                        </div>
                                    `;
                                });
                            }

                            showcaseHtml += `
                                    </div>
                                </div>
                            `;
                            contentArea.innerHTML += showcaseHtml;
                        }
                    });

                    containerWrapper.style.display = 'block';

                    // Allow browser to render
                    await new Promise(resolve => setTimeout(resolve, 200));

                    const opt = {
                        margin:       [0, 0, 0, 0],
                        filename:     `Playbook_Comprehensive_Report_${new Date().toISOString().split('T')[0]}.pdf`,
                        image:        { type: 'jpeg', quality: 0.98 },
                        html2canvas:  { scale: 2, useCORS: true, logging: false },
                        jsPDF:        { unit: 'px', format: [800, 1000], orientation: 'portrait' }
                    };

                    await html2pdf().set(opt).from(template).save();

                    containerWrapper.style.display = 'none';

                } catch (error) {
                    console.error("Failed to generate comprehensive report:", error);
                    alert("Failed to generate report. Please try again.");
                } finally {
                    if (loadingOverlay) loadingOverlay.classList.remove('active');
                    btn.textContent = originalText;
                    btn.disabled = false;
                }
            });
        }

        // Download All Feedback
        document.getElementById('download-all-feedback-btn').addEventListener('click', async (e) => {
            const btn = e.target;
            const originalText = btn.textContent;
            btn.disabled = true;

            const loadingOverlay = document.getElementById('loading-overlay');
            const loadingStatus = document.getElementById('loading-status');
            if (loadingOverlay && loadingStatus) {
                loadingStatus.textContent = "Generating Master PDF...";
                loadingOverlay.classList.add('active');
            }

            try {
                // html2canvas struggles to render excessively long vertical pages (>10,000px).
                // Creating one massive HTML string of all students exceeds browser canvas limits,
                // resulting in a PDF filled with completely blank pages.
                // We fix this by iterating students individually, rendering them onto the DOM,
                // and chaining html2pdf workers to add new pages explicitly.
                const containerWrapper = document.getElementById('pdf-template-container');
                const template = document.getElementById('pdf-template');
                const originalTemplateHTML = template.innerHTML;

                containerWrapper.style.display = 'block';

                const opt = {
                    margin:       [10, 10, 10, 10],
                    filename:     `${session.name.replace(/\s+/g, '_')}_Master_Feedback.pdf`,
                    image:        { type: 'jpeg', quality: 0.98 },
                    html2canvas:  { scale: 2, useCORS: true, logging: false },
                    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
                };

                let worker = html2pdf().set(opt);

                for (let index = 0; index < students.length; index++) {
                    const student = students[index];
                    const regNo = student.registrationNumber || 'Unknown ID';
                    const studentName = student.studentName || 'Unknown Student';
                    const score = student.grading ? student.grading.totalScore : 0;
                    const max = student.grading ? student.grading.maxScore : 100;
                    const percentage = (score / max) * 100;

                    let grade = '?';
                    for (let i = 0; i < scaleData.length; i++) {
                        if (percentage >= scaleData[i].min && percentage <= scaleData[i].max) {
                            grade = scaleData[i].label;
                            break;
                        }
                    }

                    // Populate header
                    document.getElementById('pdf-student-name').textContent = studentName;
                    document.getElementById('pdf-reg-no').textContent = `Registration No: ${regNo}`;
                    document.getElementById('pdf-session-name').textContent = session.name;
                    document.getElementById('pdf-total-score').textContent = `${score} / ${max}`;
                    document.getElementById('pdf-grade').textContent = grade;

                    // Populate questions
                    const container = document.getElementById('pdf-questions-container');
                    container.innerHTML = '';

                    if (student.grading && student.grading.questions) {
                        student.grading.questions.forEach(q => {
                            const qId = q.qId !== undefined ? q.qId : q.questionId !== undefined ? q.questionId : q.questionNumber;
                            const marksAwarded = q.score !== undefined ? q.score : q.marks_awarded;
                            const maxMarks = q.max !== undefined ? q.max : q.max_marks !== undefined ? q.max_marks : q.maxScore;
                            const questionTitle = q.title !== undefined ? q.title : q.questionTitle;
                            const justification = q.justification !== undefined ? q.justification : q.analysis;
                            const constructiveFeedback = q.feedback !== undefined ? q.feedback : q.constructive_feedback || "No actionable feedback provided.";

                            const qEl = document.createElement('div');
                            qEl.style.cssText = 'border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; page-break-inside: avoid;';

                            let qHtml = `
                                <div style="background: #f8fafc; padding: 16px 20px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
                                    <h3 style="margin: 0; font-size: 16px; color: #0f172a;">Question ${qId}: <span style="font-weight: 400; color: #64748b;">${questionTitle}</span></h3>
                                    <div style="font-weight: 600; font-size: 16px; color: #0f172a;">${marksAwarded} / ${maxMarks}</div>
                                </div>
                                <div style="padding: 20px;">
                            `;

                            if (justification) {
                                qHtml += `
                                    <div style="margin-bottom: 16px;">
                                        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em; margin-bottom: 8px;">Playbook Justification</div>
                                        <div style="color: #475569; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; padding-left: 12px; border-left: 2px solid #cbd5e1;">${window.escapeHTML(justification)}</div>
                                    </div>
                                `;
                            }

                            qHtml += `
                                    <div>
                                        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em; margin-bottom: 8px;">Constructive Feedback</div>
                                        <div style="color: #0f172a; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word;">${window.escapeHTML(constructiveFeedback)}</div>
                                    </div>
                                </div>
                            `;

                            qEl.innerHTML = qHtml;
                            container.appendChild(qEl);
                        });
                    }

                    // Allow browser to render DOM changes before capturing
                    await new Promise(resolve => setTimeout(resolve, 50));

                    if (index === 0) {
                        // First page is generated automatically by toPdf()
                        worker = worker.from(template).toContainer().toCanvas().toPdf();
                    } else {
                        // For subsequent students, we first add a new page to the pdf
                        worker = worker.get('pdf').then(pdf => {
                            pdf.addPage();
                            return pdf;
                        }).from(template).toContainer().toCanvas().toPdf();
                    }
                }

                // Final save
                await worker.save();

                // Restore
                containerWrapper.style.display = 'none';
                template.innerHTML = originalTemplateHTML;

            } catch (error) {
                console.error("Failed to generate master PDF:", error);
                alert("Failed to generate master PDF. Please try again.");
            } finally {
                if (loadingOverlay) loadingOverlay.classList.remove('active');
                btn.textContent = originalText;
                btn.disabled = false;
            }
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
                <td>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-secondary btn-sm view-feedback-btn" data-studentid="${st.id}">View Feedback</button>
                        <button class="btn btn-sm download-feedback-btn" data-studentid="${st.id}">Download PDF</button>
                    </div>
                </td>
            `;
            tr.querySelector('.reg-no-cell').textContent = regNo;
            tr.querySelector('.student-name-cell').textContent = st.studentName;
            tbody.appendChild(tr);
        });

        // Attach event listeners to the newly created links
        const viewLinks = tbody.querySelectorAll('.view-feedback-btn');
        viewLinks.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const studentId = e.target.getAttribute('data-studentid');
                const student = data.find(s => s.id === studentId);
                if (student) {
                    viewStudentFeedback(student, session);
                }
            });
        });

        const downloadLinks = tbody.querySelectorAll('.download-feedback-btn');
        downloadLinks.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const studentId = e.target.getAttribute('data-studentid');
                const student = data.find(s => s.id === studentId);
                if (student) {
                    // Update button to show loading state
                    const originalText = e.target.textContent;
                    e.target.disabled = true;

                    const loadingOverlay = document.getElementById('loading-overlay');
                    const loadingStatus = document.getElementById('loading-status');
                    if (loadingOverlay && loadingStatus) {
                        loadingStatus.textContent = "Generating PDF...";
                        loadingOverlay.classList.add('active');
                    }

                    try {
                        await downloadStudentFeedbackPDF(student, session);
                    } catch (error) {
                        console.error('PDF Generation failed:', error);
                        alert('Failed to generate PDF. Please try again.');
                    } finally {
                        if (loadingOverlay) loadingOverlay.classList.remove('active');
                        e.target.textContent = originalText;
                        e.target.disabled = false;
                    }
                }
            });
        });
    }

    // --- Drawer Logic ---
    const drawerOverlay = document.getElementById('feedback-drawer-overlay');
    const drawer = document.getElementById('feedback-drawer');
    const closeBtn = document.getElementById('close-drawer-btn');

    function closeDrawer() {
        drawer.style.right = '-600px';
        drawerOverlay.style.opacity = '0';
        setTimeout(() => {
            drawerOverlay.style.display = 'none';
        }, 300);
    }

    closeBtn.addEventListener('click', closeDrawer);
    drawerOverlay.addEventListener('click', (e) => {
        if (e.target === drawerOverlay) closeDrawer();
    });

    function viewStudentFeedback(student, session) {
        const drawerContent = document.getElementById('feedback-drawer-content');
        const regNo = student.registrationNumber || 'Unknown ID';
        const studentName = student.studentName || 'Unknown Student';
        const score = student.grading ? student.grading.totalScore : 0;
        const max = student.grading ? student.grading.maxScore : 100;
        const percentage = (score / max) * 100;

        let grade = '?';
        for (let i = 0; i < scaleData.length; i++) {
            if (percentage >= scaleData[i].min && percentage <= scaleData[i].max) {
                grade = scaleData[i].label;
                break;
            }
        }

        let html = `
            <div style="margin-bottom: 2rem; border-bottom: 1px solid var(--border-color); padding-bottom: 1rem;">
                <h2 style="font-size: 1.5rem; color: var(--text-primary); margin-bottom: 0.25rem;">${studentName}</h2>
                <p style="color: var(--text-secondary); margin-bottom: 1rem;">Reg No: ${regNo}</p>
                <div style="display: flex; gap: 1rem; margin-bottom: 1rem;">
                    <div style="background: var(--bg-secondary); padding: 1rem; border-radius: var(--radius-md); flex: 1;">
                        <div style="font-size: 0.8rem; text-transform: uppercase; color: var(--text-secondary); letter-spacing: 0.05em; margin-bottom: 0.5rem;">Score</div>
                        <div style="font-size: 1.5rem; font-weight: 600;">${score} <span style="font-size: 1rem; color: var(--text-secondary); font-weight: 400;">/ ${max}</span></div>
                    </div>
                    <div style="background: var(--bg-secondary); padding: 1rem; border-radius: var(--radius-md); flex: 1;">
                        <div style="font-size: 0.8rem; text-transform: uppercase; color: var(--text-secondary); letter-spacing: 0.05em; margin-bottom: 0.5rem;">Grade</div>
                        <div style="font-size: 1.5rem; font-weight: 600;">${grade}</div>
                    </div>
                </div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 1.5rem;">
        `;

        if (student.grading && student.grading.questions && student.grading.questions.length > 0) {
            student.grading.questions.forEach(q => {
                const qId = q.qId !== undefined ? q.qId : q.questionId !== undefined ? q.questionId : q.questionNumber;
                const marksAwarded = q.score !== undefined ? q.score : q.marks_awarded;
                const maxMarks = q.max !== undefined ? q.max : q.max_marks !== undefined ? q.max_marks : q.maxScore;
                const questionTitle = q.title !== undefined ? q.title : q.questionTitle;
                const justification = q.justification !== undefined ? q.justification : q.analysis;
                const constructiveFeedback = q.feedback !== undefined ? q.feedback : q.constructive_feedback || "No actionable feedback provided.";

                // Calculate color indicator based on performance
                const qPercent = marksAwarded / maxMarks;
                let qColor = '#22c55e'; // Green
                let qBg = '#dcfce7';
                if (qPercent < 0.5) {
                    qColor = '#ef4444'; // Red
                    qBg = '#fee2e2';
                } else if (qPercent < 0.8) {
                    qColor = '#eab308'; // Yellow
                    qBg = '#fef9c3';
                }

                html += `
                    <div style="border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow: hidden;">
                        <div style="background: var(--bg-secondary); padding: 1rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color);">
                            <h4 style="margin: 0; font-size: 1rem; color: var(--text-primary);">Question ${qId}: <span style="font-weight: 400; color: var(--text-secondary);">${questionTitle}</span></h4>
                            <div style="background: ${qBg}; color: ${qColor}; padding: 0.25rem 0.75rem; border-radius: 9999px; font-weight: 600; font-size: 0.9rem;">
                                ${marksAwarded} / ${maxMarks}
                            </div>
                        </div>
                        <div style="padding: 1rem;">
                            ${justification ? `
                            <div style="margin-bottom: 1rem;">
                                <div style="font-size: 0.8rem; text-transform: uppercase; color: var(--text-secondary); letter-spacing: 0.05em; margin-bottom: 0.5rem; font-weight: 600;">Playbook Logic</div>
                                <div style="color: var(--text-secondary); font-size: 0.95rem; line-height: 1.5; white-space: pre-wrap; padding-left: 0.75rem; border-left: 2px solid #e2e8f0;">${window.escapeHTML(justification)}</div>
                            </div>
                            ` : ''}
                            <div>
                                <div style="font-size: 0.8rem; text-transform: uppercase; color: var(--text-secondary); letter-spacing: 0.05em; margin-bottom: 0.5rem; font-weight: 600;">Feedback</div>
                                <div style="color: var(--text-primary); font-size: 0.95rem; line-height: 1.5; white-space: pre-wrap;">${window.escapeHTML(constructiveFeedback)}</div>
                            </div>
                        </div>
                    </div>
                `;
            });
        } else {
            html += `<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">No detailed grading data available.</p>`;
        }

        html += `</div>`;
        drawerContent.innerHTML = html;

        // Open Drawer
        drawerOverlay.style.display = 'block';
        // Trigger reflow
        drawerOverlay.offsetHeight;
        drawerOverlay.style.opacity = '1';
        drawer.style.right = '0';
    }


    async function downloadStudentFeedbackPDF(student, session) {
        // Use the hidden template
        const template = document.getElementById('pdf-template');

        const regNo = student.registrationNumber || 'Unknown ID';
        const studentName = student.studentName || 'Unknown Student';
        const score = student.grading ? student.grading.totalScore : 0;
        const max = student.grading ? student.grading.maxScore : 100;
        const percentage = (score / max) * 100;

        let grade = '?';
        for (let i = 0; i < scaleData.length; i++) {
            if (percentage >= scaleData[i].min && percentage <= scaleData[i].max) {
                grade = scaleData[i].label;
                break;
            }
        }

        // Populate header
        document.getElementById('pdf-student-name').textContent = studentName;
        document.getElementById('pdf-reg-no').textContent = `Registration No: ${regNo}`;
        document.getElementById('pdf-session-name').textContent = session.name;
        document.getElementById('pdf-total-score').textContent = `${score} / ${max}`;
        document.getElementById('pdf-grade').textContent = grade;

        // Populate questions
        const container = document.getElementById('pdf-questions-container');
        container.innerHTML = '';

        if (student.grading && student.grading.questions) {
            student.grading.questions.forEach(q => {
                const qId = q.qId !== undefined ? q.qId : q.questionId !== undefined ? q.questionId : q.questionNumber;
                const marksAwarded = q.score !== undefined ? q.score : q.marks_awarded;
                const maxMarks = q.max !== undefined ? q.max : q.max_marks !== undefined ? q.max_marks : q.maxScore;
                const questionTitle = q.title !== undefined ? q.title : q.questionTitle;
                const justification = q.justification !== undefined ? q.justification : q.analysis;
                const constructiveFeedback = q.feedback !== undefined ? q.feedback : q.constructive_feedback || "No actionable feedback provided.";

                const qEl = document.createElement('div');
                qEl.style.cssText = 'border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; page-break-inside: avoid;';

                let qHtml = `
                    <div style="background: #f8fafc; padding: 16px 20px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; font-size: 16px; color: #0f172a;">Question ${qId}: <span style="font-weight: 400; color: #64748b;">${questionTitle}</span></h3>
                        <div style="font-weight: 600; font-size: 16px; color: #0f172a;">${marksAwarded} / ${maxMarks}</div>
                    </div>
                    <div style="padding: 20px;">
                `;

                if (justification) {
                    qHtml += `
                        <div style="margin-bottom: 16px;">
                            <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em; margin-bottom: 8px;">Playbook Justification</div>
                            <div style="color: #475569; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; padding-left: 12px; border-left: 2px solid #cbd5e1;">${window.escapeHTML(justification)}</div>
                        </div>
                    `;
                }

                qHtml += `
                        <div>
                            <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em; margin-bottom: 8px;">Constructive Feedback</div>
                            <div style="color: #0f172a; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word;">${window.escapeHTML(constructiveFeedback)}</div>
                        </div>
                    </div>
                `;

                qEl.innerHTML = qHtml;
                container.appendChild(qEl);
            });
        }

        // Temporarily display template for html2pdf to read it
        const containerWrapper = document.getElementById('pdf-template-container');
        containerWrapper.style.display = 'block';

        // Allow browser to render the DOM changes before capturing to prevent blank pages
        await new Promise(resolve => setTimeout(resolve, 150));

        const opt = {
            margin:       [10, 10, 10, 10], // mm
            filename:     `${studentName.replace(/\s+/g, '_')}_Feedback.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true, logging: false },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        await html2pdf().set(opt).from(template).save();

        containerWrapper.style.display = 'none';
    }

    function downloadStudentFeedbackText(student, session) {
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
                const justification = q.justification !== undefined ? q.justification : q.analysis;
                const constructiveFeedback = q.feedback !== undefined ? q.feedback : q.constructive_feedback || "No actionable feedback provided.";

                content += `Question ${qId}: ${questionTitle}\n`;
                content += `Score: ${marksAwarded} / ${maxMarks}\n\n`;
                if (justification) {
                    content += `Playbook Justification:\n${justification}\n\n`;
                }
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
        a.setAttribute('download', `${studentName.replace(/\s+/g, '_')}_Feedback.txt`);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

});