document.addEventListener('DOMContentLoaded', () => {
    console.log('Playbook Initialized');

    // Handle Upload Interface
    const startGradingBtn = document.getElementById('start-grading-btn');
    if (startGradingBtn) {
        startGradingBtn.addEventListener('click', (e) => {
            e.preventDefault();

            // Show loading overlay
            const overlay = document.getElementById('loading-overlay');
            if(overlay) overlay.classList.add('active');

            // Simulate AI Processing time
            setTimeout(() => {
                window.location.href = 'review.html';
            }, 2500);
        });
    }

    // Handle Review Interface
    const gradingItems = document.querySelectorAll('.grading-item');
    if(gradingItems.length > 0) {
        gradingItems.forEach(item => {
            const overrideBtn = item.querySelector('.override-btn');
            const scoreDisplay = item.querySelector('.score-display');

            if(overrideBtn && scoreDisplay) {
                overrideBtn.addEventListener('click', () => {
                    const isEditing = item.classList.contains('editing');

                    if(isEditing) {
                        // Save State
                        const input = item.querySelector('.override-input');
                        if(input) {
                            const newScore = input.value;
                            scoreDisplay.innerHTML = `<span class="score-badge">${newScore}</span> / ${input.dataset.max}`;
                        }
                        overrideBtn.textContent = 'Override';
                        item.classList.remove('editing');
                    } else {
                        // Edit State
                        const currentScore = scoreDisplay.textContent.split('/')[0].trim();
                        const maxScore = scoreDisplay.textContent.split('/')[1].trim();

                        scoreDisplay.innerHTML = `<input type="number" class="override-input" value="${currentScore}" data-max="${maxScore}"> / ${maxScore}`;
                        overrideBtn.textContent = 'Save';
                        item.classList.add('editing');
                    }
                });
            }
        });

        // Finalize Button
        const finalizeBtn = document.getElementById('finalize-btn');
        if(finalizeBtn) {
            finalizeBtn.addEventListener('click', () => {
                alert('Scores finalized and saved. Redirecting to Analytics...');
                window.location.href = 'analytics.html';
            });
        }
    }

});
