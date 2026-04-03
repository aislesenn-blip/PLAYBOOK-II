document.addEventListener('DOMContentLoaded', async () => {
    const sessionUser = requireAuth(['professor', 'admin']);
    if (!sessionUser) return;

    // Handle Logout
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('playbook_session');
            window.location.href = 'login.html';
        });
    }

    const urlParams = new URLSearchParams(window.location.search);
    const courseId = urlParams.get('id');

    if (!courseId) {
        alert("No class specified.");
        window.location.href = 'index.html';
        return;
    }

    // Set new assessment button link
    const newAssessmentBtn = document.getElementById('new-assessment-btn');
    if (newAssessmentBtn) {
        // We could pass the courseId to upload.html to auto-select it, but for now just link
        newAssessmentBtn.href = `upload.html?course_id=${courseId}`;
    }

    try {
        // Fetch class data
        const course = await window.PlaybookDB.getCourse(courseId);
        if (!course) throw new Error("Course not found");

        document.getElementById('class-title').textContent = window.escapeHTML(course.name);
        document.getElementById('class-year').textContent = window.escapeHTML(course.academic_year || '-');
        document.getElementById('class-join-code').textContent = window.escapeHTML(course.join_code);

        // Fetch students
        const enrollments = await window.PlaybookDB.getEnrolledStudents(courseId);
        const students = enrollments.map(e => e.student).filter(s => s); // Extract student data, filter nulls

        document.getElementById('stat-students-count').textContent = students.length;

        const studentsTbody = document.getElementById('students-table-body');
        if (students.length === 0) {
            studentsTbody.innerHTML = '<tr><td colspan="2" class="text-center text-secondary">No students enrolled yet. Provide them the Join Code.</td></tr>';
        } else {
            studentsTbody.innerHTML = '';
            students.forEach(student => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${window.escapeHTML(student.full_name)}</td>
                    <td><span class="text-secondary" style="font-family: monospace;">${window.escapeHTML(student.registration_number || '-')}</span></td>
                `;
                studentsTbody.appendChild(tr);
            });
        }

        // Fetch Assessments (Sessions)
        const sessions = await window.PlaybookDB.getSessionsForCourse(courseId);

        document.getElementById('stat-assessments-count').textContent = sessions.length;

        const assessmentsTbody = document.getElementById('assessments-table-body');
        let totalAvgSum = 0;
        let validAvgs = 0;

        if (sessions.length === 0) {
            assessmentsTbody.innerHTML = '<tr><td colspan="5" class="text-center text-secondary" style="padding: 2rem;">No continuous assessments created yet.</td></tr>';
        } else {
            assessmentsTbody.innerHTML = '';
            sessions.forEach(session => {
                const tr = document.createElement('tr');
                const d = new Date(session.created_at);
                const dateStr = d.toLocaleDateString();

                let statusBadge = '';
                if (session.status === 'completed') {
                    statusBadge = `<span class="badge" style="background: var(--success-bg); color: var(--success-text); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.8rem;">Completed</span>`;
                } else if (session.status === 'pending' || session.status === 'processing') {
                    statusBadge = `<span class="badge" style="background: var(--warning-bg); color: var(--warning-text); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.8rem;">Processing</span>`;
                } else {
                    statusBadge = `<span class="badge" style="background: var(--surface-color); color: var(--text-secondary); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.8rem; border: 1px solid var(--border-color);">${session.status}</span>`;
                }

                // Add to overall class average if completed
                if (session.status === 'completed' && session.average_score != null) {
                    totalAvgSum += parseFloat(session.average_score);
                    validAvgs++;
                }

                tr.innerHTML = `
                    <td><strong>${window.escapeHTML(session.name)}</strong></td>
                    <td class="text-secondary" style="font-size: 0.9rem;">${dateStr}</td>
                    <td>${statusBadge}</td>
                    <td><strong>${session.status === 'completed' ? (session.average_score || 0) + '%' : '-'}</strong></td>
                    <td>
                        <a href="analytics.html?session=${session.id}" class="btn btn-sm" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;">View Stats</a>
                    </td>
                `;
                assessmentsTbody.appendChild(tr);
            });
        }

        if (validAvgs > 0) {
            document.getElementById('stat-class-avg').textContent = Math.round(totalAvgSum / validAvgs) + '%';
        }

    } catch (e) {
        console.error("Error loading class details", e);
        alert("Failed to load class data. Please try again.");
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
    }
});