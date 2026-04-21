document.addEventListener('DOMContentLoaded', async () => {

    const sessionUser = requireAuth(['professor', 'admin']);
    if (!sessionUser) return;

    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session');

    if (!sessionId) {
        alert("No session provided.");
        window.location.href = 'index.html';
        return;
    }


    let session, students;
    let currentIndex = 0;

    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');

    try {
        if (sessionId.startsWith('sandbox-session-')) {
            // UE MODE SANDBOX FALLBACK
            const mockSessionData = localStorage.getItem(sessionId) || localStorage.getItem('ue_sessions_' + sessionId) || localStorage.getItem('sandbox_ue_result_' + sessionId);
            if (!mockSessionData) {
                // If not found in localStorage, perhaps it's a real session but prefixed with sandbox?
                // The memory says it should "intercept IDs starting with sandbox-session- to prevent querying Supabase"
                // Let's create a mock session to avoid breaking.
                session = { id: sessionId, name: 'UE Sandbox Session', course_id: 'sandbox' };

                // For submissions, look for any sandbox results in localStorage
                const allKeys = Object.keys(localStorage);
                const sandboxKeys = allKeys.filter(k => k.startsWith('sandbox_ue_result_'));
                if (sandboxKeys.length > 0) {
                    students = sandboxKeys.map(k => JSON.parse(localStorage.getItem(k)));
                } else {
                    students = [];
                }
            } else {
                 const parsedData = JSON.parse(mockSessionData);
                 session = parsedData.session || { id: sessionId, name: 'UE Sandbox Session' };
                 students = parsedData.students || [parsedData];
            }
        } else {
            session = await window.PlaybookDB.getSession(sessionId);
            if (!session) throw new Error("Session not found");

            try {
                students = await window.PlaybookDB.getSubmissionsBySession(sessionId) || [];
            } catch(e) {
                students = [];
            }
        }


        document.getElementById('session-title').textContent = session.name;

        if (students.length === 0) {
            document.getElementById('grading-items-container').innerHTML = '<p style="text-align: center; padding: 2rem;">No grading data found. Ensure submissions exist and have been processed by the AI.</p>';
            return;
        }

        document.getElementById('total-student-count').textContent = students.length;

        loadStudent(currentIndex);

    } catch (e) {
        console.error(e);
        alert("Failed to load session data. The session may have been deleted.");
        return;
    }

    // View Student Work Logic
    const viewSubmissionBtn = document.getElementById('view-submission-btn');
    const submissionModal = document.getElementById('submission-modal');
    const closeSubmissionModal = document.getElementById('close-submission-modal');
    const submissionContentArea = document.getElementById('submission-content-area');

    if (viewSubmissionBtn && submissionModal) {
        viewSubmissionBtn.addEventListener('click', async () => {
            submissionModal.style.display = 'flex';
            submissionContentArea.innerHTML = 'Loading student work...';

            const currentStudent = students[currentIndex];
            if (!currentStudent) {
                submissionContentArea.innerHTML = 'No student data found.';
                return;
            }

            if (currentStudent.pdfStoragePath) {
                try {
                    const { data, error } = await window.supabaseClient.storage.from('exams_bucket').createSignedUrl(currentStudent.pdfStoragePath, 3600);
                    if (error) throw error;

                    submissionContentArea.innerHTML = `
                        <div style="margin-bottom: 1rem;">
                            <a href="${data.signedUrl}" target="_blank" class="btn btn-sm btn-primary">Open PDF in New Tab</a>
                        </div>
                        <iframe src="${data.signedUrl}" width="100%" height="600px" style="border: none; border-radius: 4px;"></iframe>
                    `;
                } catch (err) {
                    console.error("Error loading PDF:", err);
                    submissionContentArea.innerHTML = `<span style="color: red;">Error: Could not load the PDF document from storage.</span><br><br>The file may have been deleted or there is a permission issue.`;
                }
            } else if (currentStudent.textContent) {
                if (typeof window.marked !== 'undefined') {
                    const rawHtml = window.marked.parse(currentStudent.textContent);
                    submissionContentArea.innerHTML = window.DOMPurify ? window.DOMPurify.sanitize(rawHtml) : rawHtml;
                    if (typeof window.renderMathInElement === 'function') {
                        window.renderMathInElement(submissionContentArea, {
                            delimiters: [
                                {left: '$$', right: '$$', display: true},
                                {left: '$', right: '$', display: false},
                                {left: '\\(', right: '\\)', display: false},
                                {left: '\\[', right: '\\]', display: true}
                            ]
                        });
                    }
                    if (typeof window.hljs !== 'undefined') {
                        submissionContentArea.querySelectorAll('pre code').forEach((block) => {
                            window.hljs.highlightElement(block);
                        });
                    }
                } else {
                    submissionContentArea.textContent = currentStudent.textContent;
                }
            } else {
                submissionContentArea.innerHTML = '<span style="color: var(--text-secondary);">No submitted work (neither text nor PDF) found for this student.</span>';
            }
        });

        closeSubmissionModal.addEventListener('click', () => {
            submissionModal.style.display = 'none';
        });
    }

    prevBtn.addEventListener('click', () => {
        if (currentIndex > 0) {
            currentIndex--;
            loadStudent(currentIndex);
        }
    });

    // Speed-Grading Hotkeys
    document.addEventListener('keydown', (e) => {
        // Do not trigger if typing inside an input or textarea
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

        if (e.key === 'ArrowRight') {
            e.preventDefault();
            nextBtn.click();
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            prevBtn.click();
        }
    });

    nextBtn.addEventListener('click', () => {
        if (currentIndex < students.length - 1) {
            currentIndex++;
            loadStudent(currentIndex);
        }
    });

    const finalizeBtn = document.getElementById('finalize-btn');

    finalizeBtn.addEventListener('click', async () => {

        // Add UI loading state to the button
        const originalText = finalizeBtn.textContent;
        finalizeBtn.textContent = 'Saving...';
        finalizeBtn.disabled = true;

        try {
            let hasPendingStudents = false;
            let totalScoreSum = 0;
            let validStudentsCount = 0;

            for(let st of students) {
                // BUG FIX: Do NOT overwrite 'pending' late students with zero scores!
                if (st.status === 'pending') {
                    hasPendingStudents = true;
                    continue; // Skip them entirely
                }

                let sTotal = 0;

                // Ensure grading object exists to prevent TypeError
                if (!st.grading) {
                    st.grading = { totalScore: 0, maxScore: 100, questions: [] };
                }

                if(st.grading.questions) {
                    st.grading.questions.forEach(q => {
                        // Safe parse, handle old db schemas
                        const val = q.score !== undefined ? q.score : q.marks_awarded;
                        let parsed = parseFloat(val);
                        if (!isNaN(parsed)) {
                            // Enforce strict clamp to max score per question if available
                            const maxVal = q.max !== undefined ? q.max : (q.max_score !== undefined ? q.max_score : q.max_marks);
                            const parsedMax = parseFloat(maxVal);
                            if (!isNaN(parsedMax) && parsedMax > 0 && parsed > parsedMax) {
                                parsed = parsedMax;
                                q.score = parsed; // Sync object
                            }
                            sTotal += parsed;
                        }
                    });
                }

                // Enforce global clamp so score never exceeds maxScore
                if (sTotal > st.grading.maxScore) {
                    sTotal = st.grading.maxScore;
                }
                st.grading.totalScore = sTotal;

                // Map frontend object back to backend schema format for saving
                const backendSubmission = {
                    id: st.id,
                    session_id: sessionId,
                    student_name: st.studentName,
                    registration_number: st.registrationNumber,
                    total_score: st.grading.totalScore,
                    max_score: st.grading.maxScore || 100,
                    grading_data: { questions: st.grading.questions },
                    status: 'completed'
                };

                await window.PlaybookDB.saveSubmission(backendSubmission);

                totalScoreSum += sTotal;
                validStudentsCount++;
            }

            // Only mark session completed if NO pending students exist
            // Otherwise, it must stay needs_review to allow dashboard action button logic to work or just stay open.
            session.average_score = validStudentsCount > 0 ? Math.round(totalScoreSum / validStudentsCount) : 0;
            session.status = hasPendingStudents ? 'needs_review' : 'completed';

            await window.PlaybookDB.saveSession(session);

            alert('Scores finalized and saved. Redirecting to Analytics...');
            window.location.href = `analytics.html?session=${sessionId}`;
        } catch (error) {
            console.error("Error finalizing scores:", error);
            alert(`Failed to finalize scores: ${error.message}`);
            finalizeBtn.textContent = originalText;
            finalizeBtn.disabled = false;
        }
    });

    async function loadStudent(index) {
        const student = students[index];

        document.getElementById('current-student-idx').textContent = index + 1;
        document.getElementById('student-name').textContent = student.studentName || 'Unknown Student';

        const regNumElem = document.getElementById('student-reg-num');
        if (regNumElem) {
            regNumElem.textContent = student.registrationNumber || 'No ID';
        }

        prevBtn.disabled = index === 0;
        nextBtn.disabled = index === students.length - 1;

        // Document Preview removed for full-width layout

        // Render Grading
        const gradingContainer = document.getElementById('grading-items-container');
        gradingContainer.innerHTML = '';

        // --- APPEALS INTEGRATION ---
        // Check if there is a pending appeal for this submission
        const urlParams = new URLSearchParams(window.location.search);
        const targetAppealId = urlParams.get('appeal');

        if (targetAppealId && window.PlaybookDB && window.PlaybookDB.getPendingAppealsForProfessor) {
             try {
                // To keep it simple and robust, we fetch pending appeals and check if one matches this submission
                const { data: userData } = await window.supabaseClient.auth.getUser();
                if(userData && userData.user) {
                    const appeals = await window.PlaybookDB.getPendingAppealsForProfessor(userData.user.id);
                    const activeAppeal = appeals.find(a => a.submission.id === student.id && (a.status === 'escalated_to_teacher' || a.status === 'pending'));

                    if (activeAppeal) {
                        const appealCard = document.createElement('div');
                        appealCard.style.cssText = 'background-color: #fffbeb; border: 2px solid #f59e0b; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);';

                        // Build Timeline HTML
                        let timelineHtml = `
                            <p style="font-weight: 600; color: #374151; margin-bottom: 0.5rem;">1. Initial Student Dispute:</p>
                            <p style="background: white; padding: 1rem; border-radius: 6px; border: 1px solid #d1d5db; font-style: italic; color: #4b5563; margin-bottom: 1.5rem;">"${window.escapeHTML ? window.escapeHTML(activeAppeal.reason) : activeAppeal.reason}"</p>
                        `;

                        if (activeAppeal.ai_response) {
                            timelineHtml += `
                                <p style="font-weight: 600; color: #2563eb; margin-bottom: 0.5rem;">2. AI Tier-1 Re-Evaluation:</p>
                                <p style="background: #eff6ff; padding: 1rem; border-radius: 6px; border: 1px solid #bfdbfe; color: #1e3a8a; margin-bottom: 1.5rem;">${window.escapeHTML ? window.escapeHTML(activeAppeal.ai_response) : activeAppeal.ai_response}</p>
                            `;
                        }

                        if (activeAppeal.escalation_reason) {
                            timelineHtml += `
                                <p style="font-weight: 600; color: #ef4444; margin-bottom: 0.5rem;">3. Student Escalation Reason:</p>
                                <p style="background: #fef2f2; padding: 1rem; border-radius: 6px; border: 1px solid #fecaca; font-style: italic; color: #991b1b; margin-bottom: 1.5rem;">"${window.escapeHTML ? window.escapeHTML(activeAppeal.escalation_reason) : activeAppeal.escalation_reason}"</p>
                            `;
                        }

                        appealCard.innerHTML = `
                            <h3 style="margin-top: 0; color: #b45309; display: flex; align-items: center; gap: 8px;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                                Escalated Student Appeal
                            </h3>
                            ${timelineHtml}

                            <div class="form-group" style="margin-top: 1.5rem; border-top: 2px dashed #fcd34d; padding-top: 1.5rem;">
                                <label style="font-weight: 600; color: #374151; display: block; margin-bottom: 0.5rem;">Your Final Response to Student:</label>
                                <textarea id="appeal-response-text" class="form-control" rows="3" placeholder="Provide feedback or justification for your decision..."></textarea>
                            </div>

                            <div style="display: flex; gap: 10px; margin-top: 1rem;">
                                <button id="btn-approve-appeal" class="btn btn-primary" style="background-color: #10b981; border-color: #10b981;">Approve / Accept Changes</button>
                                <button id="btn-reject-appeal" class="btn btn-secondary" style="background-color: #ef4444; border-color: #ef4444; color: white;">Reject Appeal</button>
                            </div>
                        `;
                        gradingContainer.appendChild(appealCard);

                        // Bind actions
                        const resolveHandler = async (actionType) => {
                            // If approved, update DB status to teacher_resolved
                            const newStatus = actionType === 'approved' ? 'teacher_resolved' : 'rejected';
                            const responseText = document.getElementById('appeal-response-text').value;
                            if (!responseText) {
                                window.showToast ? window.showToast('Please provide a response.', 'error') : alert('Please provide a response.');
                                return;
                            }
                            try {
                                await window.PlaybookDB.resolveAppeal(activeAppeal.id, newStatus, responseText);
                                window.showToast ? window.showToast('Appeal resolved successfully.', 'success') : alert('Appeal resolved successfully.');
                                // Remove appeal card from UI
                                appealCard.remove();
                                // Clean up URL so it doesn't persist on reload
                                const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?session=' + sessionId;
                                window.history.replaceState({path:newUrl},'',newUrl);
                            } catch (err) {
                                console.error("Error resolving appeal", err);
                                window.showToast ? window.showToast('Error resolving appeal.', 'error') : alert('Error resolving appeal.');
                            }
                        };

                        document.getElementById('btn-approve-appeal').addEventListener('click', () => resolveHandler('approved'));
                        document.getElementById('btn-reject-appeal').addEventListener('click', () => resolveHandler('rejected'));
                    }
                }
             } catch(e) {
                 console.error("Failed to load appeal context", e);
             }
        }
        // --- END APPEALS INTEGRATION ---

                // UE MODE DATA NORMALIZATION
        // In UE mode, results might be stored differently depending on sandbox mode or DB.
        if (!student.grading && student.grading_data && student.grading_data.questions) {
            student.grading = {
                totalScore: student.total_score,
                maxScore: student.max_score,
                questions: Array.isArray(student.grading_data.questions) ? student.grading_data.questions : Object.values(student.grading_data.questions)
            };
        } else if (!student.grading && student.gradeBreakdown) {
            student.grading = {
                totalScore: student.marksAwardedByAi || student.totalScore || 0,
                maxScore: Object.values(student.gradeBreakdown).reduce((sum, q) => sum + (q.max_marks || 0), 0),
                questions: Array.isArray(student.gradeBreakdown) ? student.gradeBreakdown : Object.values(student.gradeBreakdown)
            };
        }

        if (!student.grading || !student.grading.questions) {
            gradingContainer.innerHTML = '<p>No grading data found.</p>';
            return;
        }

        document.getElementById('total-score-display').textContent = `${student.grading.totalScore} / ${student.grading.maxScore}`;

        student.grading.questions.forEach((q, qIndex) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'grading-item';

            // Support backward compatibility with streamlined keys
            const marksAwarded = q.score !== undefined ? q.score : q.marks_awarded;
            const maxMarks = q.max !== undefined ? q.max : q.max_marks;
            const questionId = q.qId !== undefined ? q.qId : q.questionId;
            const questionTitle = q.title !== undefined ? q.title : (q.questionTitle !== undefined ? q.questionTitle : 'Analysis');
            const justification = q.justification || q.analysis || "No step-by-step thinking provided.";
            const constructiveFeedback = q.feedback !== undefined ? q.feedback : q.constructive_feedback || "No actionable feedback provided by Playbook.";
            const answerStatus = q.status !== undefined ? q.status : q.answer_status || "Answered"; // Default to Answered for legacy data

            // Apply conditional styling for Skipped vs Answered
            const statusBadgeColor = answerStatus.toLowerCase() === "skipped" ? "background-color: var(--danger-color, #e74c3c); color: white;" : "background-color: #eee; color: #333;";

            const safeQuestionTitle = window.escapeHTML(String(questionTitle || ''));
            const safeJustification = window.escapeHTML(String(justification || ''));
            const safeFeedback = window.escapeHTML(String(constructiveFeedback || ''));
            const safeAnswerStatus = window.escapeHTML(String(answerStatus || ''));

            itemDiv.innerHTML = `
                <div class="grading-header" style="display: flex; border-bottom: 1px solid var(--border-color); padding-bottom: 1rem; margin-bottom: 1rem;">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <h4 style="margin: 0; font-family: var(--font-sans); font-weight: 600; font-size: 1.1rem; color: #0f172a;">Q${questionId}</h4>
                    </div>
                    <div class="flex items-center gap-1">
                        <div class="score-display"><span class="score-badge" style="background-color: #d1fae5; color: #065f46; border: none; padding: 0.35rem 0.75rem; border-radius: 6px; font-weight: 700; font-size: 1rem;">${marksAwarded} / ${maxMarks}</span></div>
                    </div>
                </div>

                <div class="feedback-box" style="margin-bottom: 1rem; padding: 1.25rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
                    <strong style="display: block; margin-bottom: 0.5rem; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: #2563eb; letter-spacing: 0.05em;">AI FEEDBACK</strong>
                    <p style="font-size: 0.95rem; margin: 0; white-space: pre-wrap; color: #334155; line-height: 1.6;">${safeJustification}</p>
                </div>

                <!-- Constructive feedback area -->
                <div class="feedback-box" style="padding: 1.25rem; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
                    <strong style="display: block; margin-bottom: 0.5rem; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em;">CONSTRUCTIVE FEEDBACK</strong>
                    <textarea class="feedback-edit" style="width:100%; height:60px; border:1px solid transparent; background:transparent; font-family:inherit; font-size:0.95rem; color:#334155; resize:none; line-height: 1.6; padding:0;" readonly>${safeFeedback}</textarea>
                </div>

                <div style="margin-top: 1rem; text-align: right;">
                    <button class="btn btn-secondary override-btn" style="padding: 0.35rem 1rem; font-size: 0.8rem; border-radius: 6px; font-weight: 600;" data-qindex="${qIndex}">Edit Score & Feedback</button>
                </div>
            `;
            gradingContainer.appendChild(itemDiv);

            // Add override logic specific to this item
            const overrideBtn = itemDiv.querySelector('.override-btn');
            const scoreDisplay = itemDiv.querySelector('.score-display');
            const feedbackArea = itemDiv.querySelector('.feedback-edit');

            overrideBtn.addEventListener('click', async () => {
                const isEditing = itemDiv.classList.contains('editing');

                if(isEditing) {
                    // Save
                    const input = itemDiv.querySelector('.override-input');
                    const newScore = parseFloat(input.value) || 0;

                    student.grading.questions[qIndex].score = newScore;
                    student.grading.questions[qIndex].feedback = feedbackArea.value;

                    // Recalculate total score instantly
                    let newTotal = 0;
                    student.grading.questions.forEach(q => {
                        const val = q.score !== undefined ? q.score : q.marks_awarded;
                        let parsed = parseFloat(val);
                        if (!isNaN(parsed)) {
                            // Enforce clamp on recalculation
                            const maxVal = q.max !== undefined ? q.max : (q.max_score !== undefined ? q.max_score : q.max_marks);
                            const parsedMax = parseFloat(maxVal);
                            if (!isNaN(parsedMax) && parsedMax > 0 && parsed > parsedMax) {
                                parsed = parsedMax;
                                q.score = parsed;
                            }
                            newTotal += parsed;
                        }
                    });

                    if (newTotal > student.grading.maxScore) {
                        newTotal = student.grading.maxScore;
                    }

                    student.grading.totalScore = newTotal;
                    document.getElementById('total-score-display').textContent = `${newTotal} / ${student.grading.maxScore}`;

                    // Persist to DB
                    const backendSubmission = {
                        id: student.id,
                        session_id: sessionId,
                        student_name: student.studentName,
                        registration_number: student.registrationNumber,
                        total_score: student.grading.totalScore,
                        max_score: student.grading.maxScore,
                        grading_data: { questions: student.grading.questions }
                    };
                    await window.PlaybookDB.saveSubmission(backendSubmission);

                    scoreDisplay.innerHTML = `<span class="score-badge" style="background-color: #d1fae5; color: #065f46; border: none; padding: 0.35rem 0.75rem; border-radius: 6px; font-weight: 700; font-size: 1rem;">${newScore} / ${maxMarks}</span>`;
                    overrideBtn.textContent = 'Edit Score & Feedback';
                    itemDiv.classList.remove('editing');
                    feedbackArea.readOnly = true;
                    feedbackArea.style.border = '1px solid transparent';
                    feedbackArea.style.background = 'transparent';

                } else {
                    // Edit
                    scoreDisplay.innerHTML = `<input type="number" class="override-input" value="${marksAwarded}" max="${maxMarks}" min="0" style="padding: 0.2rem 0.5rem; width: 60px; text-align: center; border-radius: 4px; border: 1px solid #cbd5e1;"> <span style="font-weight: 700; color: #0f172a; margin-left: 0.5rem;">/ ${maxMarks}</span>`;
                    overrideBtn.textContent = 'Save Changes';
                    itemDiv.classList.add('editing');
                    feedbackArea.readOnly = false;
                    feedbackArea.style.border = '1px solid var(--border-color)';
                    feedbackArea.style.background = 'white';
                }
            });
        });
    }

});