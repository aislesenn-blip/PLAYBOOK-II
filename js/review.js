document.addEventListener('DOMContentLoaded', async () => {

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
        students = await window.PlaybookDB.getStudentsBySession(sessionId);

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
        session.status = 'Completed';

        // Recalculate averages based on any overrides
        let totalScoreSum = 0;
        let highest = 0;
        for(let st of students) {
            let sTotal = 0;
            if(st.grading && st.grading.questions) {
                st.grading.questions.forEach(q => {
                    // Safe parse, handle old db schemas
                    const val = q.marks_awarded !== undefined ? q.marks_awarded : q.score;
                    const parsed = parseFloat(val);
                    if (!isNaN(parsed)) {
                        sTotal += parsed;
                    }
                });
            }
            st.grading.totalScore = sTotal;
            await window.PlaybookDB.saveStudent(st);

            totalScoreSum += sTotal;
            if(sTotal > highest) highest = sTotal;
        }

        session.averageScore = Math.round(totalScoreSum / students.length);
        session.highestScore = highest;
        await window.PlaybookDB.saveSession(session);

        alert('Scores finalized and saved. Redirecting to Analytics...');
        window.location.href = `analytics.html?session=${sessionId}`;
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

        // Render Preview
        const previewContainer = document.getElementById('document-preview-container');
        previewContainer.innerHTML = '';
        if (student.pages && student.pages.length > 0) {
            const img = document.createElement('img');
            img.src = student.pages[0]; // Displaying first page for prototype
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'contain';
            previewContainer.appendChild(img);
        }

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

            // Support backward compatibility if previous db schema elements exist
            const marksAwarded = q.marks_awarded !== undefined ? q.marks_awarded : q.score;
            const maxMarks = q.max_marks !== undefined ? q.max_marks : q.maxScore;
            const questionId = q.questionId !== undefined ? q.questionId : q.questionNumber;
            const justification = q.justification !== undefined ? q.justification : q.analysis;
            const constructiveFeedback = q.constructive_feedback || q.feedback || "No actionable feedback provided by Playbook.";
            const answerStatus = q.answer_status || "Answered"; // Default to Answered for legacy data

            // Apply conditional styling for Skipped vs Answered
            const statusBadgeColor = answerStatus.toLowerCase() === "skipped" ? "background-color: var(--danger-color, #e74c3c); color: white;" : "background-color: #eee; color: #333;";

            itemDiv.innerHTML = `
                <div class="grading-header">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <h4 style="margin: 0; font-family: var(--font-sans); font-weight: 600;">Question ${questionId}: ${q.questionTitle}</h4>
                        <span style="font-size: 0.7rem; padding: 0.15rem 0.4rem; border-radius: 4px; font-weight: 600; text-transform: uppercase; ${statusBadgeColor}">${answerStatus}</span>
                    </div>
                    <div class="flex items-center gap-1">
                        <div class="score-display"><span class="score-badge">${marksAwarded}</span> / ${maxMarks}</div>
                        <button class="btn btn-secondary override-btn" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" data-qindex="${qIndex}">Override</button>
                    </div>
                </div>
                <p class="mb-1" style="font-size: 0.9rem;"><strong>Playbook Justification:</strong> ${justification}</p>
                <div class="feedback-box">
                    <strong style="display: block; margin-bottom: 0.25rem; font-size: 0.8rem; text-transform: uppercase;">Constructive Feedback:</strong>
                    <textarea class="feedback-edit" style="width:100%; height:60px; border:1px solid transparent; background:transparent; font-family:inherit; font-size:inherit; color:inherit; resize:none;" readonly>${constructiveFeedback}</textarea>
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

                    student.grading.questions[qIndex].marks_awarded = newScore;
                    student.grading.questions[qIndex].constructive_feedback = feedbackArea.value;

                    // Recalculate total score instantly
                    let newTotal = 0;
                    student.grading.questions.forEach(q => {
                        const val = q.marks_awarded !== undefined ? q.marks_awarded : q.score;
                        const parsed = parseFloat(val);
                        if (!isNaN(parsed)) newTotal += parsed;
                    });
                    student.grading.totalScore = newTotal;
                    document.getElementById('total-score-display').textContent = `${newTotal} / ${student.grading.maxScore}`;

                    // Persist to DB
                    await window.PlaybookDB.saveStudent(student);

                    scoreDisplay.innerHTML = `<span class="score-badge">${newScore}</span> / ${maxMarks}`;
                    overrideBtn.textContent = 'Override';
                    itemDiv.classList.remove('editing');
                    feedbackArea.readOnly = true;
                    feedbackArea.style.border = '1px solid transparent';
                    feedbackArea.style.background = 'transparent';

                } else {
                    // Edit
                    scoreDisplay.innerHTML = `<input type="number" class="override-input" value="${marksAwarded}" max="${maxMarks}" min="0"> / ${maxMarks}`;
                    overrideBtn.textContent = 'Save';
                    itemDiv.classList.add('editing');
                    feedbackArea.readOnly = false;
                    feedbackArea.style.border = '1px solid var(--border-color)';
                    feedbackArea.style.background = 'white';
                }
            });
        });
    }

});