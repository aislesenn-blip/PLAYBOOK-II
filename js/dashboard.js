document.addEventListener('DOMContentLoaded', async () => {

    const sessionUser = requireAuth(['professor', 'admin']);
    if (!sessionUser) return;

    // Display Name
    const nameDisplay = document.getElementById('prof-name-display');
    if (nameDisplay) {
        nameDisplay.textContent = sessionUser.full_name;
    }

    // Handle Logout
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('playbook_session');
            window.location.href = 'login.html';
        });
    }

    try {
        const sessions = await window.PlaybookDB.getSessions();

        let totalGraded = 0;
        let pendingCount = 0;
        let totalScoreSum = 0;
        let sessionsWithScore = 0;

        const tbody = document.getElementById('sessions-table-body');

        if (sessions.length === 0) {
            // Action-Oriented Empty State
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center" style="padding: 3rem; color: var(--text-secondary);">
                        <p class="mb-1" style="font-size: 1.2rem; font-weight: 600;">No grading sessions yet.</p>
                        <p class="mb-2">Upload your first set of exams and marking scheme to begin.</p>
                        <a href="upload.html" class="btn">Start Your First Session</a>
                    </td>
                </tr>
            `;
        } else {
            sessions.sort((a, b) => Number(b.id) - Number(a.id)); // Sort newest first

            sessions.forEach(session => {
                const totalStudents = session.total_students || 0;
                totalGraded += totalStudents;

                const currentStatus = session.status || 'pending';

                if (currentStatus === 'needs_review' || currentStatus.toLowerCase() === 'pending review' || currentStatus.toLowerCase() === 'pending' || currentStatus.toLowerCase().includes('partial')) {
                    pendingCount++;
                }

                if (session.average_score !== undefined && session.average_score !== null) {
                    totalScoreSum += Number(session.average_score);
                    sessionsWithScore++;
                }

                const tr = document.createElement('tr');

                let badgeClass = 'neutral';
                let statusBadgeColor = 'var(--neutral-text)';

                if (currentStatus === 'completed') {
                    badgeClass = '';
                    statusBadgeColor = 'var(--success-text)';
                } else if (currentStatus === 'needs_review' || currentStatus.toLowerCase() === 'pending review' || currentStatus.toLowerCase() === 'pending' || currentStatus.toLowerCase().includes('partial')) {
                    badgeClass = 'partial';
                    statusBadgeColor = 'var(--partial-text)';
                }

                let actionLink = '-';
                if (currentStatus === 'completed') {
                    actionLink = `<a href="analytics.html?session=${session.id}">View Analytics</a>`;
                } else if (currentStatus === 'needs_review' || currentStatus.toLowerCase() === 'pending review' || currentStatus.toLowerCase() === 'pending' || currentStatus.toLowerCase().includes('partial')) {
                    actionLink = `<a href="review.html?session=${session.id}">Review</a>`;
                }

                const safeSessionName = window.escapeHTML(String(session.name || ''));

                // Supabase returns created_at as an ISO string
                const dateObj = session.created_at ? new Date(session.created_at) : new Date();
                const formattedDate = dateObj.toLocaleDateString();
                const safeSessionDate = window.escapeHTML(formattedDate);

                // Format display status for UI cleanly
                let displayStatus = currentStatus;
                if (displayStatus === 'needs_review' || displayStatus.toLowerCase() === 'pending review' || displayStatus.toLowerCase() === 'pending') {
                    displayStatus = 'Pending Review';
                } else {
                    displayStatus = displayStatus.charAt(0).toUpperCase() + displayStatus.slice(1);
                }
                const safeSessionStatus = window.escapeHTML(String(displayStatus || ''));

                tr.innerHTML = `
                    <td style="font-weight: 600;">${safeSessionName}</td>
                    <td>${totalStudents}</td>
                    <td>${safeSessionDate}</td>
                    <td><span class="score-badge ${badgeClass}" style="color: ${statusBadgeColor};">${safeSessionStatus}</span></td>
                    <td>${actionLink}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        document.getElementById('stat-total-graded').textContent = totalGraded.toLocaleString();
        document.getElementById('stat-pending').textContent = pendingCount.toLocaleString();

        const overallAvg = sessionsWithScore > 0 ? Math.round(totalScoreSum / sessionsWithScore) : 0;
        document.getElementById('stat-avg').textContent = `${overallAvg}%`;

    } catch(err) {
        console.error("Error loading dashboard", err);
    }

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

                // Make sure html2pdf is available. It might not be included on dashboard page.
                if (typeof html2pdf === 'undefined') {
                    // Dynamically load html2pdf if not present
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
                        script.onload = resolve;
                        script.onerror = reject;
                        document.head.appendChild(script);
                    });
                }

                const containerWrapper = document.getElementById('comprehensive-report-container');
                const template = document.getElementById('comprehensive-report-template');
                const contentArea = document.getElementById('cr-content-area');

                // Make the wrapper visible but positioned off-screen to avoid rendering empty heights
                containerWrapper.style.display = 'block';

                // Update cover page
                document.getElementById('cr-date').textContent = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                document.getElementById('cr-total-tests').textContent = sessionData.length;
                document.getElementById('cr-total-submissions').textContent = totalSubmissions;

                // Provide scaleData for grade calculation
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

                const opt = {
                    margin:       [0, 0, 0, 0],
                    filename:     `Playbook_Comprehensive_Report_${new Date().toISOString().split('T')[0]}.pdf`,
                    image:        { type: 'jpeg', quality: 0.98 },
                    html2canvas:  { scale: 2, useCORS: true, logging: false },
                    jsPDF:        { unit: 'px', format: [800, 1000], orientation: 'portrait' }
                };

                // Initialize worker with just the Cover Page (clear out contentArea for this)
                contentArea.innerHTML = '';
                await new Promise(resolve => setTimeout(resolve, 50));
                let worker = html2pdf().set(opt).from(template).toContainer().toCanvas().toPdf();

                // Wait for the first page to be processed in the worker queue
                await new Promise(resolve => setTimeout(resolve, 100));

                // Process each session page by page to avoid huge html2canvas heights
                for (let index = 0; index < sessionData.length; index++) {
                    const { session, submissions } = sessionData[index];

                    // Hide the cover page logic to only render the contentArea parts for subsequent pages
                    document.getElementById('cr-cover-page').style.display = 'none';

                    // Calculate averages
                    let totalScoreSum = 0;
                    let maxScoreSum = 0;
                    submissions.forEach(st => {
                        totalScoreSum += st.grading ? st.grading.totalScore : 0;
                        maxScoreSum += st.grading ? st.grading.maxScore : 100;
                    });
                    const avgPercentage = maxScoreSum > 0 ? ((totalScoreSum / maxScoreSum) * 100).toFixed(1) : 0;

                    // --- 1. Roster Page ---
                    contentArea.innerHTML = '';
                    let sessionHtml = `
                        <div style="height: 1000px; padding-top: 40px; box-sizing: border-box;">
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

                    contentArea.innerHTML = sessionHtml;
                    await new Promise(resolve => setTimeout(resolve, 50));

                    worker = worker.get('pdf').then(pdf => {
                        pdf.addPage();
                        return pdf;
                    }).from(template).toContainer().toCanvas().toPdf();

                    // --- 2. Showcase Page ---
                    if (sortedSubs.length > 0) {
                        const topStudent = sortedSubs[0];
                        const stScore = topStudent.grading ? topStudent.grading.totalScore : 0;
                        const stMax = topStudent.grading ? topStudent.grading.maxScore : 100;

                        contentArea.innerHTML = '';
                        let showcaseHtml = `
                            <div style="height: 1000px; padding-top: 40px; box-sizing: border-box;">
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
                        contentArea.innerHTML = showcaseHtml;
                        await new Promise(resolve => setTimeout(resolve, 50));

                        worker = worker.get('pdf').then(pdf => {
                            pdf.addPage();
                            return pdf;
                        }).from(template).toContainer().toCanvas().toPdf();
                    }
                }

                // Final save
                await worker.save();

                // Restore DOM
                document.getElementById('cr-cover-page').style.display = 'flex';
                contentArea.innerHTML = '';
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

});