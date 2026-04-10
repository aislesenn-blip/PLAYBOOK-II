document.addEventListener('DOMContentLoaded', async () => {
    const sessionUser = requireAuth(['professor', 'admin']);
    if (!sessionUser) return;

    // Handle Logout
    const logoutBtn = document.getElementById('logout-btn');

    // ==========================================
    // ONBOARDING TOUR (DRIVER.JS)
    // ==========================================
    const runClassTour = () => {
        if (typeof window.driver === 'undefined') return;

        const driverObj = window.driver.js.driver({
            showProgress: true,
            animate: true,
            overlayOpacity: 0.65,
            showButtons: ['next', 'previous', 'close'],
            nextBtnText: 'Next →',
            prevBtnText: '← Previous',
            doneBtnText: 'Done',
            steps: [
                { element: '#class-join-code', popover: { title: 'The Join Code', description: 'Give this 6-character code to your students so they can join your class portal.', side: "bottom", align: 'start' } },
                { element: '#create-assignment-btn', popover: { title: 'Create Homework', description: 'Set up digital assignments. Turn on "Instant Grading" to have students graded automatically the moment they finish.', side: "bottom", align: 'start' } },
                { element: 'button[data-tab="materials-tab"]', popover: { title: 'Share Materials', description: 'Upload PDFs, reading notes, or syllabi for your students to access securely.', side: "bottom", align: 'start' } },
                { element: 'button[data-tab="students-tab"]', popover: { title: 'Student List', description: 'See everyone who has successfully joined your class.', side: "bottom", align: 'start' } },
                { element: 'button[data-tab="gradebook-tab"]', popover: { title: 'The Master Gradebook', description: 'View all semester scores in one place. Edit grades freely, and compile the final coursework directly into a CSV.', side: "bottom", align: 'start' } },
                { popover: { title: 'Class setup is complete', description: 'Press <kbd style="font-family: monospace; background: #e2e8f0; padding: 2px 4px; border-radius: 4px;">Ctrl + /</kbd> anytime to replay this tour.', side: "left", align: 'start' } }
            ]
        });

        driverObj.drive();
        localStorage.setItem('playbook_class_tour_seen', 'true');
    };

    setTimeout(() => {
        if (!localStorage.getItem('playbook_class_tour_seen')) {
            runClassTour();
        }
    }, 1000);

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === '/') {
            e.preventDefault();
            runClassTour();
        }
    });

    const navTourBtn = document.getElementById('nav-tour-btn');
    if (navTourBtn) {
        navTourBtn.addEventListener('click', runClassTour);
    }
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

        // Track stuck autopilot submissions for auto-resolution
        const stuckAutopilotSubmissions = [];

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

                if (session.auto_grade_enabled) {
                    subs.forEach(sub => {
                        if (sub.status === 'pending') {
                            stuckAutopilotSubmissions.push(sub.id);
                        }
                    });
                }

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

        // FALLBACK: Kickstart stuck Autopilot submissions synchronously
        if (stuckAutopilotSubmissions.length > 0) {
            console.log(`Detected ${stuckAutopilotSubmissions.length} stuck Autopilot submissions. Triggering Edge Function fallback...`);

            // Optional: Show a subtle toast or indicator so the teacher knows grading is happening
            if (window.showToast) {
                window.showToast(`Auto-grading ${stuckAutopilotSubmissions.length} recent submissions...`, 'info');
            }

            // We do not await this block; we fire it and let it process in the background.
            // It uses Promise.all to trigger them concurrently, allowing the dashboard to render instantly.
            Promise.all(stuckAutopilotSubmissions.map(async (subId) => {
                try {
                    // Use Supabase client directly to trigger Edge Function securely without hardcoding domains
                    await window.supabaseClient.functions.invoke('auto-grade-single', {
                        body: { submission_id: subId }
                    });
                } catch (err) {
                    console.error(`Fallback auto-grade failed for submission ${subId}:`, err);
                }
            })).then(() => {
                console.log("Fallback auto-grading tasks initiated.");
                // We could reload here, but that might disrupt the user.
                // They will see the updated status on their next navigation or refresh.
            });
        }

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

        // Rules Cheat Sheet Modal
        const rulesModal = document.getElementById('rules-cheat-sheet-modal');
        const openRulesBtn = document.getElementById('open-rules-cheat-sheet');
        const closeRulesBtn = document.getElementById('close-rules-cheat-sheet');
        const gotItBtn = document.getElementById('got-it-rules-btn');

        if (rulesModal && openRulesBtn) {
            openRulesBtn.addEventListener('click', () => rulesModal.style.display = 'flex');
            closeRulesBtn.addEventListener('click', () => rulesModal.style.display = 'none');
            gotItBtn.addEventListener('click', () => rulesModal.style.display = 'none');
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
                const fileType = file.type;
                const fileName = file.name.toLowerCase();
                const parentLabel = schemeFileInput.parentElement;

                try {
                    if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
                        parentLabel.innerText = 'Analyzing Layout...';
                        const arrayBuffer = await file.arrayBuffer();
                        const pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;

                        if (pdfjsLib && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
                            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                        }

                        const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                        let extractedText = "";

                        for (let i = 1; i <= pdfDoc.numPages; i++) {
                            const page = await pdfDoc.getPage(i);
                            const textContent = await page.getTextContent();
                            const pageText = textContent.items.map(item => item.str).join(' ');
                            extractedText += pageText + "\n";
                        }

                        const sanitizedText = extractedText.replace(/CamScanner/gi, '').replace(/Scanned with/gi, '').trim();

                        if (sanitizedText.length > 50) {
                            rawSchemeText.value = extractedText;
                            parentLabel.innerText = 'Upload Document';
                            parentLabel.appendChild(schemeFileInput);
                        } else {
                            let base64Images = [];

                            for (let i = 1; i <= pdfDoc.numPages; i++) {
                                const page = await pdfDoc.getPage(i);
                                const viewport = page.getViewport({ scale: 1.5 });
                                const canvas = document.createElement('canvas');
                                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                                canvas.height = viewport.height;
                                canvas.width = viewport.width;
                                ctx.fillStyle = '#FFFFFF';
                                ctx.fillRect(0, 0, canvas.width, canvas.height);
                                await page.render({ canvasContext: ctx, viewport: viewport }).promise;
                                base64Images.push(canvas.toDataURL('image/jpeg', 0.8));
                            }

                            try {
                                parentLabel.innerText = 'Running AI Vision...';
                                const fullText = await window.PlaybookAI.extractMarkingSchemeOCR(base64Images);
                                rawSchemeText.value = fullText;
                            } catch (ocrError) {
                                console.error("OCR Failed:", ocrError);
                                alert("Failed to extract text from PDF via AI Vision.");
                            } finally {
                                parentLabel.innerText = 'Upload Document';
                                parentLabel.appendChild(schemeFileInput);
                            }
                        }
                    } else if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || fileName.endsWith('.docx')) {
                        try {
                            parentLabel.innerText = 'Extracting Word Doc...';
                            const arrayBuffer = await file.arrayBuffer();
                            const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
                            rawSchemeText.value = result.value;
                        } catch (error) {
                            console.error("Error reading Word document:", error);
                            alert("Failed to read Word document. Try saving as PDF instead.");
                        } finally {
                            parentLabel.innerText = 'Upload Document';
                            parentLabel.appendChild(schemeFileInput);
                        }
                    } else if (fileType.startsWith('image/') || fileName.endsWith('.png') || fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
                        try {
                            parentLabel.innerText = 'Running OCR on Image...';
                            const reader = new FileReader();
                            reader.onload = async (event) => {
                                const base64Image = event.target.result;
                                try {
                                    const fullText = await window.PlaybookAI.extractMarkingSchemeOCR([base64Image]);
                                    rawSchemeText.value = fullText;
                                } catch (ocrError) {
                                    console.error("OCR Failed:", ocrError);
                                    alert("Failed to extract text from image via OCR.");
                                } finally {
                                    parentLabel.innerText = 'Upload Document';
                                    parentLabel.appendChild(schemeFileInput);
                                }
                            };
                            reader.readAsDataURL(file);
                        } catch (error) {
                            console.error("Error reading image:", error);
                            alert("Failed to process image.");
                        }
                    } else {
                        const text = await file.text();
                        rawSchemeText.value = text;
                    }
                } catch (err) {
                    console.error('File extraction failed:', err);
                    alert('Failed to process file.');
                    parentLabel.innerText = 'Upload Document';
                    parentLabel.appendChild(schemeFileInput);
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
                        .from('course_materials')
                        .upload(filePath, file);

                    if (storageError) throw storageError;

                    // Get public URL or just save the path
                    const { data: publicUrlData } = window.supabaseClient.storage
                        .from('course_materials')
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

                    // We now combine the explicitly typed rules from the new textarea
                    // with the marking scheme so the AI engine gets both during grading
                    const explicitRules = document.getElementById('exam-instructions').value.trim();
                    const totalMarks = document.getElementById('total-marks').value;

                    instructions = explicitRules ? `${explicitRules}\n\n${finalScheme}` : finalScheme;
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
                    statusBadge = `<span style="color: var(--success-text); font-weight: 500;">Completed</span>`;
                } else if (session.status === 'pending' || session.status === 'processing') {
                    statusBadge = `<span style="color: var(--partial-text); font-weight: 500;">Processing</span>`;
                } else {
                    statusBadge = `<span style="color: var(--text-secondary); font-weight: 500;">${session.status}</span>`;
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
                // However, if auto-pilot is enabled, the cloud handles grading, so they should go to Review/Analytics instead.
                if (session.auto_grade_enabled && (session.status === 'pending' || session.status === 'processing' || hasPendingSubmissions)) {
                    actionBtn = `<a href="review.html?session=${session.id}" class="btn btn-primary btn-sm" style="font-size: 0.75rem; padding: 0.4rem 0.75rem;">Review (Auto-Pilot)</a>`;
                } else if (isDigital && (session.status === 'pending' || hasPendingSubmissions)) {
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

        // ========================================================
        // MASTER GRADEBOOK LOGIC
        // ========================================================
        const gradebookHeaderRow = document.getElementById('gradebook-header-row');
        const gradebookBody = document.getElementById('gradebook-table-body');
        const saveGradebookBtn = document.getElementById('save-gradebook-btn');
        let editedGrades = {}; // Stores { submission_id: { newValue, maxScore } }

        // Render Gradebook Structure
        const renderGradebook = () => {
            gradebookHeaderRow.innerHTML = `
                <th class="sticky-col" style="min-width: 150px;">Student Name</th>
                <th style="min-width: 120px;">Reg Number</th>
            `;

            // Sort sessions oldest to newest for chronological columns
            const sortedSessions = [...sessions].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

            sortedSessions.forEach(session => {
                const th = document.createElement('th');
                th.style.textAlign = 'center';
                th.innerHTML = `
                    <div style="font-weight: 700; color: var(--primary-color);">${window.escapeHTML(session.name)}</div>
                    <div style="font-size: 0.65rem; color: var(--text-secondary);">${new Date(session.created_at).toLocaleDateString()}</div>
                `;
                gradebookHeaderRow.appendChild(th);
            });

            // Add final Coursework column
            gradebookHeaderRow.innerHTML += `<th style="min-width: 120px; text-align: center; background: #e0e7ff; color: #4338ca; border-left: 2px solid #818cf8;" id="coursework-header-col">Coursework (CA)</th>`;

            if (allStudents.length === 0) {
                gradebookBody.innerHTML = `<tr><td colspan="${sortedSessions.length + 3}" class="text-center text-secondary" style="padding: 2rem;">No students to display.</td></tr>`;
                return;
            }

            gradebookBody.innerHTML = '';

            // Sort students alphabetically
            const sortedStudents = [...allStudents].sort((a, b) => a.full_name.localeCompare(b.full_name));

            sortedStudents.forEach(student => {
                const tr = document.createElement('tr');
                tr.dataset.studentId = student.registration_number || student.full_name;

                tr.innerHTML = `
                    <td class="sticky-col" style="font-weight: 500; color: var(--text-primary);">${window.escapeHTML(student.full_name)}</td>
                    <td style="color: var(--text-secondary); font-family: monospace;">${window.escapeHTML(student.registration_number || '-')}</td>
                `;

                // Calculate total coursework
                let courseworkScore = 0;

                sortedSessions.forEach(session => {
                    const sessionSubs = sessionSubmissionsMap.get(session.id) || [];
                    // Match by reg number first, then by name
                    const match = sessionSubs.find(s =>
                        (s.registrationNumber && s.registrationNumber === student.registration_number) ||
                        (s.studentName && s.studentName === student.full_name)
                    );

                    let displayVal = '-';
                    let maxVal = 100;
                    let submissionId = null;

                    if (match && match.grading) {
                        displayVal = match.grading.totalScore;
                        maxVal = match.grading.maxScore || 100;
                        submissionId = match.id;
                    } else if (match && (match.status === 'pending' || match.status === 'needs_review' || match.status === 'processing')) {
                        displayVal = 'Pending';
                    }

                    const td = document.createElement('td');
                    td.style.textAlign = 'center';

                    if (displayVal !== '-' && displayVal !== 'Pending') {
                        td.innerHTML = `
                            <input type="number" class="grade-input"
                                data-sub-id="${submissionId}"
                                data-max="${maxVal}"
                                data-original="${displayVal}"
                                value="${displayVal}" step="0.1" min="0" max="${maxVal}">
                            <span style="font-size: 0.75rem; color: var(--text-secondary);">/ ${maxVal}</span>
                        `;
                    } else if (displayVal === 'Pending') {
                        td.innerHTML = `<span style="font-size: 0.75rem; color: #f59e0b; font-weight: 600;">Pending</span>`;
                    } else {
                        td.innerHTML = `<span style="color: var(--border-color);">-</span>`;
                    }

                    tr.appendChild(td);
                });

                tr.innerHTML += `<td style="text-align: center; font-weight: 700; color: #4338ca; border-left: 2px solid #818cf8; background: #e0e7ff;" class="coursework-cell">-</td>`;
                gradebookBody.appendChild(tr);
            });

            // Attach Input Listeners
            document.querySelectorAll('.grade-input').forEach(input => {
                input.addEventListener('input', (e) => {
                    const subId = e.target.dataset.subId;
                    const maxScore = parseFloat(e.target.dataset.max);
                    const original = parseFloat(e.target.dataset.original);
                    let newVal = parseFloat(e.target.value);

                    if (isNaN(newVal) || newVal < 0) newVal = 0;
                    if (newVal > maxScore) newVal = maxScore;

                    if (newVal !== original) {
                        e.target.classList.add('dirty');
                        editedGrades[subId] = { score: newVal, max: maxScore };
                        saveGradebookBtn.style.display = 'inline-block';
                    } else {
                        e.target.classList.remove('dirty');
                        delete editedGrades[subId];
                        if (Object.keys(editedGrades).length === 0) saveGradebookBtn.style.display = 'none';
                    }
                });
            });
        };

        renderGradebook();

        // Gradebook Live Search
        const gradebookSearch = document.getElementById('gradebook-search');
        if (gradebookSearch) {
            gradebookSearch.addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase();
                const rows = gradebookBody.querySelectorAll('tr');
                rows.forEach(row => {
                    if (row.cells.length <= 1) return; // Skip empty state row
                    const name = row.cells[0].textContent.toLowerCase();
                    const regNum = row.cells[1].textContent.toLowerCase();
                    if (name.includes(term) || regNum.includes(term)) {
                        row.style.display = '';
                    } else {
                        row.style.display = 'none';
                    }
                });
            });
        }

        // Save Overrides
        saveGradebookBtn.addEventListener('click', async () => {
            saveGradebookBtn.disabled = true;
            saveGradebookBtn.textContent = 'Saving...';
            try {
                const updatePromises = Object.keys(editedGrades).map(async (subId) => {
                    const updateData = editedGrades[subId];
                    // Fetch existing submission to preserve grading_data structure
                    const sub = await window.PlaybookDB.getSubmission(subId);

                    await window.PlaybookDB.saveSubmission({
                        id: subId,
                        total_score: updateData.score,
                        session_id: sub.session_id,
                        student_name: sub.student_name,
                        registration_number: sub.registration_number,
                        text_content: sub.text_content,
                        status: sub.status,
                        grading_data: sub.grading_data
                    });
                });

                await Promise.all(updatePromises);

                // Clear dirty state
                editedGrades = {};
                saveGradebookBtn.style.display = 'none';
                saveGradebookBtn.disabled = false;
                saveGradebookBtn.textContent = 'Save All Changes';

                document.querySelectorAll('.grade-input.dirty').forEach(input => {
                    input.classList.remove('dirty');
                    input.dataset.original = input.value;
                });

                window.toast("Grades updated successfully");
            } catch (err) {
                console.error("Failed to save grade overrides", err);
                alert("Failed to save some grades. Please try again.");
                saveGradebookBtn.disabled = false;
                saveGradebookBtn.textContent = 'Save All Changes';
            }
        });

        // ========================================================
        // COURSEWORK AGGREGATOR ENGINE
        // ========================================================
        const courseworkModal = document.getElementById('coursework-modal');
        const courseworkAssessmentList = document.getElementById('coursework-assessment-list');

        const scaleInput = document.getElementById('coursework-scale');
        const liveScaleVal = document.getElementById('live-scale-val');
        const liveScaleValFormula = document.getElementById('live-scale-val-formula');

        if (scaleInput && liveScaleVal && liveScaleValFormula) {
            scaleInput.addEventListener('input', (e) => {
                const val = e.target.value || '0';
                liveScaleVal.textContent = val;
                liveScaleValFormula.textContent = val;

                // Dynamically calculate the final result in the explainer box
                const parsedVal = parseFloat(val);
                const exampleResult = isNaN(parsedVal) ? 0 : Math.round((85 / 100) * parsedVal);
                document.getElementById('live-scale-result').textContent = exampleResult;
            });
        }

        document.getElementById('compile-coursework-btn').addEventListener('click', () => {
            courseworkAssessmentList.innerHTML = '';
            // Populate checkboxes
            [...sessions].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).forEach(session => {
                const div = document.createElement('div');
                div.style.display = 'flex';
                div.style.alignItems = 'center';
                div.style.gap = '10px';
                div.style.background = 'white';
                div.style.padding = '10px';
                div.style.borderRadius = '8px';
                div.style.border = '1px solid #e2e8f0';

                div.innerHTML = `
                    <input type="checkbox" class="cw-checkbox" value="${session.id}" checked style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--primary-color);">
                    <div>
                        <span style="font-weight: 500; color: var(--text-primary); display: block;">${window.escapeHTML(session.name)}</span>
                        <span style="font-size: 0.75rem; color: var(--text-secondary);">${session.session_type.toUpperCase()}</span>
                    </div>
                `;
                courseworkAssessmentList.appendChild(div);
            });

            courseworkModal.style.display = 'flex';
        });

        document.getElementById('close-coursework-modal').addEventListener('click', () => courseworkModal.style.display = 'none');
        document.getElementById('cancel-coursework-btn').addEventListener('click', () => courseworkModal.style.display = 'none');

        document.getElementById('generate-coursework-btn').addEventListener('click', () => {
            const selectedSessionIds = Array.from(document.querySelectorAll('.cw-checkbox:checked')).map(cb => cb.value);
            const keepBestStr = document.getElementById('coursework-keep-best').value;
            let keepBest = parseInt(keepBestStr, 10);
            if (isNaN(keepBest) || keepBest <= 0) keepBest = null;

            let finalScale = parseFloat(document.getElementById('coursework-scale').value);
            if (isNaN(finalScale) || finalScale <= 0) finalScale = 100;

            if (selectedSessionIds.length === 0) {
                alert("Please select at least one assessment.");
                return;
            }

            document.getElementById('coursework-header-col').textContent = `Coursework (/${finalScale})`;

            // Run Calculation per Student Row
            const rows = gradebookBody.querySelectorAll('tr');
            rows.forEach(row => {
                const cwCell = row.querySelector('.coursework-cell');
                if (!cwCell) return; // Empty state row

                const studentId = row.dataset.studentId;
                const student = allStudents.find(s => (s.registration_number === studentId || s.full_name === studentId));
                if (!student) return;

                let percentages = [];

                selectedSessionIds.forEach(sessId => {
                    const sessionSubs = sessionSubmissionsMap.get(sessId) || [];
                    const match = sessionSubs.find(s =>
                        (s.registrationNumber && s.registrationNumber === student.registration_number) ||
                        (s.studentName && s.studentName === student.full_name)
                    );

                    if (match && match.grading) {
                        // Normalize to percentage before comparing "Best Of" to handle different max marks fairly
                        const max = match.grading.maxScore || 100;
                        const score = match.grading.totalScore || 0;
                        percentages.push((score / max));
                    } else {
                        // If they missed it, it's a 0 for aggregation purposes
                        percentages.push(0);
                    }
                });

                // Apply "Best Of" Rule
                if (keepBest && keepBest < percentages.length) {
                    percentages.sort((a, b) => b - a); // Descending
                    percentages = percentages.slice(0, keepBest);
                }

                // Average the kept percentages, then scale
                if (percentages.length > 0) {
                    const sumPerc = percentages.reduce((sum, p) => sum + p, 0);
                    const avgPerc = sumPerc / percentages.length;
                    const finalScore = Math.round(avgPerc * finalScale * 100) / 100;
                    cwCell.textContent = finalScore;
                    cwCell.dataset.rawScore = finalScore; // Store clean number for export
                } else {
                    cwCell.textContent = '0';
                    cwCell.dataset.rawScore = 0;
                }
            });

            courseworkModal.style.display = 'none';
            window.toast("Coursework calculated successfully!");
        });

        // ========================================================
        // CSV EXPORT LOGIC
        // ========================================================
        document.getElementById('export-csv-btn').addEventListener('click', () => {
            const rows = gradebookBody.querySelectorAll('tr');
            if (rows.length === 0 || rows[0].cells.length === 1) {
                alert("No data to export.");
                return;
            }

            let csvContent = "";

            // Build Headers
            const headers = [];
            document.querySelectorAll('#gradebook-header-row th').forEach(th => {
                // Clean HTML from headers
                const text = th.textContent.replace(/[\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
                headers.push(`"${text.replace(/"/g, '""')}"`);
            });
            csvContent += headers.join(",") + "\r\n";

            // Build Rows
            rows.forEach(row => {
                const rowData = [];
                row.querySelectorAll('td').forEach((td, index) => {
                    let cellVal = "";
                    // For input fields, grab the value
                    const input = td.querySelector('input');
                    if (input) {
                        cellVal = input.value;
                    } else if (td.classList.contains('coursework-cell') && td.dataset.rawScore !== undefined) {
                        cellVal = td.dataset.rawScore;
                    } else {
                        cellVal = td.textContent.replace(/[\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
                    }
                    // Handle missing/pending visual indicators cleanly
                    if (cellVal === '-' || cellVal.includes('Pending')) cellVal = "";
                    rowData.push(`"${String(cellVal).replace(/"/g, '""')}"`);
                });
                csvContent += rowData.join(",") + "\r\n";
            });

            // Trigger Download via Blob to handle large files and special characters safely
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            const cleanCourseName = document.getElementById('class-title').textContent.replace(/[^a-zA-Z0-9]/g, '_');
            link.setAttribute("download", `Playbook_Gradebook_${cleanCourseName}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });

    } catch (e) {
        console.error("Error loading class details", e);
        alert("Failed to load class data. Please try again.");
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
    }
});