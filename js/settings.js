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

    function renderScale() {
        scaleContainer.innerHTML = '';
        scaleData.sort((a,b) => b.min - a.min); // Sort descending

        scaleData.forEach((row, idx) => {
            const div = document.createElement('div');
            div.className = 'grading-row';
            div.innerHTML = `
                <input type="text" class="form-control scale-label" value="${row.label}" placeholder="Label (e.g. A)" required>
                <input type="number" step="0.1" class="form-control scale-max" value="${row.max}" placeholder="Max %" required>
                <span>% to</span>
                <input type="number" step="0.1" class="form-control scale-min" value="${row.min}" placeholder="Min %" required>
                <span>%</span>
                <input type="color" class="form-control scale-color" value="${row.color || '#0a0a0a'}" style="width: 60px; padding: 0.2rem;">
                <button type="button" class="btn btn-secondary remove-row-btn" style="padding: 0.5rem 1rem;" data-index="${idx}">X</button>
            `;
            scaleContainer.appendChild(div);
        });

        // Attach remove listeners
        document.querySelectorAll('.remove-row-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const i = e.target.getAttribute('data-index');
                scaleData.splice(i, 1);
                renderScale();
            });
        });
    }

    renderScale();

    addRowBtn.addEventListener('click', () => {
        scaleData.push({ min: 0, max: 0, label: 'New', color: '#0a0a0a' });
        renderScale();
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const labels = document.querySelectorAll('.scale-label');
        const maxes = document.querySelectorAll('.scale-max');
        const mins = document.querySelectorAll('.scale-min');
        const colors = document.querySelectorAll('.scale-color');

        let newScale = [];
        for(let i=0; i < labels.length; i++) {
            newScale.push({
                label: labels[i].value,
                max: parseFloat(maxes[i].value),
                min: parseFloat(mins[i].value),
                color: colors[i].value
            });
        }

        newScale.sort((a,b) => b.min - a.min);

        try {
            await window.PlaybookDB.saveSetting({
                id: 'grading_scale',
                value: newScale
            });

            scaleData = newScale;
            renderScale();

            statusMsg.style.display = 'block';
            setTimeout(() => statusMsg.style.display = 'none', 3000);
        } catch(err) {
            console.error("Failed saving scale", err);
            alert("Error saving custom grading scale.");
        }
    });

});