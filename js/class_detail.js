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

        // Fetch manual submissions to include account-less students in the roster, and map session submissions for action button logic
        const allStudentsMap = new Map();
        const sessionSubmissionsMap = new Map();

        // Add enrolled students first
        enrolledStudents.forEach(s => {
            const key = s.registration_number || s.full_name;
            if (key) allStudentsMap.set(key, { full_name: s.full_name, registration_number: s.registration_number });
        });

        // Add manual submission students and build session submission map
        // Fix N+1 query bottleneck using Promise.all()
        const submissionPromises = sessions.map(async (session) => {
            try {
                const subs = await window.PlaybookDB.getSubmissionsBySession(session.id);
                sessionSubmissionsMap.set(session.id, subs);

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
        });

        await Promise.all(submissionPromises);

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

        // Setup Auto-Pilot Toggle Logic
        const autoGradeToggle = document.getElementById('enable-auto-grade');
        const autoGradeSettings = document.getElementById('auto-grade-settings');
        if (autoGradeToggle && autoGradeSettings) {
            autoGradeToggle.addEventListener('change', (e) => {
                autoGradeSettings.style.display = e.target.checked ? 'block' : 'none';
            });
        }

        // Scheme Pre-processor UI Logic
        const schemeFileInput = document.getElementById('scheme-file');
        const optimizeSchemeBtn = document.getElementById('optimize-scheme-btn');
        const rawSchemeText = document.getElementById('raw-scheme-text');
        const rawSchemeContainer = document.getElementById('raw-scheme-container');
        const optimizedSchemeContainer = document.getElementById('optimized-scheme-container');
        const optimizedSchemeText = document.getElementById('optimized-scheme-text');
        const resetSchemeBtn = document.getElementById('reset-scheme-btn');

        if (schemeFileInput) {
            schemeFileInput.addEventListener('change', async (e) => {
                if (!e.target.files.length) return;
                const file = e.target.files[0];
                rawSchemeText.value = 'Extracting text... please wait.';

                try {
                    let text = '';
                    if (file.type === 'application/pdf' && window.pdfjsLib) {
                        const arrayBuffer = await file.arrayBuffer();
                        const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
                        for (let i = 1; i <= pdf.numPages; i++) {
                            const page = await pdf.getPage(i);
                            const content = await page.getTextContent();
                            text += content.items.map(item => item.str).join(' ') + '\n';
                        }
                    } else if (file.name.endsWith('.docx') && window.mammoth) {
                        const arrayBuffer = await file.arrayBuffer();
                        const result = await mammoth.extractRawText({arrayBuffer: arrayBuffer});
                        text = result.value;
                    } else if (file.type.startsWith('image/') && window.Tesseract) {
                         rawSchemeText.value = 'Running OCR on image...';
                         const result = await Tesseract.recognize(file, 'eng');
                         text = result.data.text;
                    } else {
                        text = await file.text();
                    }
                    rawSchemeText.value = text;
                } catch (err) {
                    console.error('File extraction failed:', err);
                    alert('Failed to extract text. Please paste it manually.');
                    rawSchemeText.value = '';
                }
            });
        }

        if (optimizeSchemeBtn) {
            optimizeSchemeBtn.addEventListener('click', async () => {
                const rawText = rawSchemeText.value.trim();
                if (!rawText) {
                    alert('Please paste or upload a scheme first.');
                    return;
                }
                optimizeSchemeBtn.disabled = true;
                optimizeSchemeBtn.innerText = 'Standardizing via AI...';

                try {
                    // Call out to the AI singleton for the Builder prompt
                    const formatted = await window.PlaybookAI.optimizeMarkingScheme(rawText);
                    optimizedSchemeText.value = formatted;
                    rawSchemeContainer.style.display = 'none';
                    optimizedSchemeContainer.style.display = 'block';
                } catch (err) {
                    console.error("Failed to format scheme:", err);
                    alert("AI formatting failed. Please write the rules manually.");
                } finally {
                    optimizeSchemeBtn.disabled = false;
                    optimizeSchemeBtn.innerText = 'Auto-Format Scheme';
                }
            });
        }

        if (resetSchemeBtn) {
            resetSchemeBtn.addEventListener('click', () => {
                optimizedSchemeContainer.style.display = 'none';
                rawSchemeContainer.style.display = 'block';
            });
        }


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
                let desc = document.getElementById('new-assign-desc').value;
                const due = document.getElementById('new-assign-due').value;

                // Auto-grade settings
                const isAutoPilot = document.getElementById('enable-auto-grade').checked;
                let instructions = null;

                if (isAutoPilot) {
                    const finalScheme = optimizedSchemeContainer.style.display === 'block' ?
                        optimizedSchemeText.value.trim() : rawSchemeText.value.trim();

                    if (!finalScheme) {
                        alert("Please provide a marking scheme for Auto-Pilot grading.");
                        btn.disabled = false;
                        btn.innerText = 'Publish to Students';
                        return;
                    }

                    const totalMarks = document.getElementById('total-marks').value;

                    // We save the marking scheme in 'exam_instructions' column
                    // and prefix the description so the student knows it's auto-graded
                    instructions = finalScheme;
                    desc = `[AUTO-PILOT ENABLED] ${desc}\n\nMax Score: ${totalMarks}`;
                }

                const { data: userData } = await window.supabaseClient.auth.getUser();

                // Save session. Notice we pass auto_grade_enabled and exam_instructions
                await window.PlaybookDB.saveSession({
                    course_id: courseId,
                    professor_id: userData.user.id,
                    name: name,
                    description: desc,
                    due_date: new Date(due).toISOString(),
                    session_type: 'digital',
                    status: 'pending',
                    publish_status: 'published', // It's visible to students immediately as an open assignment
                    auto_grade_enabled: isAutoPilot,
                    exam_instructions: instructions
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

                const laptopIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/></svg>`;
                const paperIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`;

                const typeLabel = isDigital
                    ? `<span style="display: inline-flex; align-items: center;">${laptopIcon} Online</span>`
                    : `<span style="display: inline-flex; align-items: center;">${paperIcon} Offline (Scanned)</span>`;

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

                // Submission-level action button logic (Prevents "Late Submission Lockout")
                const sessionSubs = sessionSubmissionsMap.get(session.id) || [];
                const hasPendingSubmissions = sessionSubs.some(sub => sub.status === 'pending');
                const hasNeedsReviewSubmissions = sessionSubs.some(sub => sub.status === 'needs_review');

                let actionBtn = `<a href="analytics.html?session=${session.id}" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 0.4rem 0.75rem;">View Report</a>`;

                // If ANY submission is pending, the Grade button MUST be shown to allow processing of late students
                if (isDigital && (session.status === 'pending' || hasPendingSubmissions)) {
                    actionBtn = `<a href="grade_digital.html?session_id=${session.id}" class="btn btn-sm" style="font-size: 0.75rem; padding: 0.4rem 0.75rem;">Grade Submissions</a>`;
                } else if (!isDigital && (session.status === 'pending' || hasPendingSubmissions)) {
                    actionBtn = `<a href="review.html?session=${session.id}" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 0.4rem 0.75rem;">Review</a>`;
                } else if (session.status === 'needs_review' || hasNeedsReviewSubmissions) {
                    actionBtn = `<a href="review.html?session=${session.id}" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 0.4rem 0.75rem;">Review</a>`;
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