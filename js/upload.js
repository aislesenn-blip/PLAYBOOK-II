// js/upload.js
// Supabase Edge Function Integration for Background Grading




document.addEventListener('DOMContentLoaded', async () => {

    const sessionUser = requireAuth(['professor', 'admin']);
    if (!sessionUser) return;

    const form = document.getElementById('upload-form');
    const schemeFileInput = document.getElementById('scheme-file');
    const examsFileInput = document.getElementById('exams-file');

    // Smart Pre-Processor Logic
    const optimizeBtn = document.getElementById('optimize-scheme-btn');
    const resetBtn = document.getElementById('reset-scheme-btn');
    const rawContainer = document.getElementById('raw-scheme-container');
    const optimizedContainer = document.getElementById('optimized-scheme-container');
    const rawTextarea = document.getElementById('raw-scheme-text');
    const optimizedTextarea = document.getElementById('optimized-scheme-text');

    // Handle .txt upload and dump into textarea
    schemeFileInput.addEventListener('change', async (e) => {
        if(e.target.files[0]) {
            const text = await e.target.files[0].text();
            rawTextarea.value = text;
        }
    });

    optimizeBtn.addEventListener('click', async () => {
        if (!rawTextarea.value.trim()) {
            alert('Please paste or upload a raw scheme first.');
            return;
        }

        optimizeBtn.textContent = 'Formatting (Server-Side)...';
        optimizeBtn.disabled = true;

        try {
            // Enterprise Architecture:
            // We NO LONGER call OpenRouter directly from the browser (which would leak the API key).
            // Instead, we call our secure Supabase Edge Function:

            /*
            const { data, error } = await window.supabaseClient.functions.invoke('format-scheme', {
                body: { raw_scheme: rawTextarea.value.trim() }
            });
            if (error) throw error;
            optimizedTextarea.value = data.formatted_scheme;
            */

            // For this frontend simulation, we will mock the Edge Function response:
            await new Promise(resolve => setTimeout(resolve, 1500));
            optimizedTextarea.value = `[ENTERPRISE EDGE FUNCTION MOCK]\n\nPlaybook Standard Format applied to:\n\n${rawTextarea.value.trim()}`;

            rawContainer.style.display = 'none';
            optimizedContainer.style.display = 'block';
        } catch (e) {
            console.error(e);
            alert(`Failed to optimize via Edge Function: ${e.message}`);
        } finally {
            optimizeBtn.textContent = 'Auto-Format Scheme';
            optimizeBtn.disabled = false;
        }
    });

    resetBtn.addEventListener('click', () => {
        optimizedContainer.style.display = 'none';
        rawContainer.style.display = 'block';
        optimizedTextarea.value = '';
    });

    // File name display
    examsFileInput.addEventListener('change', (e) => {
        if(e.target.files[0]) {
            document.getElementById('exams-filename').textContent = e.target.files[0].name;
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const sessionName = document.getElementById('session-name').value;
        const examsFile = examsFileInput.files[0];

        // Decide which scheme text to use
        let markingSchemeText = optimizedTextarea.value.trim();
        if (!markingSchemeText) {
            markingSchemeText = rawTextarea.value.trim();
        }

        if (!examsFile || !sessionName) {
            alert('Please provide a session name and upload an exams PDF.');
            return;
        }

        const overlay = document.getElementById('loading-overlay');
        const statusEl = document.getElementById('loading-status');
        const detailEl = document.getElementById('loading-detail');
        overlay.classList.add('active');

        try {
            statusEl.textContent = 'Preparing Upload...';
            detailEl.textContent = 'Connecting to Playbook Edge Network.';

            // 1. Create a "Pending" Session in Supabase
            const newSession = {
                professor_id: sessionUser.user_id,
                name: sessionName,
                marking_scheme: markingSchemeText,
                status: 'pending',
                total_students: 0 // Will update once backend splits PDF
            };

            const savedSession = await window.PlaybookDB.saveSession(newSession);

            // 2. Upload PDF to Supabase Storage Bucket ('exams_bucket')
            statusEl.textContent = 'Uploading Bulk PDF...';
            detailEl.textContent = 'Securely transferring file to backend for asynchronous processing.';

            const filePath = `sessions/${savedSession.id}/${Date.now()}_${examsFile.name}`;
            const { data, error } = await window.supabaseClient.storage
                .from('exams_bucket')
                .upload(filePath, examsFile);

            if (error) {
                // Rollback session
                await window.supabaseClient.from('sessions').delete().eq('id', savedSession.id);
                throw error;
            }

            // 3. Trigger Edge Function (or rely on DB Webhook)
            // Here, we update the session to "processing" and save the storage path.
            // In a real Supabase setup, a DB trigger on this table update would fire an Edge Function
            // to split the PDF into individual students and grade them asynchronously.
            await window.supabaseClient.from('sessions').update({
                status: 'processing',
                pdf_storage_path: data.path
            }).eq('id', savedSession.id);

            statusEl.textContent = 'Upload Complete!';
            detailEl.textContent = 'Your exams have been queued. You can safely close this page. You will be notified when grading is finished.';

            // Redirect to dashboard after short delay
            setTimeout(() => {
                window.location.href = `index.html`;
            }, 3000);

        } catch (error) {
            console.error(error);
            alert(`Upload failed: ${error.message}`);
            overlay.classList.remove('active');
        }
    });

});
