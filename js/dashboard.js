document.addEventListener('DOMContentLoaded', async () => {

    const sessionUser = requireAuth(['professor', 'admin']);
    if (!sessionUser) return;

    // Utility to check if string is a valid UUID
    // REMOVED 'g' flag to prevent stateful regex bugs, removed '\b' for broader compatibility
    const isValidUUID = (id) => {
        const regexExp = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return regexExp.test(id);
    };

    // Display Name
    const nameDisplay = document.getElementById('prof-name-display');
    if (nameDisplay) {
        nameDisplay.textContent = sessionUser.full_name;
    }

    // ==========================================
    // ONBOARDING TOUR (DRIVER.JS)
    // ==========================================
    const runDashboardTour = () => {
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
                { popover: { title: 'Welcome to Playbook', description: 'The platform that instantly grades your exams and compiles your coursework.', side: "left", align: 'start' } },
                { element: '#create-class-btn', popover: { title: '1. Create a Class', description: 'Start by setting up a classroom. This generates a unique Join Code for your students.', side: "bottom", align: 'start' } },
                { element: '.stats-grid', popover: { title: '2. At a Glance', description: 'Quickly see how many students you have graded, the exams waiting for your review, and your class average.', side: "bottom", align: 'start' } },
                { element: '#performancePulseChart', popover: { title: '3. Performance Pulse', description: 'Watch this timeline automatically track whether your students are improving over the semester.', side: "top", align: 'start' } },
                { element: '#sessions-table-body', popover: { title: '4. Active Exams', description: 'Once you grade exams, their status and reports will appear right here.', side: "top", align: 'start' } },
                { element: 'nav ul li:nth-child(2) a', popover: { title: '5. Upload Scanned Exams', description: 'Click here to upload handwritten, paper exams for automatic grading.', side: "bottom", align: 'start' } },
                { popover: { title: 'You are ready to begin', description: 'Press <kbd style="font-family: monospace; background: #e2e8f0; padding: 2px 4px; border-radius: 4px;">Ctrl + /</kbd> anytime to replay this tour.', side: "left", align: 'start' } }
            ]
        });

        driverObj.drive();
        localStorage.setItem('playbook_dashboard_tour_seen', 'true');
    };

    // Auto-start tour for first-time users
    setTimeout(() => {
        if (!localStorage.getItem('playbook_dashboard_tour_seen')) {
            runDashboardTour();
        }
    }, 1000);

    // Global Hotkey Listener
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === '/') {
            e.preventDefault();
            runDashboardTour();
        }
    });

    const navTourBtn = document.getElementById('nav-tour-btn');
    if (navTourBtn) {
        navTourBtn.addEventListener('click', runDashboardTour);
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

    // Handle Class Creation Modal
    const createClassBtn = document.getElementById('create-class-btn');
    const createClassModal = document.getElementById('create-class-modal');
    const closeClassModalBtn = document.getElementById('close-class-modal-btn');
    const submitNewClassBtn = document.getElementById('submit-new-class-btn');

    if (createClassBtn && createClassModal) {
        createClassBtn.addEventListener('click', () => {
            createClassModal.style.display = 'flex';
        });

        closeClassModalBtn.addEventListener('click', () => {
            createClassModal.style.display = 'none';
        });

        submitNewClassBtn.addEventListener('click', async () => {
            const classNameInput = document.getElementById('new-class-name');
            const academicYearInput = document.getElementById('new-class-year');

            const className = classNameInput.value.trim();
            const academicYear = academicYearInput.value.trim();

            if (!className) {
                alert("Please enter a class name.");
                return;
            }

            const joinCode = generateJoinCode();

            try {
                const originalText = submitNewClassBtn.textContent;
                submitNewClassBtn.textContent = 'Creating...';
                submitNewClassBtn.disabled = true;

                // Fetch the definitive user ID directly from Supabase auth session
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
                alert("Failed to create class. Please try again.");
                submitNewClassBtn.textContent = 'Create Class';
                submitNewClassBtn.disabled = false;
            }
        });
    }

    // Load Classes
    try {
        const courses = await window.PlaybookDB.getCourses();
        const classesTbody = document.getElementById('classes-table-body');
        if (classesTbody) {
            classesTbody.innerHTML = '';
            if (courses.length === 0) {
                classesTbody.innerHTML = '<tr><td colspan="4" class="text-center text-secondary">No classes created yet.</td></tr>';
            } else {
                courses.forEach(course => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><strong>${window.escapeHTML(course.name)}</strong></td>
                        <td>${window.escapeHTML(course.academic_year || '-')}</td>
                        <td>
                            <span style="font-family: monospace; background: var(--surface-color); padding: 0.2rem 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); font-size: 1.1rem; font-weight: bold; letter-spacing: 2px;">
                                ${course.join_code}
                            </span>
                        </td>
                        <td>
                            <a href="class_detail.html?id=${course.id}" class="btn btn-sm btn-secondary">Manage Class</a>
                        </td>
                    `;
                    classesTbody.appendChild(tr);
                });
            }
        }
    } catch (e) {
        console.error("Failed to load courses for dashboard", e);
    }

    // Load Sessions (Assessments)
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

            // Use for...of to allow await inside loop
            for (const session of sessions) {
                let totalStudents = session.total_students || 0;
                const currentStatus = session.status || 'pending';

                // Fetch submissions to determine true action state (prevent late submission lockout)
                let hasPending = false;
                let hasNeedsReview = false;
                let actualSubCount = 0;
                try {
                    const subs = await window.PlaybookDB.getSubmissionsBySession(session.id);
                    hasPending = subs.some(s => s.status === 'pending');
                    hasNeedsReview = subs.some(s => s.status === 'needs_review');
                    actualSubCount = subs.length;
                } catch(e) {}

                // Fix: Sync total_students dynamically if missing or misaligned from background Autopilot
                if (actualSubCount > 0 && totalStudents !== actualSubCount) {
                    totalStudents = actualSubCount;
                }
                totalGraded += totalStudents;

                // Update metrics based on derived state
                if (currentStatus === 'needs_review' || hasNeedsReview || hasPending) {
                    pendingCount++;
                }

                if (currentStatus === 'completed' && session.average_score && !hasPending && !hasNeedsReview) {
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
                if (session.auto_grade_enabled && (currentStatus === 'pending' || currentStatus === 'processing' || hasPending)) {
                    actionLink = `<a href="review.html?session=${session.id}" class="btn btn-primary btn-sm" style="font-size: 0.75rem; padding: 0.4rem 0.75rem;">Review (Auto-Pilot)</a>`;
                } else if (hasPending) {
                    actionLink = `<a href="grade_digital.html?session_id=${session.id}" class="btn btn-primary btn-sm" style="font-size: 0.75rem; padding: 0.4rem 0.75rem;">Grade Submissions</a>`;
                } else if (currentStatus === 'completed' && !hasNeedsReview) {
                    actionLink = `<a href="analytics.html?session=${session.id}" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 0.4rem 0.75rem;">View Analytics</a>`;
                } else if (currentStatus === 'needs_review' || hasNeedsReview || currentStatus.toLowerCase() === 'pending review' || currentStatus.toLowerCase() === 'pending' || currentStatus.toLowerCase().includes('partial')) {
                    actionLink = `<a href="review.html?session=${session.id}" class="btn btn-primary btn-sm" style="font-size: 0.75rem; padding: 0.4rem 0.75rem;">Review</a>`;
                }

                const safeSessionName = window.escapeHTML(String(session.name || ''));

                // Supabase returns created_at as an ISO string
                const dateObj = session.created_at ? new Date(session.created_at) : new Date();
                const formattedDate = dateObj.toLocaleDateString();
                const safeSessionDate = window.escapeHTML(formattedDate);

                // Format display status for UI cleanly
                let displayStatus = currentStatus;
                if (hasPending || currentStatus === 'pending') {
                    displayStatus = 'Pending';
                } else if (hasNeedsReview || currentStatus === 'needs_review' || displayStatus.toLowerCase() === 'pending review') {
                    displayStatus = 'Pending Review';
                } else {
                    displayStatus = displayStatus.charAt(0).toUpperCase() + displayStatus.slice(1);
                }
                const safeSessionStatus = window.escapeHTML(String(displayStatus || ''));

                tr.innerHTML = `
                    <td style="font-weight: 600;">${safeSessionName}</td>
                    <td>${totalStudents}</td>
                    <td>${safeSessionDate}</td>
                    <td><span style="color: ${statusBadgeColor}; font-weight: 500;">${safeSessionStatus}</span></td>
                    <td>${actionLink}</td>
                `;
                tbody.appendChild(tr);
            }
        }

        document.getElementById('stat-total-graded').textContent = totalGraded.toLocaleString();
        document.getElementById('stat-pending').textContent = pendingCount.toLocaleString();

        const overallAvg = sessionsWithScore > 0 ? Math.round(totalScoreSum / sessionsWithScore) : 0;
        document.getElementById('stat-avg').textContent = `${overallAvg}%`;

        // Wait a tick to let DOM settle, then render charts
        setTimeout(() => {
            renderDashboardCharts(sessions);
        }, 100);

    } catch(err) {
        console.error("Error loading dashboard", err);
    }

    // Store Chart Instances globally to allow destroying them when cache updates
    let pulseChartInstance = null;
    let spectrumChartInstance = null;
    let leaderboardChartInstance = null;

    // Chart.js Rendering Logic
    async function renderDashboardCharts(sessions) {
        if (typeof Chart === 'undefined') {
            console.error("Chart.js failed to load from CDN.");
            const pulseCanvas = document.getElementById('performancePulseChart');
            if (pulseCanvas) pulseCanvas.parentElement.innerHTML = '<div style="height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); text-align: center; padding: 1rem;">Failed to load charts.<br>Please check your internet connection or disable ad-blockers.</div>';

            const spectrumCanvas = document.getElementById('gradeSpectrumChart');
            if (spectrumCanvas) spectrumCanvas.parentElement.innerHTML = '<div style="height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); text-align: center; padding: 1rem;">Failed to load charts.</div>';

            const leaderboardCanvas = document.getElementById('classLeaderboardChart');
            if (leaderboardCanvas) leaderboardCanvas.parentElement.innerHTML = '<div style="height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); text-align: center; padding: 1rem;">Failed to load charts.</div>';
            return;
        }

        // Common Chart.js Defaults for Premium Look
        Chart.defaults.font.family = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
        Chart.defaults.color = '#64748b'; // slate-500
        Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(15, 23, 42, 0.9)'; // slate-900
        Chart.defaults.plugins.tooltip.padding = 12;
        Chart.defaults.plugins.tooltip.cornerRadius = 8;
        Chart.defaults.plugins.tooltip.titleFont = { size: 14, weight: 'bold' };
        Chart.defaults.plugins.tooltip.bodyFont = { size: 13 };

        // Determine if we should use cached data for instant render
        const CACHE_KEY = 'playbook_dashboard_charts_cache';
        const cachedDataStr = sessionStorage.getItem(CACHE_KEY);
        let cachedData = null;

        if (cachedDataStr) {
            try {
                cachedData = JSON.parse(cachedDataStr);
            } catch(e) {}
        }

        // Helper to destroy existing charts before re-rendering
        const destroyExistingCharts = () => {
            if (pulseChartInstance) pulseChartInstance.destroy();
            if (spectrumChartInstance) spectrumChartInstance.destroy();
            if (leaderboardChartInstance) leaderboardChartInstance.destroy();
        };

        const renderFromData = (data) => {
            destroyExistingCharts();

            // 1. Performance Pulse (Line Chart)
            const pulseCanvas = document.getElementById('performancePulseChart');
            if (pulseCanvas) {
                const skeleton = document.getElementById('pulse-skeleton');
                if (skeleton) skeleton.style.display = 'none';
                pulseCanvas.style.display = 'block';

                if (data.pulse && data.pulse.labels && data.pulse.labels.length > 0) {
                    const ctx = pulseCanvas.getContext('2d');
                    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
                    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.5)');
                    gradient.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

                    pulseChartInstance = new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: data.pulse.labels,
                            datasets: [{
                                label: 'Average Score (%)',
                                data: data.pulse.dataPoints,
                                borderColor: '#3b82f6',
                                backgroundColor: gradient,
                                borderWidth: 3,
                                pointBackgroundColor: '#ffffff',
                                pointBorderColor: '#3b82f6',
                                pointBorderWidth: 2,
                                pointRadius: 4,
                                pointHoverRadius: 6,
                                fill: true,
                                tension: 0.4
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: { legend: { display: false } },
                            scales: {
                                y: { beginAtZero: true, max: 100, grid: { color: 'rgba(226, 232, 240, 0.5)', drawBorder: false } },
                                x: { grid: { display: false, drawBorder: false } }
                            }
                        }
                    });
                } else {
                    // Ghost Chart (Zero State)
                    const ctx = pulseCanvas.getContext('2d');
                    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
                    gradient.addColorStop(0, 'rgba(148, 163, 184, 0.2)');
                    gradient.addColorStop(1, 'rgba(148, 163, 184, 0.0)');

                    pulseChartInstance = new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'],
                            datasets: [{
                                label: 'Waiting for Exams',
                                data: [0, 0, 0, 0, 0],
                                borderColor: 'rgba(148, 163, 184, 0.4)',
                                backgroundColor: gradient,
                                borderWidth: 2,
                                borderDash: [5, 5],
                                pointBackgroundColor: 'transparent',
                                pointBorderColor: 'transparent',
                                fill: true,
                                tension: 0.4
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: { legend: { display: false }, tooltip: { callbacks: { label: function() { return 'Awaiting your first graded exam'; } } } },
                            scales: {
                                y: { beginAtZero: true, max: 100, grid: { color: 'rgba(226, 232, 240, 0.5)', drawBorder: false } },
                                x: { grid: { display: false, drawBorder: false } }
                            }
                        }
                    });
                }
            }

            // 2. Grade Spectrum (Doughnut Chart)
            const spectrumCanvas = document.getElementById('gradeSpectrumChart');
            if (spectrumCanvas) {
                const skeleton = document.getElementById('spectrum-skeleton');
                if (skeleton) skeleton.style.display = 'none';
                const container = document.getElementById('spectrum-canvas-container');
                if (container) container.style.display = 'block';

                if (data.spectrum && data.spectrum.totalSubs > 0) {
                    const centerVal = document.getElementById('doughnut-center-val');
                    if (centerVal) {
                        const avgPerc = Math.round((data.spectrum.totalScoreSum / data.spectrum.totalMaxSum) * 100);
                        centerVal.textContent = `${avgPerc}%`;
                    }

                    spectrumChartInstance = new Chart(spectrumCanvas, {
                        type: 'doughnut',
                        data: {
                            labels: data.spectrum.labels,
                            datasets: [{
                                data: data.spectrum.dataPoints,
                                backgroundColor: data.spectrum.colors,
                                borderWidth: 0,
                                hoverOffset: 10
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            cutout: '75%',
                            plugins: {
                                legend: {
                                    position: 'right',
                                    labels: { usePointStyle: true, padding: 15, boxWidth: 8 }
                                }
                            },
                            layout: { padding: { top: 10, bottom: 10 } }
                        }
                    });
                } else {
                    // Ghost Doughnut (Zero State)
                    const centerVal = document.getElementById('doughnut-center-val');
                    if (centerVal) centerVal.textContent = `--%`;

                    spectrumChartInstance = new Chart(spectrumCanvas, {
                        type: 'doughnut',
                        data: {
                            labels: ['Awaiting Data'],
                            datasets: [{
                                data: [1],
                                backgroundColor: ['rgba(226, 232, 240, 0.8)'],
                                borderWidth: 0,
                                hoverOffset: 0
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            cutout: '75%',
                            plugins: {
                                legend: { display: false },
                                tooltip: { callbacks: { label: function() { return 'Awaiting your first graded exam'; } } }
                            },
                            layout: { padding: { top: 10, bottom: 10 } }
                        }
                    });
                }
            }

            // 3. Class Leaderboard (Bar Chart)
            const leaderboardCanvas = document.getElementById('classLeaderboardChart');
            if (leaderboardCanvas) {
                const skeleton = document.getElementById('leaderboard-skeleton');
                if (skeleton) skeleton.style.display = 'none';
                leaderboardCanvas.style.display = 'block';

                if (data.leaderboard && data.leaderboard.labels && data.leaderboard.labels.length > 0) {
                    leaderboardChartInstance = new Chart(leaderboardCanvas, {
                        type: 'bar',
                        data: {
                            labels: data.leaderboard.labels,
                            datasets: [{
                                label: 'Overall Average (%)',
                                data: data.leaderboard.dataPoints,
                                backgroundColor: '#8b5cf6',
                                borderRadius: 20,
                                borderSkipped: false,
                                barPercentage: 0.6
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            indexAxis: 'y',
                            plugins: { legend: { display: false } },
                            scales: {
                                x: { beginAtZero: true, max: 100, grid: { color: 'rgba(226, 232, 240, 0.5)', drawBorder: false } },
                                y: { grid: { display: false, drawBorder: false } }
                            }
                        }
                    });
                } else {
                    // Ghost Leaderboard (Zero State)
                    leaderboardChartInstance = new Chart(leaderboardCanvas, {
                        type: 'bar',
                        data: {
                            labels: ['Class Alpha', 'Class Beta', 'Class Gamma'],
                            datasets: [{
                                label: 'Waiting for Exams',
                                data: [75, 50, 25], // Ghost data
                                backgroundColor: 'rgba(226, 232, 240, 0.6)',
                                borderRadius: 20,
                                borderSkipped: false,
                                barPercentage: 0.6
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            indexAxis: 'y',
                            plugins: {
                                legend: { display: false },
                                tooltip: { callbacks: { label: function() { return 'Awaiting your first graded exam'; } } }
                            },
                            scales: {
                                x: { beginAtZero: true, max: 100, grid: { color: 'rgba(226, 232, 240, 0.5)', drawBorder: false }, ticks: { color: 'transparent' } },
                                y: { grid: { display: false, drawBorder: false }, ticks: { color: 'rgba(148, 163, 184, 0.8)' } }
                            }
                        }
                    });
                }
            }
        };

        // If we have cached data, render it immediately while the background job processes
        if (cachedData) {
            renderFromData(cachedData);
        }

        // BACKGROUND AGGREGATION JOB
        // --------------------------
        try {
            const aggregatedData = {
                pulse: { labels: [], dataPoints: [] },
                spectrum: { labels: [], dataPoints: [], colors: [], totalSubs: 0, totalScoreSum: 0, totalMaxSum: 0 },
                leaderboard: { labels: [], dataPoints: [] }
            };

            const completedSessions = sessions
                .filter(s => s.status === 'completed' && s.average_score !== null && isValidUUID(s.id))
                .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

            // Pulse Aggregation
            if (completedSessions.length > 0) {
                aggregatedData.pulse.labels = completedSessions.map(s => {
                    const date = new Date(s.created_at);
                    return `${date.getMonth()+1}/${date.getDate()} - ${s.name.substring(0, 10)}...`;
                });
                aggregatedData.pulse.dataPoints = completedSessions.map(s => Number(s.average_score));
            }

            // Spectrum Aggregation
            let scaleData = [
                { min: 90, max: 100, label: 'A', color: '#10b981' },
                { min: 80, max: 89.9, label: 'B', color: '#3b82f6' },
                { min: 70, max: 79.9, label: 'C', color: '#f59e0b' },
                { min: 60, max: 69.9, label: 'D', color: '#f97316' },
                { min: 0, max: 59.9, label: 'F', color: '#ef4444' }
            ];

            try {
                const savedScale = await window.PlaybookDB.getSetting('grading_scale');
                if (savedScale && Array.isArray(savedScale.value)) {
                    scaleData = savedScale.value.map((s, i) => {
                        const defaultColors = ['#10b981', '#3b82f6', '#f59e0b', '#f97316', '#ef4444', '#8b5cf6'];
                        return { ...s, color: defaultColors[i % defaultColors.length] };
                    });
                }
            } catch(e) {}

            aggregatedData.spectrum.labels = scaleData.map(s => s.label);
            aggregatedData.spectrum.colors = scaleData.map(s => s.color);
            let gradeCounts = {};
            scaleData.forEach(s => gradeCounts[s.label] = 0);

            const sessionPromises = completedSessions.map(async (s) => {
                try { return await window.PlaybookDB.getSubmissionsBySession(s.id) || []; } catch(e) { return []; }
            });

            const allSubmissionsArrays = await Promise.all(sessionPromises);

            allSubmissionsArrays.forEach(subs => {
                subs.forEach(st => {
                    if (st.grading) {
                        aggregatedData.spectrum.totalSubs++;
                        aggregatedData.spectrum.totalScoreSum += st.grading.totalScore;
                        aggregatedData.spectrum.totalMaxSum += st.grading.maxScore;

                        const percentage = (st.grading.totalScore / st.grading.maxScore) * 100;
                        for (const scale of scaleData) {
                            if (percentage >= scale.min && percentage <= scale.max) {
                                gradeCounts[scale.label]++;
                                break;
                            }
                        }
                    }
                });
            });
            aggregatedData.spectrum.dataPoints = scaleData.map(s => gradeCounts[s.label]);

            // Leaderboard Aggregation
            const courses = await window.PlaybookDB.getCourses();
            if (courses && courses.length > 0) {
                let courseData = [];
                for (const course of courses) {
                    const courseSessions = sessions.filter(s => s.course_id === course.id && s.status === 'completed' && s.average_score !== null);
                    if (courseSessions.length > 0) {
                        let sumAvg = 0;
                        courseSessions.forEach(s => sumAvg += Number(s.average_score));
                        courseData.push({ name: course.name, avg: Math.round(sumAvg / courseSessions.length) });
                    }
                }
                courseData.sort((a, b) => b.avg - a.avg);
                courseData = courseData.slice(0, 5);

                aggregatedData.leaderboard.labels = courseData.map(c => c.name);
                aggregatedData.leaderboard.dataPoints = courseData.map(c => c.avg);
            }

            // Only re-render if the newly aggregated data is different from the cache
            if (JSON.stringify(aggregatedData) !== JSON.stringify(cachedData)) {
                sessionStorage.setItem(CACHE_KEY, JSON.stringify(aggregatedData));
                renderFromData(aggregatedData);
            }

        } catch (e) {
            console.error("Background chart aggregation failed:", e);
        }

    }

    // Comprehensive Report
    const compReportBtn = document.getElementById('download-comprehensive-report-btn');
    if (compReportBtn) {
        compReportBtn.addEventListener('click', async (e) => {
            const btn = e.target;
            const originalText = btn.textContent;
            btn.disabled = true;

            const loadingOverlay = document.getElementById('loading-overlay');
            const loadingStatus = document.getElementById('loading-status');
            if (loadingOverlay && loadingStatus) {
                loadingStatus.textContent = "Generating Comprehensive Report...";
                loadingOverlay.classList.add('active');
            }

            try {
                const allSessions = await window.PlaybookDB.getSessions();
                if (!allSessions || allSessions.length === 0) {
                    alert("No sessions available for report.");
                    return;
                }

                // Sort sessions newest first
                allSessions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

                let totalSubmissions = 0;
                const sessionData = [];

                // Fetch submissions for all sessions concurrently
                const reportPromises = allSessions.map(async (s) => {
                    if (!isValidUUID(s.id)) return null;
                    try {
                        const subs = await window.PlaybookDB.getSubmissionsBySession(s.id);
                        if (subs && subs.length > 0) {
                            return { session: s, submissions: subs };
                        }
                    } catch(e) {}
                    return null;
                });

                const reportResults = await Promise.all(reportPromises);
                reportResults.forEach(res => {
                    if (res) {
                        totalSubmissions += res.submissions.length;
                        sessionData.push(res);
                    }
                });

                if (sessionData.length === 0) {
                    alert("No submissions found across any sessions.");
                    return;
                }

                // Make sure html2pdf is available. It might not be included on dashboard page.
                if (typeof html2pdf === 'undefined') {
                    // Dynamically load html2pdf if not present
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
                        script.onload = resolve;
                        script.onerror = reject;
                        document.head.appendChild(script);
                    });
                }

                const containerWrapper = document.getElementById('comprehensive-report-container');
                const template = document.getElementById('comprehensive-report-template');
                const contentArea = document.getElementById('cr-content-area');

                // Make the wrapper visible but positioned off-screen to avoid rendering empty heights
                containerWrapper.style.display = 'block';

                // Update cover page
                document.getElementById('cr-date').textContent = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                document.getElementById('cr-total-tests').textContent = sessionData.length;
                document.getElementById('cr-total-submissions').textContent = totalSubmissions;

                // Provide scaleData for grade calculation
                let scaleData = [
                    { min: 90, max: 100, label: 'A', color: 'var(--success-text)' },
                    { min: 80, max: 89.9, label: 'B', color: 'var(--success-text)' },
                    { min: 70, max: 79.9, label: 'C', color: 'var(--partial-text)' },
                    { min: 60, max: 69.9, label: 'D', color: 'var(--neutral-text)' },
                    { min: 0, max: 59.9, label: 'F', color: 'var(--neutral-text)' }
                ];

                try {
                    const savedScale = await window.PlaybookDB.getSetting('grading_scale');
                    if (savedScale && Array.isArray(savedScale.value)) {
                        scaleData = savedScale.value;
                    }
                } catch(e) {}

                const opt = {
                    margin:       [0, 0, 0, 0],
                    filename:     `Playbook_Comprehensive_Report_${new Date().toISOString().split('T')[0]}.pdf`,
                    image:        { type: 'jpeg', quality: 0.98 },
                    html2canvas:  { scale: 2, useCORS: true, logging: false },
                    jsPDF:        { unit: 'px', format: [800, 1000], orientation: 'portrait' }
                };

                // Initialize worker with just the Cover Page (clear out contentArea for this)
                contentArea.innerHTML = '';
                await new Promise(resolve => setTimeout(resolve, 50));
                let worker = html2pdf().set(opt).from(template).toContainer().toCanvas().toPdf();

                // CRITICAL FIX: We MUST await the worker to finish rendering the cover page
                // before the loop modifies the DOM again. html2pdf queues actions asynchronously.
                await worker;

                // Process each session page by page to avoid huge html2canvas heights
                for (let index = 0; index < sessionData.length; index++) {
                    const { session, submissions } = sessionData[index];

                    // Hide the cover page logic to only render the contentArea parts for subsequent pages
                    document.getElementById('cr-cover-page').style.display = 'none';

                    // Calculate averages
                    let totalScoreSum = 0;
                    let maxScoreSum = 0;
                    submissions.forEach(st => {
                        totalScoreSum += st.grading ? st.grading.totalScore : 0;
                        maxScoreSum += st.grading ? st.grading.maxScore : 100;
                    });
                    const avgPercentage = maxScoreSum > 0 ? ((totalScoreSum / maxScoreSum) * 100).toFixed(1) : 0;

                    // --- 1. Roster Page ---
                    contentArea.innerHTML = '';
                    let sessionHtml = `
                        <div style="height: 1000px; padding-top: 40px; box-sizing: border-box;">
                            <div style="border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 30px;">
                                <div style="font-size: 14px; font-weight: 600; color: #3b82f6; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Test ${sessionData.length - index}</div>
                                <h2 style="margin: 0; font-size: 32px; font-weight: 700; color: #0f172a;">${session.name}</h2>
                                <div style="display: flex; gap: 20px; margin-top: 15px; color: #64748b; font-size: 16px;">
                                    <span><strong>${submissions.length}</strong> Students</span>
                                    <span><strong>${avgPercentage}%</strong> Average</span>
                                </div>
                            </div>

                            <h3 style="font-size: 20px; color: #1e293b; margin-bottom: 15px;">Student Roster & Marks</h3>
                            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                                <thead>
                                    <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
                                        <th style="padding: 12px; text-align: left; color: #64748b; font-weight: 600;">Reg No.</th>
                                        <th style="padding: 12px; text-align: left; color: #64748b; font-weight: 600;">Name</th>
                                        <th style="padding: 12px; text-align: right; color: #64748b; font-weight: 600;">Score</th>
                                        <th style="padding: 12px; text-align: center; color: #64748b; font-weight: 600;">Grade</th>
                                    </tr>
                                </thead>
                                <tbody>
                    `;

                    // Sort submissions by score descending
                    const sortedSubs = [...submissions].sort((a, b) => {
                        const aPerc = a.grading ? (a.grading.totalScore / a.grading.maxScore) : 0;
                        const bPerc = b.grading ? (b.grading.totalScore / b.grading.maxScore) : 0;
                        return bPerc - aPerc;
                    });

                    sortedSubs.forEach((st, i) => {
                        const score = st.grading ? st.grading.totalScore : 0;
                        const max = st.grading ? st.grading.maxScore : 100;
                        const percentage = (score / max) * 100;

                        let grade = '?';
                        let gradeBg = '#f1f5f9';
                        let gradeColor = '#64748b';

                        for (let i = 0; i < scaleData.length; i++) {
                            if (percentage >= scaleData[i].min && percentage <= scaleData[i].max) {
                                grade = scaleData[i].label;
                                if (percentage >= 80) { gradeBg = '#dcfce7'; gradeColor = '#166534'; }
                                else if (percentage >= 70) { gradeBg = '#fef9c3'; gradeColor = '#854d0e'; }
                                else { gradeBg = '#fee2e2'; gradeColor = '#991b1b'; }
                                break;
                            }
                        }

                        sessionHtml += `
                            <tr style="border-bottom: 1px solid #e2e8f0; page-break-inside: avoid;">
                                <td style="padding: 12px; color: #475569;">${st.registrationNumber || '-'}</td>
                                <td style="padding: 12px; font-weight: 500; color: #0f172a;">${st.studentName || 'Unknown'}</td>
                                <td style="padding: 12px; text-align: right; color: #475569;">${score} / ${max}</td>
                                <td style="padding: 12px; text-align: center;">
                                    <span style="background: ${gradeBg}; color: ${gradeColor}; padding: 4px 12px; border-radius: 9999px; font-weight: 600; font-size: 12px;">${grade}</span>
                                </td>
                            </tr>
                        `;
                    });

                    sessionHtml += `
                                </tbody>
                            </table>
                        </div>
                    `;

                    contentArea.innerHTML = sessionHtml;
                    await new Promise(resolve => setTimeout(resolve, 50));

                    worker = worker.get('pdf').then(pdf => {
                        pdf.addPage();
                        return pdf;
                    }).from(template).toContainer().toCanvas().toPdf();

                    // CRITICAL FIX: Await the rendering of this specific page.
                    await worker;

                    // --- 2. Showcase Page ---
                    if (sortedSubs.length > 0) {
                        const topStudent = sortedSubs[0];
                        const stScore = topStudent.grading ? topStudent.grading.totalScore : 0;
                        const stMax = topStudent.grading ? topStudent.grading.maxScore : 100;

                        contentArea.innerHTML = '';
                        let showcaseHtml = `
                            <div style="height: 1000px; padding-top: 40px; box-sizing: border-box;">
                                <div style="border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 30px;">
                                    <div style="font-size: 14px; font-weight: 600; color: #8b5cf6; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Student Showcase</div>
                                    <h2 style="margin: 0; font-size: 28px; font-weight: 700; color: #0f172a;">${topStudent.studentName}</h2>
                                    <div style="display: flex; gap: 20px; margin-top: 10px; color: #64748b;">
                                        <span>Test: ${session.name}</span>
                                        <span>Score: <strong>${stScore}/${stMax}</strong></span>
                                    </div>
                                </div>
                                <h3 style="font-size: 18px; color: #1e293b; margin-bottom: 20px;">Personalized Feedback Sample</h3>
                                <div style="display: flex; flex-direction: column; gap: 20px;">
                        `;

                        if (topStudent.grading && topStudent.grading.questions) {
                            // Take top 3 questions to fit on page
                            const qsToDisplay = topStudent.grading.questions.slice(0, 3);
                            qsToDisplay.forEach(q => {
                                const qId = q.qId !== undefined ? q.qId : q.questionId !== undefined ? q.questionId : q.questionNumber;
                                const marksAwarded = q.score !== undefined ? q.score : q.marks_awarded;
                                const maxMarks = q.max !== undefined ? q.max : q.max_marks !== undefined ? q.max_marks : q.maxScore || 1;
                                const title = q.title !== undefined ? q.title : q.questionTitle;
                                const feedback = q.feedback !== undefined ? q.feedback : q.constructive_feedback || "No actionable feedback provided.";

                                showcaseHtml += `
                                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1); page-break-inside: avoid;">
                                        <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                                            <h4 style="margin: 0; font-size: 16px; color: #0f172a;">Q${qId}: ${title}</h4>
                                            <div style="font-weight: 600; color: #3b82f6;">${marksAwarded}/${maxMarks}</div>
                                        </div>
                                        <div style="font-size: 14px; color: #475569; line-height: 1.5; white-space: pre-wrap;">${window.escapeHTML ? window.escapeHTML(feedback) : feedback}</div>
                                    </div>
                                `;
                            });
                        }

                        showcaseHtml += `
                                </div>
                            </div>
                        `;
                        contentArea.innerHTML = showcaseHtml;
                        await new Promise(resolve => setTimeout(resolve, 50));

                        worker = worker.get('pdf').then(pdf => {
                            pdf.addPage();
                            return pdf;
                        }).from(template).toContainer().toCanvas().toPdf();

                        // CRITICAL FIX: Await the rendering of this specific page.
                        await worker;
                    }
                }

                // Final save
                await worker.save();

                // Restore DOM
                document.getElementById('cr-cover-page').style.display = 'flex';
                contentArea.innerHTML = '';
                containerWrapper.style.display = 'none';

            } catch (error) {
                console.error("Failed to generate comprehensive report:", error);
                alert("Failed to generate report. Please try again.");
            } finally {
                if (loadingOverlay) loadingOverlay.classList.remove('active');
                btn.textContent = originalText;
                btn.disabled = false;
            }
        });
    }

});