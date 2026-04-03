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

// Premium UI Override for native window.alert
if (typeof document !== 'undefined') {
    // Inject custom CSS for notifications
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    // Use a relative path so it works when deployed in subdirectories (like GitHub Pages)
    styleLink.href = 'css/notifications.css';
    document.head.appendChild(styleLink);

    // Create toast container when DOM is ready
    document.addEventListener('DOMContentLoaded', () => {
        const toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);

        window.showToast = function(message, type = 'info', duration = 4000) {
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;

            let icon = '';
            if (type === 'error') icon = '🔴';
            else if (type === 'success') icon = '🟢';
            else icon = 'ℹ️';

            toast.innerHTML = `<span style="font-size: 1.2rem;">${icon}</span> <span>${window.escapeHTML(message)}</span>`;
            toastContainer.appendChild(toast);

            setTimeout(() => {
                toast.classList.add('fade-out');
                setTimeout(() => {
                    if (toast.parentNode) {
                        toastContainer.removeChild(toast);
                    }
                }, 300); // Wait for fade-out animation
            }, duration);
        };

        // Override the native alert
        window.alert = function(message) {
            // Simple heuristic: if it contains words like failed or error, make it an error toast
            const lowerMsg = String(message).toLowerCase();
            let type = 'info';
            if (lowerMsg.includes('fail') || lowerMsg.includes('error') || lowerMsg.includes('invalid') || lowerMsg.includes('unauthorized')) {
                type = 'error';
            } else if (lowerMsg.includes('success')) {
                type = 'success';
            }
            window.showToast(message, type);
        };
    });
}

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
