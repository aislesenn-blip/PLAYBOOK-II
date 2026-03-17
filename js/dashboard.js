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
                totalGraded += session.totalStudents;

                if (session.status === 'Pending Review' || (session.status && session.status.includes('Partial'))) {
                    pendingCount++;
                }

                if (session.averageScore !== undefined) {
                    totalScoreSum += session.averageScore;
                    sessionsWithScore++;
                }

                const tr = document.createElement('tr');

                let badgeClass = 'neutral';
                let statusBadgeColor = 'var(--neutral-text)';

                if (session.status === 'Completed') {
                    badgeClass = '';
                    statusBadgeColor = 'var(--success-text)';
                } else if (session.status === 'Pending Review' || (session.status && session.status.includes('Partial'))) {
                    badgeClass = 'partial';
                    statusBadgeColor = 'var(--partial-text)';
                }

                let actionLink = '-';
                if (session.status === 'Completed') {
                    actionLink = `<a href="analytics.html?session=${session.id}">View Analytics</a>`;
                } else if (session.status === 'Pending Review' || (session.status && session.status.includes('Partial'))) {
                    actionLink = `<a href="review.html?session=${session.id}">Review</a>`;
                }

                tr.innerHTML = `
                    <td style="font-weight: 600;">${session.name}</td>
                    <td>${session.totalStudents}</td>
                    <td>${session.date}</td>
                    <td><span class="score-badge ${badgeClass}" style="color: ${statusBadgeColor};">${session.status}</span></td>
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

});