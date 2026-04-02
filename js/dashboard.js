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

    // Generate a random 6 character alphanumeric code
    function generateJoinCode() {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    // Handle Class Creation
    const createClassBtn = document.getElementById('create-class-btn');
    if (createClassBtn) {
        createClassBtn.addEventListener('click', async () => {
            const className = prompt("Enter a name for the new class (e.g., 'Biology 101'):");
            if (!className) return;

            const academicYear = prompt("Enter the academic year (e.g., '2025-2026'):");
            if (!academicYear) return;

            const joinCode = generateJoinCode();

            try {
                // Fetch the definitive user ID directly from Supabase auth session
                // This prevents issues if the localStorage session is stale or corrupted
                const { data: authData, error: authErr } = await window.supabaseClient.auth.getUser();
                if (authErr || !authData?.user?.id) {
                    throw new Error("Could not verify Supabase authentication. Please log in again.");
                }

                await window.PlaybookDB.createCourse({
                    professor_id: authData.user.id,
                    name: className,
                    academic_year: academicYear,
                    join_code: joinCode
                });
                alert(`Class created successfully! The student join code is: ${joinCode}`);
                window.location.reload();
            } catch (err) {
                console.error("Failed to create course", err);
                alert("Failed to create class. Ensure the code doesn't already exist.");
            }
        });
    }

    try {
        // Load Courses
        const courses = await window.PlaybookDB.getCourses();
        const classesBody = document.getElementById('classes-table-body');

        if (!courses || courses.length === 0) {
            classesBody.innerHTML = `
                <tr>
                    <td colspan="3" class="text-center" style="padding: 1rem; color: var(--text-secondary);">
                        No classes created yet.
                    </td>
                </tr>
            `;
        } else {
            courses.forEach(course => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-weight: 600;">${window.escapeHTML(course.name)}</td>
                    <td>${window.escapeHTML(course.academic_year || '-')}</td>
                    <td><span class="score-badge" style="font-family: monospace; font-size: 1.1rem; letter-spacing: 2px;">${window.escapeHTML(course.join_code)}</span></td>
                `;
                classesBody.appendChild(tr);
            });
        }

        // Load Sessions
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