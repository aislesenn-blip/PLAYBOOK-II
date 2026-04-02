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

        let awaitingCount = 0;
        let pendingCount = 0;
        let publishedCount = 0;
        // appeals placeholder for now
        let appealsCount = 0;

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

                const currentStatus = session.status || 'pending';
                const publishStatus = session.publish_status || 'draft';

                if (currentStatus === 'pending') {
                    awaitingCount += totalStudents;
                } else if (currentStatus === 'needs_review' || currentStatus.toLowerCase() === 'pending review' || currentStatus.toLowerCase().includes('partial')) {
                    pendingCount += totalStudents;
                } else if (currentStatus === 'completed' && publishStatus === 'published') {
                    publishedCount += totalStudents;
                }

                const tr = document.createElement('tr');

                let badgeClass = 'neutral';
                let statusBadgeColor = 'var(--neutral-text)';
                let displayStatus = currentStatus;

                if (currentStatus === 'completed') {
                    if (publishStatus === 'published') {
                        badgeClass = '';
                        statusBadgeColor = 'var(--success-text)';
                        displayStatus = 'Published';
                    } else {
                        badgeClass = 'partial';
                        statusBadgeColor = 'var(--partial-text)';
                        displayStatus = 'Draft (Completed)';
                    }
                } else if (currentStatus === 'needs_review' || currentStatus.toLowerCase() === 'pending review' || currentStatus.toLowerCase().includes('partial')) {
                    badgeClass = 'partial';
                    statusBadgeColor = 'var(--partial-text)';
                    displayStatus = 'Pending Review';
                } else if (currentStatus === 'pending') {
                    badgeClass = 'neutral';
                    statusBadgeColor = 'var(--neutral-text)';
                    displayStatus = 'Awaiting Grading';
                }

                let actionLink = '-';
                if (currentStatus === 'completed' && publishStatus === 'published') {
                    actionLink = `<a href="analytics.html?session=${session.id}">View Analytics</a>`;
                } else if (currentStatus === 'needs_review' || currentStatus.toLowerCase() === 'pending review' || currentStatus.toLowerCase().includes('partial') || (currentStatus === 'completed' && publishStatus === 'draft')) {
                    actionLink = `<a href="review.html?session=${session.id}">Review</a>`;
                } else if (currentStatus === 'pending') {
                    actionLink = `<a href="review.html?session=${session.id}">Start Grading</a>`;
                }

                const safeSessionName = window.escapeHTML(String(session.name || ''));

                // Supabase returns created_at as an ISO string
                const dateObj = session.created_at ? new Date(session.created_at) : new Date();
                const formattedDate = dateObj.toLocaleDateString();
                const safeSessionDate = window.escapeHTML(formattedDate);

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

        document.getElementById('stat-awaiting').textContent = awaitingCount.toLocaleString();
        document.getElementById('stat-pending').textContent = pendingCount.toLocaleString();
        document.getElementById('stat-published').textContent = publishedCount.toLocaleString();
        document.getElementById('stat-appeals').textContent = appealsCount.toLocaleString();

    } catch(err) {
        console.error("Error loading dashboard", err);
    }

});