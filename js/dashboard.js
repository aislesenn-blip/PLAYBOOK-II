document.addEventListener('DOMContentLoaded', async () => {

    try {
        const sessions = await window.PlaybookDB.getSessions();

        let totalGraded = 0;
        let pendingCount = 0;
        let totalScoreSum = 0;
        let sessionsWithScore = 0;

        const tbody = document.getElementById('sessions-table-body');

        if (sessions.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="color: var(--text-secondary);">No sessions found. Upload exams to get started.</td></tr>`;
        } else {
            sessions.sort((a, b) => Number(b.id) - Number(a.id)); // Sort newest first

            sessions.forEach(session => {
                totalGraded += session.totalStudents;

                if (session.status === 'Pending Review') {
                    pendingCount++;
                }

                if (session.averageScore !== undefined) {
                    totalScoreSum += session.averageScore;
                    sessionsWithScore++;
                }

                const tr = document.createElement('tr');

                let statusBadgeColor = 'var(--text-secondary)';
                if (session.status === 'Completed') statusBadgeColor = 'var(--success-color)';
                else if (session.status === 'Pending Review') statusBadgeColor = 'var(--highlight-color)';

                let actionLink = '-';
                if (session.status === 'Completed') {
                    actionLink = `<a href="analytics.html?session=${session.id}">View Analytics</a>`;
                } else if (session.status === 'Pending Review') {
                    actionLink = `<a href="review.html?session=${session.id}">Review</a>`;
                }

                tr.innerHTML = `
                    <td style="font-weight: 500;">${session.name}</td>
                    <td>${session.totalStudents}</td>
                    <td>${session.date}</td>
                    <td><span class="score-badge" style="color: ${statusBadgeColor};">${session.status}</span></td>
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

    // Handle API Key Form
    const keyInput = document.getElementById('api-key-input');
    const saveBtn = document.getElementById('save-key-btn');

    // Load existing key
    const existingKey = localStorage.getItem('PLAYBOOK_API_KEY');
    if (existingKey) {
        keyInput.value = existingKey;
    }

    saveBtn.addEventListener('click', () => {
        const val = keyInput.value.trim();
        if (val) {
            localStorage.setItem('PLAYBOOK_API_KEY', val);
            alert('API Key saved successfully.');
        } else {
            localStorage.removeItem('PLAYBOOK_API_KEY');
            alert('API Key removed.');
        }
    });

});