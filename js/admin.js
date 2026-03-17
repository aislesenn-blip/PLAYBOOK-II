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
    const apiInput = document.getElementById('admin-api-key');
    const statusDiv = document.getElementById('api-status');

    let institutionSecret = null;
    try {
        institutionSecret = await window.PlaybookDB.getInstitutionSecret(institution.id);
    } catch (e) {
        console.error("Error fetching institution secrets:", e);
    }

    if (institutionSecret && institutionSecret.openrouter_api_key && institutionSecret.openrouter_api_key !== '') {
        apiInput.value = institutionSecret.openrouter_api_key;
        statusDiv.textContent = 'Status: Active ✔️ (Teachers can grade)';
        statusDiv.style.color = 'var(--success-color)';
    } else {
        statusDiv.textContent = 'Status: Missing ❌ (Teachers cannot grade until configured)';
        statusDiv.style.color = 'var(--error-color)';
    }

    // 4. Handle API Key Updates
    const apiForm = document.getElementById('admin-api-form');
    apiForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newKey = apiInput.value.trim();

        if (newKey) {
            try {
                // Update institution secret record securely
                await window.PlaybookDB.saveInstitutionSecret(institution.id, newKey);

                statusDiv.textContent = 'Status: Active ✔️ (Key updated successfully)';
                statusDiv.style.color = 'var(--success-color)';

                // For demo purposes, we also store it in localStorage
                // so the Web Worker can use it directly just like the old version
                localStorage.setItem('PLAYBOOK_API_KEY', newKey);

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

        // Create a safe, escaped version of strings
        const escapeHTML = (str) => {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        };

        users.forEach(user => {
            if (user.role === 'professor') {
                const tr = document.createElement('tr');
                const safeName = escapeHTML(String(user.full_name || ''));
                const safeEmail = escapeHTML(String(user.email || ''));
                const safeRole = escapeHTML(String(user.role || ''));

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

    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => {
        localStorage.removeItem('playbook_session');
        window.location.href = 'login.html';
    });

});