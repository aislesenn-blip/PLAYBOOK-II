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

    // --- Cinematic J.A.R.V.I.S. Onboarding ---
    const hasSeenOnboarding = localStorage.getItem('playbook_seen_cinematic_v2');

    if (!hasSeenOnboarding && window.PlaybookAudio) {
        // Inject Cinematic Overlay dynamically
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: #0f172a; z-index: 9999; display: flex; flex-direction: column; justify-content: center; align-items: center; color: white; transition: opacity 1.5s ease;';

        overlay.innerHTML = `
            <div id="cinematic-visual-box" style="height: 120px; display: flex; align-items: center; justify-content: center; margin-bottom: 2rem;">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            </div>

            <div id="audio-visualizer" class="audio-visualizer" style="--accent-color: #38bdf8; margin-bottom: 2rem;">
                <div class="visualizer-bar"></div>
                <div class="visualizer-bar"></div>
                <div class="visualizer-bar"></div>
                <div class="visualizer-bar"></div>
                <div class="visualizer-bar"></div>
            </div>

            <div id="cinematic-text" style="font-family: monospace; font-size: 1.1rem; color: #38bdf8; text-align: center; max-width: 600px; height: 60px; line-height: 1.5; opacity: 0; transition: opacity 0.5s;">
                Awaiting Authorization...
            </div>

            <button id="cinematic-start-btn" style="margin-top: 3rem; padding: 1rem 3rem; background: transparent; border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; font-family: monospace; text-transform: uppercase; letter-spacing: 0.1em; cursor: pointer; transition: all 0.3s ease; border-radius: 4px;">Initialize Command Center</button>
        `;
        document.body.appendChild(overlay);

        const startBtn = document.getElementById('cinematic-start-btn');
        const textBox = document.getElementById('cinematic-text');
        const visualBox = document.getElementById('cinematic-visual-box');

        startBtn.addEventListener('mouseover', () => {
            startBtn.style.backgroundColor = 'rgba(56, 189, 248, 0.1)';
        });
        startBtn.addEventListener('mouseout', () => {
            startBtn.style.backgroundColor = 'transparent';
        });

        startBtn.addEventListener('click', async () => {
            startBtn.style.display = 'none';
            textBox.style.opacity = '1';

            const script = "Welcome to Playbook Enterprise. The future of intelligent, edge-computed grading. Secure. Deterministic. Frictionless. Your command center is now online.";

            // Hardcoded timing syncs for visual flair based on Adam's TTS pacing
            setTimeout(() => {
                textBox.innerHTML = "Welcome to Playbook Enterprise.";
            }, 500);

            setTimeout(() => {
                textBox.innerHTML = "The future of intelligent, edge-computed grading.";
            }, 3000);

            setTimeout(() => {
                textBox.innerHTML = "Secure.";
                visualBox.innerHTML = `<svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: popIn 0.5s forwards;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
            }, 6500);

            setTimeout(() => {
                textBox.innerHTML = "Deterministic.";
                visualBox.innerHTML = `<div style="font-family: monospace; color: #38bdf8; font-size: 0.8rem; text-align: left; animation: slideUp 0.5s forwards;">function grade(pdf) {<br>&nbsp;&nbsp;return Edge.evaluate(pdf, strictConfig);<br>}</div>`;
            }, 7500);

            setTimeout(() => {
                textBox.innerHTML = "Frictionless.";
                visualBox.innerHTML = `<svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: popIn 0.5s forwards;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
            }, 8500);

            setTimeout(() => {
                textBox.innerHTML = "Your command center is now online.";
                visualBox.innerHTML = `<svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: popIn 0.5s forwards;"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>`;
            }, 10000);

            // Add dynamic animations
            const style = document.createElement('style');
            style.innerHTML = `
                @keyframes popIn { 0% { transform: scale(0.8); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
                @keyframes slideUp { 0% { transform: translateY(10px); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
            `;
            document.head.appendChild(style);

            // Play the cinematic audio
            await window.PlaybookAudio.speak(script, null, () => {
                // On End: Shatter/Fade out
                overlay.style.opacity = '0';
                setTimeout(() => {
                    overlay.remove();
                    localStorage.setItem('playbook_seen_cinematic_v2', 'true');
                }, 1500);
            });
        });
    }

    try {
        const sessions = await window.PlaybookDB.getSessions();

        let totalGraded = 0;
        let pendingCount = 0;
        let totalScoreSum = 0;
        let sessionsWithScore = 0;

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
                totalGraded += totalStudents;

                const currentStatus = session.status || 'pending';

                if (currentStatus === 'needs_review' || currentStatus.toLowerCase() === 'pending review' || currentStatus.toLowerCase() === 'pending' || currentStatus.toLowerCase().includes('partial')) {
                    pendingCount++;
                }

                if (session.average_score !== undefined && session.average_score !== null) {
                    totalScoreSum += Number(session.average_score);
                    sessionsWithScore++;
                }

                const tr = document.createElement('tr');

                let badgeClass = 'neutral';
                let statusBadgeColor = 'var(--neutral-text)';

                if (currentStatus === 'completed') {
                    badgeClass = '';
                    statusBadgeColor = 'var(--success-text)';
                } else if (currentStatus === 'needs_review' || currentStatus.toLowerCase() === 'pending review' || currentStatus.toLowerCase() === 'pending' || currentStatus.toLowerCase().includes('partial')) {
                    badgeClass = 'partial';
                    statusBadgeColor = 'var(--partial-text)';
                }

                let actionLink = '-';
                if (currentStatus === 'completed') {
                    actionLink = `<a href="analytics.html?session=${session.id}">View Analytics</a>`;
                } else if (currentStatus === 'needs_review' || currentStatus.toLowerCase() === 'pending review' || currentStatus.toLowerCase() === 'pending' || currentStatus.toLowerCase().includes('partial')) {
                    actionLink = `<a href="review.html?session=${session.id}">Review</a>`;
                }

                const safeSessionName = window.escapeHTML(String(session.name || ''));

                // Supabase returns created_at as an ISO string
                const dateObj = session.created_at ? new Date(session.created_at) : new Date();
                const formattedDate = dateObj.toLocaleDateString();
                const safeSessionDate = window.escapeHTML(formattedDate);

                // Format display status for UI cleanly
                let displayStatus = currentStatus;
                if (displayStatus === 'needs_review' || displayStatus.toLowerCase() === 'pending review' || displayStatus.toLowerCase() === 'pending') {
                    displayStatus = 'Pending Review';
                } else {
                    displayStatus = displayStatus.charAt(0).toUpperCase() + displayStatus.slice(1);
                }
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

        document.getElementById('stat-total-graded').textContent = totalGraded.toLocaleString();
        document.getElementById('stat-pending').textContent = pendingCount.toLocaleString();

        const overallAvg = sessionsWithScore > 0 ? Math.round(totalScoreSum / sessionsWithScore) : 0;
        document.getElementById('stat-avg').textContent = `${overallAvg}%`;

    } catch(err) {
        console.error("Error loading dashboard", err);
    }

});