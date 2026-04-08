document.addEventListener('DOMContentLoaded', async () => {

    const sessionUser = requireAuth(['professor', 'admin']);
    if (!sessionUser) return;

    console.log("Settings Initialization Started");

    const scaleContainer = document.getElementById('scale-container');
    const form = document.getElementById('grading-scale-form');
    const addRowBtn = document.getElementById('add-row-btn');
    const statusMsg = document.getElementById('scale-status');

    // Default universal scale
    let scaleData = [
        { min: 90, max: 100, label: 'A', color: '#0a0a0a' },
        { min: 80, max: 89.9, label: 'B', color: '#262626' },
        { min: 70, max: 79.9, label: 'C', color: '#525252' },
        { min: 60, max: 69.9, label: 'D', color: '#737373' },
        { min: 0, max: 59.9, label: 'F', color: '#0a0a0a' }
    ];

    try {
        const savedScale = await window.PlaybookDB.getSetting('grading_scale');
        if (savedScale && Array.isArray(savedScale.value)) {
            scaleData = savedScale.value;
        }
    } catch(e) {
        console.error("Could not load scale, using defaults", e);
    }

    let autoSaveTimeout = null;
    const savedIndicator = document.getElementById('saved-indicator');

    function triggerAutoSave() {
        // Debounce to prevent spamming localStorage/DB on rapid typing
        clearTimeout(autoSaveTimeout);

        // Show saving state (optional, but good UX)
        savedIndicator.innerHTML = `<span style="color: var(--text-secondary); font-size: 0.8rem; font-weight: normal;">Saving...</span>`;
        savedIndicator.style.opacity = '1';

        autoSaveTimeout = setTimeout(async () => {
            const labels = document.querySelectorAll('.scale-label');
            const maxes = document.querySelectorAll('.scale-max');
            const mins = document.querySelectorAll('.scale-min');
            const colors = document.querySelectorAll('.scale-color');

            let newScale = [];
            for(let i = 0; i < labels.length; i++) {
                newScale.push({
                    label: labels[i].value || '?',
                    max: parseFloat(maxes[i].value) || 0,
                    min: parseFloat(mins[i].value) || 0,
                    color: colors[i].value || '#0a0a0a'
                });
            }

            try {
                await window.PlaybookDB.saveSetting({
                    id: 'grading_scale',
                    value: newScale
                });

                // Show Success State
                savedIndicator.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    Saved
                `;
                savedIndicator.style.color = '#10b981';

                setTimeout(() => {
                    savedIndicator.style.opacity = '0';
                }, 2000);

            } catch(err) {
                console.error("Failed saving scale", err);
                savedIndicator.innerHTML = `<span style="color: var(--error-color);">Error saving</span>`;
            }
        }, 800); // 800ms debounce
    }

    function renderScale() {
        scaleContainer.innerHTML = '';
        scaleData.sort((a,b) => b.min - a.min); // Sort descending

        scaleData.forEach((row, idx) => {
            const div = document.createElement('div');
            div.className = 'grading-row';
            div.style.marginBottom = '10px';
            div.innerHTML = `
                <input type="text" class="form-control scale-label" value="${row.label}" placeholder="Label (e.g. A)" required style="font-weight: bold; width: 80px; text-align: center;">
                <div class="flex items-center gap-1 flex-grow">
                    <input type="number" step="0.1" class="form-control scale-max" value="${row.max}" placeholder="Max %" required style="width: 80px; text-align: center;">
                    <span style="color: var(--text-secondary); font-size: 0.9rem; font-weight: 500;">to</span>
                    <input type="number" step="0.1" class="form-control scale-min" value="${row.min}" placeholder="Min %" required style="width: 80px; text-align: center;">
                    <span style="color: var(--text-secondary); font-size: 0.9rem; font-weight: 500;">%</span>
                </div>
                <div class="flex items-center gap-1">
                    <input type="color" class="form-control scale-color" value="${row.color || '#0a0a0a'}" style="width: 44px; height: 36px; padding: 0.1rem; border-radius: 6px; flex-grow: 0; cursor: pointer;">
                    <button type="button" class="btn btn-secondary remove-row-btn" style="padding: 0.4rem 0.8rem; background: #fee2e2; color: #b91c1c; border: none;" data-index="${idx}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
            `;
            scaleContainer.appendChild(div);
        });

        // Attach listeners for Auto-Save
        document.querySelectorAll('.scale-label, .scale-max, .scale-min, .scale-color').forEach(input => {
            input.addEventListener('input', triggerAutoSave);
        });

        // Attach remove listeners
        document.querySelectorAll('.remove-row-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const button = e.target.closest('button');
                const i = button.getAttribute('data-index');
                scaleData.splice(i, 1);
                renderScale();
                triggerAutoSave(); // Trigger save immediately on deletion
            });
        });
    }

    renderScale();

    addRowBtn.addEventListener('click', () => {
        scaleData.push({ min: 0, max: 0, label: 'New', color: '#cbd5e1' });
        renderScale();
        triggerAutoSave();
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault(); // Prevent standard form submission since auto-save handles it
    });

});