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
