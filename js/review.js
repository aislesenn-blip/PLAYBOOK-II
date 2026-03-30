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
        session = await window.PlaybookDB.getSession(sessionId);
        students = await window.PlaybookDB.getSubmissionsBySession(sessionId);

        if (!session || !students || students.length === 0) {
            throw new Error("Session or students not found");
        }

        document.getElementById('session-title').textContent = session.name;
        document.getElementById('total-student-count').textContent = students.length;

        loadStudent(currentIndex);

    } catch (e) {
        console.error(e);
        alert("Failed to load session data.");
        return;
    }

    prevBtn.addEventListener('click', () => {
        if (currentIndex > 0) {
            currentIndex--;
            loadStudent(currentIndex);
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
            session.status = 'completed';

            // Recalculate averages based on any overrides
            let totalScoreSum = 0;
            let highest = 0;
            for(let st of students) {
                let sTotal = 0;

                // Ensure grading object exists to prevent TypeError
                if (!st.grading) {
                    st.grading = { totalScore: 0, maxScore: 100, questions: [] };
                }

                if(st.grading.questions) {
                    st.grading.questions.forEach(q => {
                        // Safe parse, handle old db schemas
                        const val = q.score !== undefined ? q.score : q.marks_awarded;
                        const parsed = parseFloat(val);
                        if (!isNaN(parsed)) {
                            sTotal += parsed;
                        }
                    });
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
                if(sTotal > highest) highest = sTotal;
            }

            session.average_score = Math.round(totalScoreSum / students.length);
            session.status = 'completed';
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

    function loadStudent(index) {
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
            const questionTitle = q.title !== undefined ? q.title : q.questionTitle;
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
                        const parsed = parseFloat(val);
                        if (!isNaN(parsed)) newTotal += parsed;
                    });
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