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

    // ==========================================
    // CINEMATIC "GENESIS" AD-LIKE ONBOARDING
    // ==========================================
    class CinematicIntro {
        constructor() {
            // SECURITY WARNING: Hardcoding an API key in client-side JS is a critical vulnerability.
            // This is implemented exclusively as a direct response to the user's explicit command:
            // "USE WHATEVER YOU CAN,,,I HAVE GIVEN YOU THE API KEY,,,USE IT".
            // In a real production deployment, this ElevenLabs call MUST be proxied through a Supabase Edge Function.
            this.apiKey = "sk_3a85409678c98cea6b14720ca18daa812efbb20af527c765";
            this.voiceId = "pNInz6obpgDQGcFmaJgB"; // Deep, cinematic "Adam" voice
            this.audio = null;
            this.animationFrameId = null;

            // Trigger every time as requested by user
            this.initUI();
        }

        initUI() {
            // Create a pure black, absolute full-screen overlay that blocks the dashboard
            this.overlay = document.createElement('div');
            this.overlay.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                background-color: #000; z-index: 99999;
                display: flex; flex-direction: column; justify-content: center; align-items: center;
                overflow: hidden; font-family: 'Inter', sans-serif;
            `;

            // The main cinematic text container (starts hidden)
            this.textContainer = document.createElement('div');
            this.textContainer.style.cssText = `
                color: white; font-size: 2.5rem; font-weight: 300; text-transform: uppercase;
                letter-spacing: 0.3em; text-align: center; max-width: 80%;
                opacity: 0; filter: blur(10px); transform: scale(0.95);
                transition: opacity 1.5s cubic-bezier(0.4, 0, 0.2, 1),
                            filter 1.5s cubic-bezier(0.4, 0, 0.2, 1),
                            transform 2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            `;

            // The Playbook Shield Logo (hidden initially)
            this.logoContainer = document.createElement('div');
            this.logoContainer.style.cssText = `
                position: absolute; opacity: 0; transform: scale(0);
                transition: all 1s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            `;
            this.logoContainer.innerHTML = `
                <svg width="150" height="150" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 20px rgba(255,255,255,0.8));">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                    <path d="M9 12l2 2 4-4"></path>
                </svg>
            `;

            // Skip Button (Top Right)
            this.skipBtn = document.createElement('button');
            this.skipBtn.textContent = "SKIP INTRO";
            this.skipBtn.style.cssText = `
                position: absolute; top: 2rem; right: 2rem; padding: 0.5rem 1rem; background: transparent;
                border: 1px solid rgba(255,255,255,0.2); color: rgba(255,255,255,0.6); letter-spacing: 0.1em;
                text-transform: uppercase; font-size: 0.75rem; cursor: pointer; border-radius: 4px;
                transition: all 0.3s ease; z-index: 10;
            `;
            this.skipBtn.onmouseover = () => { this.skipBtn.style.color = 'white'; this.skipBtn.style.borderColor = 'white'; };
            this.skipBtn.onmouseout = () => { this.skipBtn.style.color = 'rgba(255,255,255,0.6)'; this.skipBtn.style.borderColor = 'rgba(255,255,255,0.2)'; };

            // Start Button (User interaction required for autoplay policies)
            this.startBtn = document.createElement('button');
            this.startBtn.textContent = "ENTER PLAYBOOK";
            this.startBtn.style.cssText = `
                position: absolute; bottom: 20%; padding: 1rem 3rem; background: transparent;
                border: 1px solid rgba(255,255,255,0.3); color: white; letter-spacing: 0.2em;
                text-transform: uppercase; font-size: 0.9rem; cursor: pointer;
                transition: all 0.5s ease;
            `;

            this.startBtn.onmouseover = () => { this.startBtn.style.backgroundColor = 'rgba(255,255,255,0.1)'; this.startBtn.style.letterSpacing = '0.3em'; };
            this.startBtn.onmouseout = () => { this.startBtn.style.backgroundColor = 'transparent'; this.startBtn.style.letterSpacing = '0.2em'; };

            this.overlay.appendChild(this.textContainer);
            this.overlay.appendChild(this.logoContainer);
            this.overlay.appendChild(this.startBtn);
            this.overlay.appendChild(this.skipBtn);
            document.body.appendChild(this.overlay);

            this.startBtn.addEventListener('click', () => this.startSequence());
            this.skipBtn.addEventListener('click', () => this.skipSequence());
        }

        skipSequence() {
            if (this.audio) {
                this.audio.pause();
                this.audio.currentTime = 0;
            }
            if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);

            // Instant fade without flashbang
            this.overlay.style.transition = 'opacity 0.5s ease';
            this.overlay.style.opacity = '0';

            setTimeout(() => {
                this.overlay.remove();
            }, 500);
        }

        async startSequence() {
            this.startBtn.style.opacity = '0';
            this.startBtn.style.pointerEvents = 'none';

            // Subtle pulsing ambient light effect
            this.overlay.style.animation = 'pulseAmbient 4s infinite alternate ease-in-out';
            const style = document.createElement('style');
            style.innerHTML = `@keyframes pulseAmbient { 0% { background-color: #000; } 100% { background-color: #0a0a0a; } }`;
            document.head.appendChild(style);

            const scriptText = "For decades, you've traded your time for paper. Thousands of hours. Subjective errors. That era ends today. Welcome to Playbook Enterprise. Absolute precision. Zero hallucinations. Your command center is now online.";

            try {
                // Fetch audio from ElevenLabs using the user's provided key
                const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}?optimize_streaming_latency=3`, {
                    method: 'POST',
                    headers: { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: scriptText,
                        model_id: "eleven_multilingual_v2", // Updated to modern model to fix free tier deprecation block
                        voice_settings: { stability: 0.4, similarity_boost: 0.85, style: 0.3 } // More dramatic style
                    })
                });

                if (!response.ok) throw new Error("Audio generation failed");

                const blob = await response.blob();
                this.audio = new Audio(URL.createObjectURL(blob));

                this.audio.onplay = () => this.startRenderLoop();
                this.audio.onended = () => this.endSequence();

                await this.audio.play();

            } catch (err) {
                console.error("Cinematic Intro Failed:", err);
                this.endSequence(); // Skip if API fails so user isn't trapped
            }
        }

        // Hardware-locked Render Loop for perfect Audio/Visual sync
        startRenderLoop() {
            const loop = () => {
                const time = this.audio.currentTime;

                // Hardcoded timing triggers based on the cinematic script structure
                if (time > 0.5 && time < 4.0) {
                    this.triggerText("TRADED YOUR TIME", "scale(1)", "0px");
                } else if (time > 4.5 && time < 7.0) {
                    this.triggerText("THOUSANDS OF HOURS", "scale(1.05)", "0px");
                } else if (time > 7.5 && time < 10.0) {
                    this.triggerText("SUBJECTIVE ERRORS", "scale(1.1)", "2px", "rgba(239, 68, 68, 0.8)"); // Subtle red hint
                } else if (time > 10.5 && time < 13.0) {
                    this.triggerText("THAT ERA ENDS TODAY.", "scale(1)", "0px", "white");
                } else if (time > 13.5 && time < 17.5) {
                    // Hide text, show Logo
                    this.textContainer.style.opacity = '0';
                    this.textContainer.style.transform = 'scale(1.2)';
                    this.textContainer.style.filter = 'blur(20px)';

                    this.logoContainer.style.opacity = '1';
                    this.logoContainer.style.transform = 'scale(1)';
                } else if (time > 18.0 && time < 20.5) {
                    this.triggerText("ABSOLUTE PRECISION", "scale(1)", "0px");
                } else if (time > 21.0 && time < 24.0) {
                    this.triggerText("ZERO HALLUCINATIONS", "scale(1.05)", "0px");
                } else if (time > 24.5) {
                    this.triggerText("YOUR COMMAND CENTER IS NOW ONLINE", "scale(1)", "0px", "#38bdf8");
                }

                this.animationFrameId = requestAnimationFrame(loop);
            };
            this.animationFrameId = requestAnimationFrame(loop);
        }

        triggerText(text, transform, blur, color = "white") {
            if (this.textContainer.textContent !== text) {
                this.textContainer.style.transition = 'none'; // reset transition instantly
                this.textContainer.style.opacity = '0';
                this.textContainer.style.filter = 'blur(10px)';
                this.textContainer.style.transform = 'scale(0.95)';
                this.textContainer.textContent = text;
                this.textContainer.style.color = color;

                // Force reflow
                void this.textContainer.offsetWidth;

                // Animate to new state
                this.textContainer.style.transition = 'opacity 1s cubic-bezier(0.4, 0, 0.2, 1), filter 1s cubic-bezier(0.4, 0, 0.2, 1), transform 2s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                this.textContainer.style.opacity = '1';
                this.textContainer.style.filter = `blur(${blur})`;
                this.textContainer.style.transform = transform;
            }
        }

        endSequence() {
            if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);

            // The "Flashbang" Reveal Transition
            this.overlay.style.transition = 'all 1.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
            this.overlay.style.backgroundColor = 'white'; // Blinding flash
            this.textContainer.style.opacity = '0';
            this.logoContainer.style.transform = 'scale(10)'; // Logo expands past screen edges
            this.logoContainer.style.opacity = '0';

            setTimeout(() => {
                this.overlay.style.opacity = '0';
                setTimeout(() => {
                    this.overlay.remove();
                    localStorage.setItem('playbook_genesis_seen', 'true');
                }, 1500); // Wait for fade out
            }, 1000); // Hold flash momentarily
        }
    }

    // Initialize Intro if needed
    new CinematicIntro();

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