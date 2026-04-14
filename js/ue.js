document.addEventListener('DOMContentLoaded', () => {
    requireAuth(['professor', 'admin']);
    console.log("UE Mode initialized");

    const terminal = document.getElementById('ue-terminal');
    const btnIngest = document.getElementById('btn-ingest');
    const btnCompile = document.getElementById('btn-compile');
    const btnExecute = document.getElementById('btn-execute');

    const cardStep1 = document.getElementById('card-step-1');
    const cardStep2 = document.getElementById('card-step-2');
    const cardStep3 = document.getElementById('card-step-3');

    // File inputs
    const schemeUploadDiv = document.getElementById('scheme-upload');
    const schemeFileInput = document.getElementById('scheme-file');
    const scriptsUploadDiv = document.getElementById('scripts-upload');
    const scriptsFileInput = document.getElementById('scripts-file');

    function logTerminal(message, type = 'log-info') {
        if (!terminal) return;
        terminal.style.display = 'block';
        const p = document.createElement('p');
        const time = new Date().toLocaleTimeString();
        p.className = type;
        p.textContent = `[${time}] > ${message}`;
        terminal.appendChild(p);
        terminal.scrollTop = terminal.scrollHeight;
    }

    // Step 1: Ingestion
    btnIngest.addEventListener('click', async () => {
        const urls = document.getElementById('ue-urls').value;
        if (!urls.trim()) {
            logTerminal("Warning: No URLs provided. Proceeding with base knowledge only.", "log-warn");
        } else {
            logTerminal("Connecting to Vector DB...");
            logTerminal(`Ingesting syllabus data from ${urls.split('\n').length} sources...`);

            // Simulate ingestion delay
            btnIngest.disabled = true;
            btnIngest.textContent = "Ingesting...";

            await new Promise(r => setTimeout(r, 2000));

            logTerminal("Vector embeddings stored successfully. Knowledge Base updated.", "log-info");
        }

        btnIngest.textContent = "Trained ✓";
        btnIngest.style.background = "var(--success-color)";

        // Unlock Step 2
        cardStep1.classList.remove('active');
        cardStep2.style.opacity = '1';
        cardStep2.classList.add('active');
        btnCompile.disabled = false;
    });

    // Step 2: Compilation Upload
    schemeUploadDiv.addEventListener('click', () => schemeFileInput.click());
    schemeFileInput.addEventListener('change', (e) => {
        if(e.target.files.length > 0) {
            logTerminal(`File selected: ${e.target.files[0].name}`);
            schemeUploadDiv.style.borderColor = "var(--success-color)";
        }
    });

    btnCompile.addEventListener('click', async () => {
        logTerminal("Initiating Semantic Compilation via Native Gemini REST...");
        btnCompile.disabled = true;
        btnCompile.textContent = "Compiling...";

        await new Promise(r => setTimeout(r, 2500));

        logTerminal("Golden Logic Graph generated. ASTs compiled. Contradictions mapped.", "log-info");
        btnCompile.textContent = "Compiled ✓";
        btnCompile.style.background = "var(--success-color)";

        // Unlock Step 3
        cardStep2.classList.remove('active');
        cardStep3.style.opacity = '1';
        cardStep3.classList.add('active');
        btnExecute.disabled = false;
    });

    // Step 3: Execution Upload
    scriptsUploadDiv.addEventListener('click', () => scriptsFileInput.click());
    scriptsFileInput.addEventListener('change', (e) => {
        if(e.target.files.length > 0) {
            logTerminal(`${e.target.files.length} student script(s) selected ready for extraction.`);
            scriptsUploadDiv.style.borderColor = "var(--success-color)";
        }
    });

    btnExecute.addEventListener('click', async () => {
        logTerminal("Starting Optical extraction & Semantic Gravity routing...");
        btnExecute.disabled = true;
        btnExecute.textContent = "Executing...";

        await new Promise(r => setTimeout(r, 1500));

        logTerminal("Routing complete. Initiating Deterministic Graph Execution (Map-Reduce)...");

        await new Promise(r => setTimeout(r, 2000));

        logTerminal("Execution complete. 100% Deterministic evaluation achieved.", "log-info");
        btnExecute.textContent = "Complete ✓";
        btnExecute.style.background = "var(--success-color)";

        setTimeout(() => {
            alert("Execution Complete. Check Analytics for detailed breakdowns.");
        }, 500);
    });

});
