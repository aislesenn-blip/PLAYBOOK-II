// Global utility functions
window.escapeHTML = function(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

// Cinematic Audio & Branding Engine (J.A.R.V.I.S. Inspired)
window.PlaybookAudio = {
    // In a production environment, this request MUST be proxied through a Supabase Edge Function
    // to prevent exposing the ElevenLabs API key to the client's browser.
    // For this prototype demonstration, we are using the user's provided key directly.
    apiKey: "sk_3a85409678c98cea6b14720ca18daa812efbb20af527c765",
    voiceId: "pNInz6obpgDQGcFmaJgB", // Adam (Deep, Authoritative)

    // Play a generated text-to-speech audio clip using ElevenLabs
    speak(text, onPlay = null, onEnd = null) {
        return new Promise(async (resolve, reject) => {
            try {
                const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}?optimize_streaming_latency=3`, {
                    method: 'POST',
                    headers: {
                        'xi-api-key': this.apiKey,
                        'Content-Type': 'application/json'
                    },
                body: JSON.stringify({
                    text: text,
                    model_id: "eleven_monolingual_v1",
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75,
                        style: 0.2, // Adds slightly more expressiveness suitable for cinematic voice
                        use_speaker_boost: true
                    }
                })
            });

            if (!response.ok) {
                console.error("ElevenLabs API Error:", await response.text());
                // Fallback to Web Speech API if ElevenLabs fails (ensures app doesn't break)
                return this.fallbackSpeak(text, onPlay, onEnd);
            }

                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const audio = new Audio(url);

                // Manage visualizer state globally if it exists
                const visualizer = document.getElementById('audio-visualizer');

                audio.onplay = () => {
                    if (visualizer) visualizer.classList.add('active');
                    if (onPlay) onPlay();
                };

                audio.onended = () => {
                    if (visualizer) visualizer.classList.remove('active');
                    if (onEnd) onEnd();
                    resolve(); // Resolve promise when audio completely finishes
                };

                await audio.play();

            } catch (error) {
                console.error("Audio generation failed:", error);
                this.fallbackSpeak(text, onPlay, () => {
                    if (onEnd) onEnd();
                    resolve();
                });
            }
        });
    },

    // Silent fallback if API fails or blocks
    fallbackSpeak(text, onPlay, onEnd) {
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(text);
            const voices = speechSynthesis.getVoices();
            // Try to find a deep/english voice
            utterance.voice = voices.find(v => v.lang === 'en-US' && v.name.includes('Google')) || voices[0];
            utterance.pitch = 0.8; // Lower pitch for authority
            utterance.rate = 1.0;

            utterance.onstart = onPlay;
            utterance.onend = onEnd;

            speechSynthesis.speak(utterance);
        } else {
            // Absolute fallback, just trigger callbacks
            if (onPlay) onPlay();
            if (onEnd) setTimeout(onEnd, 2000); // Fake duration
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    console.log('Playbook Initialized');

    // Hamburger Menu Toggle Logic
    const hamburgerMenu = document.querySelector('.hamburger-menu');
    const navLinks = document.querySelector('.nav-links');

    if (hamburgerMenu && navLinks) {
        hamburgerMenu.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent document click from immediately closing
            navLinks.classList.toggle('active');
        });

        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (navLinks.classList.contains('active') && !navLinks.contains(e.target) && e.target !== hamburgerMenu) {
                navLinks.classList.remove('active');
            }
        });
    }

    // Note: Global interactive behaviors for standard static UI elements would go here.
    // Core functional logic (uploading, grading, review persistence) is handled in:
    // - js/upload.js
    // - js/review.js
    // - js/analytics.js
    // - js/dashboard.js
});
