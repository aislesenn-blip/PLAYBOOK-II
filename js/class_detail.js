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

        // Fetch Assessments (Sessions)
        const sessions = await window.PlaybookDB.getSessionsForCourse(courseId);

        // Fetch students
        const enrollments = await window.PlaybookDB.getEnrolledStudents(courseId);
        const enrolledStudents = enrollments.map(e => e.student).filter(s => s); // Extract student data, filter nulls

        // Fetch manual submissions to include account-less students in the roster
        const allStudentsMap = new Map();

        // Add enrolled students first
        enrolledStudents.forEach(s => {
            const key = s.registration_number || s.full_name;
            if (key) allStudentsMap.set(key, { full_name: s.full_name, registration_number: s.registration_number });
        });

        // Add manual submission students
        for (const session of sessions) {
            try {
                const subs = await window.PlaybookDB.getSubmissionsBySession(session.id);
                subs.forEach(sub => {
                    // db.js getSubmissionsBySession returns mapped objects with camelCase keys: studentName, registrationNumber
                    const name = sub.studentName;
                    const reg = sub.registrationNumber;
                    if (name || reg) {
                        const key = reg || name;
                        if (!allStudentsMap.has(key)) {
                            allStudentsMap.set(key, {
                                full_name: name || 'Unknown Student',
                                registration_number: reg || '-'
                            });
                        }
                    }
                });
            } catch (e) {
                console.error("Failed to fetch submissions for session", session.id, e);
            }
        }

        const allStudents = Array.from(allStudentsMap.values());

        document.getElementById('stat-students-count').textContent = allStudents.length;

        const studentsTbody = document.getElementById('students-table-body');
        if (allStudents.length === 0) {
            studentsTbody.innerHTML = '<tr><td colspan="2" class="text-center text-secondary">No students enrolled yet. Provide them the Join Code.</td></tr>';
        } else {
            studentsTbody.innerHTML = '';
            allStudents.forEach(student => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${window.escapeHTML(student.full_name)}</td>
                    <td><span class="text-secondary" style="font-family: monospace;">${window.escapeHTML(student.registration_number || '-')}</span></td>
                `;
                studentsTbody.appendChild(tr);
            });
        }

        document.getElementById('stat-assessments-count').textContent = sessions.length;

        // Setup Tabs
        const tabBtns = document.querySelectorAll('.tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                tabBtns.forEach(b => {
                    b.classList.remove('active');
                    b.style.fontWeight = 'normal';
                    b.style.color = 'var(--text-secondary)';
                });
                btn.classList.add('active');
                btn.style.fontWeight = 'bold';
                btn.style.color = 'var(--text-primary)';

                document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
                document.getElementById(btn.dataset.tab).style.display = 'block';
            });
        });

        // Setup Create Assignment Modal
        const createModal = document.getElementById('create-assignment-modal');
        document.getElementById('create-assignment-btn').addEventListener('click', () => {
            createModal.style.display = 'flex';
        });
        document.getElementById('close-assignment-modal').addEventListener('click', () => {
            createModal.style.display = 'none';
        });

        // Setup Upload Materials Modal
        const uploadMaterialBtn = document.getElementById('upload-material-btn');
        const uploadMaterialModal = document.getElementById('upload-material-modal');
        if (uploadMaterialBtn && uploadMaterialModal) {
            uploadMaterialBtn.addEventListener('click', () => {
                uploadMaterialModal.style.display = 'flex';
            });
            document.getElementById('close-material-modal').addEventListener('click', () => {
                uploadMaterialModal.style.display = 'none';
            });

            document.getElementById('upload-material-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                const btn = e.target.querySelector('button[type="submit"]');
                const fileInput = document.getElementById('new-material-file');
                const titleInput = document.getElementById('new-material-title').value;
                const descInput = document.getElementById('new-material-desc').value;

                if (!fileInput.files.length) {
                    alert("Please select a file to upload.");
                    return;
                }

                btn.disabled = true;
                btn.innerText = 'Uploading...';

                try {
                    const file = fileInput.files[0];
                    const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
                    const filePath = `${courseId}/${fileName}`;

                    // Upload file to Supabase storage
                    const { data: storageData, error: storageError } = await window.supabaseClient.storage
                        .from('materials_bucket')
                        .upload(filePath, file);

                    if (storageError) throw storageError;

                    // Get public URL or just save the path
                    const { data: publicUrlData } = window.supabaseClient.storage
                        .from('materials_bucket')
                        .getPublicUrl(filePath);

                    // Save to DB
                    await window.PlaybookDB.saveCourseMaterial({
                        course_id: courseId,
                        title: titleInput,
                        description: descInput,
                        file_url: publicUrlData.publicUrl || filePath
                    });

                    alert('Material uploaded successfully!');
                    location.reload();
                } catch (err) {
                    console.error("Upload failed", err);
                    alert('Failed to upload material: ' + err.message);
                    btn.disabled = false;
                    btn.innerText = 'Upload Material';
                }
            });
        }

        document.getElementById('create-assignment-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type="submit"]');
            btn.disabled = true;
            btn.innerText = 'Creating...';

            try {
                const name = document.getElementById('new-assign-name').value;
                const desc = document.getElementById('new-assign-desc').value;
                const due = document.getElementById('new-assign-due').value;

                const { data: userData } = await window.supabaseClient.auth.getUser();

                await window.PlaybookDB.saveSession({
                    course_id: courseId,
                    professor_id: userData.user.id,
                    name: name,
                    description: desc,
                    due_date: new Date(due).toISOString(),
                    session_type: 'digital',
                    status: 'pending',
                    publish_status: 'published' // It's visible to students immediately as an open assignment
                });

                alert('Online assignment published to students!');
                location.reload();
            } catch (err) {
                alert('Failed to create assignment: ' + err.message);
                btn.disabled = false;
                btn.innerText = 'Publish to Students';
            }
        });

        const assessmentsTbody = document.getElementById('assessments-table-body');
        let totalAvgSum = 0;
        let validAvgs = 0;

        if (sessions.length === 0) {
            assessmentsTbody.innerHTML = '<tr><td colspan="5" class="text-center text-secondary" style="padding: 2rem;">No continuous assessments created yet.</td></tr>';
        } else {
            assessmentsTbody.innerHTML = '';
            sessions.forEach(session => {
                const tr = document.createElement('tr');
                const isDigital = session.session_type === 'digital';
                const typeLabel = isDigital ? '💻 Online' : '📄 Offline (Scanned)';

                // For digital, show due date. For offline, show created date.
                let dateDisplay = '-';
                if (isDigital && session.due_date) {
                    dateDisplay = new Date(session.due_date).toLocaleString();
                } else if (!isDigital) {
                    dateDisplay = new Date(session.created_at).toLocaleDateString();
                }

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

                // Decide action button logic based on digital vs offline
                let actionBtn = `<a href="analytics.html?session_id=${session.id}" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 0.4rem 0.75rem;">View Report</a>`;

                if (isDigital && session.status === 'pending') {
                    actionBtn = `<a href="grade_digital.html?session_id=${session.id}" class="btn btn-sm" style="font-size: 0.75rem; padding: 0.4rem 0.75rem;">Grade Submissions</a>`;
                } else if (!isDigital && session.status === 'pending') {
                    actionBtn = `<a href="review.html?session_id=${session.id}" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 0.4rem 0.75rem;">Review</a>`;
                }

                tr.innerHTML = `
                    <td style="font-weight: 500;">${window.escapeHTML(session.name)}</td>
                    <td class="text-secondary">${typeLabel}</td>
                    <td class="text-secondary">${dateDisplay}</td>
                    <td>${statusBadge}</td>
                    <td>${actionBtn}</td>
                `;
                assessmentsTbody.appendChild(tr);
            });
        }

        // Populate Materials Tab
        const materialsTbody = document.getElementById('materials-table-body');
        try {
            const materials = await window.PlaybookDB.getCourseMaterials(courseId);
            if (!materials || materials.length === 0) {
                materialsTbody.innerHTML = '<tr><td colspan="3" class="text-center text-secondary" style="padding: 2rem;">No materials uploaded yet.</td></tr>';
            } else {
                materialsTbody.innerHTML = '';
                materials.forEach(mat => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td style="font-weight: 500;">
                            ${window.escapeHTML(mat.title)}
                            ${mat.description ? `<br><small class="text-secondary">${window.escapeHTML(mat.description)}</small>` : ''}
                        </td>
                        <td class="text-secondary">${new Date(mat.created_at).toLocaleDateString()}</td>
                        <td><a href="${window.escapeHTML(mat.file_url)}" target="_blank" class="btn btn-sm btn-secondary">View File</a></td>
                    `;
                    materialsTbody.appendChild(tr);
                });
            }
        } catch (e) {
            console.error("Failed to load materials", e);
            materialsTbody.innerHTML = '<tr><td colspan="3" class="text-center text-secondary" style="padding: 2rem;">Failed to load materials.</td></tr>';
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