// js/admin.js

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Secure Route - Admin Only
    const sessionUser = requireAuth(['admin']);
    if (!sessionUser) return; // Exit if unauthorized

    document.getElementById('admin-name').textContent = sessionUser.full_name;

    // 2. Fetch Institution
    let institution = null;
    try {
        institution = await window.PlaybookDB.getInstitution(sessionUser.institution_id);
    } catch (e) {
        console.error("Error fetching institution data:", e);
        return;
    }

    if (!institution) {
        alert("Fatal Error: Your institution account could not be found.");
        return;
    }

    // 3. Display Current API Key Status
    const googleInput = document.getElementById('admin-google-key');
    const deepseekInput = document.getElementById('admin-deepseek-key');
    const statusDiv = document.getElementById('api-status');

    let institutionSecret = null;
    try {
        institutionSecret = await window.PlaybookDB.getInstitutionSecret(institution.id);
    } catch (e) {
        console.error("Error fetching institution secrets:", e);
    }

    if (institutionSecret && institutionSecret.google_ai_key && institutionSecret.deepseek_api_key) {
        googleInput.value = institutionSecret.google_ai_key;
        deepseekInput.value = institutionSecret.deepseek_api_key;
        statusDiv.textContent = 'Status: Active ✔️ (Teachers can grade)';
        statusDiv.style.color = 'var(--success-color)';
    } else {
        statusDiv.textContent = 'Status: Missing ❌ (Teachers cannot grade until both keys are configured)';
        statusDiv.style.color = 'var(--error-color)';
    }

    // 4. Handle API Key Updates
    const apiForm = document.getElementById('admin-api-form');
    apiForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const googleKey = googleInput.value.trim();
        const deepseekKey = deepseekInput.value.trim();

        if (googleKey && deepseekKey) {
            try {
                // Update institution secret record securely
                await window.PlaybookDB.saveInstitutionSecret(institution.id, googleKey, deepseekKey);

                statusDiv.textContent = 'Status: Active ✔️ (Key updated successfully)';
                statusDiv.style.color = 'var(--success-color)';

                // For demo purposes, we also store it in localStorage
                // so the Web Worker can use it directly just like the old version
                localStorage.setItem('PLAYBOOK_GOOGLE_KEY', googleKey);
                localStorage.setItem('PLAYBOOK_DEEPSEEK_KEY', deepseekKey);
                localStorage.removeItem('PLAYBOOK_API_KEY');

                alert("Global Institution Key saved securely to the encrypted vault.");
            } catch (err) {
                console.error("Error saving key:", err);
                alert("Failed to save the global API key to the secure database vault.");
            }
        }
    });

    // 5. Load Professors Table
    try {
        const users = await window.PlaybookDB.getUsersByInstitution(institution.id);
        const tbody = document.getElementById('professors-list');
        tbody.innerHTML = '';

        users.forEach(user => {
            if (user.role === 'professor') {
                const tr = document.createElement('tr');
                const safeName = window.escapeHTML(String(user.full_name || ''));
                const safeEmail = window.escapeHTML(String(user.email || ''));
                const safeRole = window.escapeHTML(String(user.role || ''));

                tr.innerHTML = `
                    <td style="font-weight: 600;">${safeName}</td>
                    <td>${safeEmail}</td>
                    <td><span class="score-badge neutral" style="color: var(--text-primary);">${safeRole}</span></td>
                    <td><span class="score-badge" style="color: var(--success-color);">Active</span></td>
                    <td><button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;">Revoke Access</button></td>
                `;
                tbody.appendChild(tr);
            }
        });

        if (tbody.children.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-secondary);">No professors found. Invite some to get started.</td></tr>`;
        }
    } catch (e) {
        console.error("Error fetching users:", e);
    }

    // Invite Professor
    const inviteBtn = document.getElementById('invite-prof-btn');
    if (inviteBtn) {
        inviteBtn.addEventListener('click', () => {
            const inviteUrl = window.location.origin + '/register.html';
            navigator.clipboard.writeText(inviteUrl).then(() => {
                alert(`Invite Link Copied: ${inviteUrl}\n\nSend this to your professors. They must sign up using their @${institution.domain} email address to automatically join your institution.`);
            }).catch(err => {
                console.error("Failed to copy:", err);
                alert(`Please ask your professors to visit:\n${inviteUrl}\nand register using their @${institution.domain} email address.`);
            });
        });
    }

    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => {
        localStorage.removeItem('playbook_session');
        window.location.href = 'login.html';
    });

});