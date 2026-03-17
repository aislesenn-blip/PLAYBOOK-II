// js/auth.js
// Supabase Authentication Flow

import { supabase, PlaybookDB } from './db.js';

document.addEventListener('DOMContentLoaded', async () => {

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const emailInput = document.getElementById('email').value.trim();
            const passwordInput = document.getElementById('password').value;

            try {
                // 1. Authenticate with Supabase
                const { data, error } = await supabase.auth.signInWithPassword({
                    email: emailInput,
                    password: passwordInput,
                });

                if (error) {
                    alert("Login Error: " + error.message);
                    return;
                }

                // 2. Fetch User Profile & Role from database
                const profile = await PlaybookDB.getUserById(data.user.id);

                if (profile) {
                    // Set secure session in localStorage for fast synchronous frontend checks
                    const sessionData = {
                        user_id: profile.id,
                        email: profile.email,
                        role: profile.role,
                        institution_id: profile.institution_id,
                        full_name: profile.full_name
                    };
                    localStorage.setItem('playbook_session', JSON.stringify(sessionData));

                    // 3. Route based on role
                    if (profile.role === 'admin') {
                        window.location.href = 'admin.html';
                    } else {
                        window.location.href = 'index.html';
                    }
                } else {
                    alert("Profile not found. Please contact your administrator.");
                    await supabase.auth.signOut();
                    localStorage.removeItem('playbook_session');
                }
            } catch (error) {
                console.error("Login Error:", error);
                alert("An unexpected error occurred during authentication.");
            }
        });
    }

});

// Global Auth Guard Function (Synchronous check against local cache)
export function requireAuth(allowedRoles = ['professor', 'admin']) {
    const sessionStr = localStorage.getItem('playbook_session');

    if (!sessionStr) {
        window.location.href = 'login.html';
        return null;
    }

    try {
        const session = JSON.parse(sessionStr);
        if (!allowedRoles.includes(session.role)) {
            alert("Unauthorized access. Redirecting...");
            if (session.role === 'admin') window.location.href = 'admin.html';
            else window.location.href = 'index.html';
            return null;
        }
        return session;
    } catch (e) {
        localStorage.removeItem('playbook_session');
        window.location.href = 'login.html';
        return null;
    }
}

// Attach to window for script tags
window.requireAuth = requireAuth;
