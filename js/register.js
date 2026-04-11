function sanitizeDomain(domain) {
    if (!domain) return '';
    let cleaned = domain.trim().toLowerCase();
    let previous = '';
    while (cleaned !== previous) {
        previous = cleaned;
        cleaned = cleaned.replace(/^https?:\/\//, '');
        cleaned = cleaned.replace(/^www\./, '');
        cleaned = cleaned.replace(/^@/, '');
    }
    return cleaned.split('/')[0];
}

document.addEventListener('DOMContentLoaded', () => {

    // Tab switching logic
    const tabs = document.querySelectorAll('.auth-tab');
    const forms = document.querySelectorAll('.auth-form');

    function switchTab(targetDataAttr) {
        tabs.forEach(t => t.classList.remove('active'));
        const activeTab = document.querySelector(`.auth-tab[data-target="${targetDataAttr}"]`);
        if (activeTab) activeTab.classList.add('active');

        forms.forEach(f => f.style.display = 'none');
        const targetId = targetDataAttr + '-form';
        const targetForm = document.getElementById(targetId);
        if (targetForm) targetForm.style.display = 'block';
    }

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            switchTab(tab.getAttribute('data-target'));
        });
    });

    // Check URL parameters for initial tab
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('role') === 'professor') {
        switchTab('prof-signup');
    }

    // 1. Admin/Institution Signup
    const adminForm = document.getElementById('admin-signup-form');
    adminForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const instName = document.getElementById('inst-name').value.trim();
        let instDomain = document.getElementById('inst-domain').value;

        // Clean up domain if admin accidentally pasted a URL or used @
        instDomain = sanitizeDomain(instDomain);

        const adminName = document.getElementById('admin-name').value.trim();
        const adminEmail = document.getElementById('admin-email').value.trim();
        const adminPassword = document.getElementById('admin-password').value;

        try {
            // A. Create User in Supabase Auth
            const { data: authData, error: authError } = await window.supabaseClient.auth.signUp({
                email: adminEmail,
                password: adminPassword,
            });

            if (authError) throw authError;

            // B. Create Institution Record
            const { data: instData, error: instError } = await window.supabaseClient
                .from('institutions')
                .insert([{ name: instName, domain: instDomain }])
                .select()
                .single();

            if (instError) throw instError;

            // C. Create User Profile Record
            const { error: profileError } = await window.supabaseClient
                .from('users')
                .insert([{
                    id: authData.user.id,
                    institution_id: instData.id,
                    full_name: adminName,
                    email: adminEmail,
                    role: 'admin'
                }]);

            if (profileError) throw profileError;

            alert("Institution Registered successfully! Please sign in to configure your API key.");
            window.location.href = 'login.html';

        } catch (err) {
            console.error(err);
            alert("Registration failed: " + err.message);
        }
    });

    // 2. Professor Signup
    const profForm = document.getElementById('prof-signup-form');
    profForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const profName = document.getElementById('prof-name').value.trim();
        const profEmail = document.getElementById('prof-email').value.trim();
        const profPassword = document.getElementById('prof-password').value;

        // Extract domain
        const domainMatch = profEmail.match(/@(.+)$/);
        let emailDomain = domainMatch ? domainMatch[1] : null;

        if (!emailDomain) {
            alert("Invalid email address format.");
            return;
        }

        // Clean up any extraneous characters (e.g. if they somehow put spaces)
        emailDomain = sanitizeDomain(emailDomain);

        try {
            // A. Check if Institution Exists for this Domain
            // ILIKE is used just in case the db has mixed case domains from older inserts
            const { data: instData, error: instFetchError } = await window.supabaseClient
                .from('institutions')
                .select('id')
                .ilike('domain', emailDomain)
                .single();

            if (instFetchError || !instData) {
                console.warn("Domain fetch error: ", instFetchError);
                alert(`No registered institution found for domain '@${emailDomain}'. Ask your IT admin to register your university first, or ensure you are using your official university email.`);
                return;
            }

            // B. Create Auth User
            const { data: authData, error: authError } = await window.supabaseClient.auth.signUp({
                email: profEmail,
                password: profPassword,
            });

            if (authError) throw authError;

            // C. Create User Profile
            const { error: profileError } = await window.supabaseClient
                .from('users')
                .insert([{
                    id: authData.user.id,
                    institution_id: instData.id,
                    full_name: profName,
                    email: profEmail,
                    role: 'professor'
                }]);

            if (profileError) throw profileError;

            alert("Professor account created successfully! You are linked to your institution. Please sign in.");
            window.location.href = 'login.html';

        } catch (err) {
            console.error(err);
            alert("Signup failed: " + err.message);
        }
    });
});