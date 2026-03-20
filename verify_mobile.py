from playwright.sync_api import sync_playwright

def verify_mobile():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={'width': 390, 'height': 844},
            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1'
        )
        page = context.new_page()

        with open('review.html', 'r') as f:
            html = f.read()

        page.set_content(html, wait_until="domcontentloaded")

        with open('css/style.css', 'r') as f:
            css = f.read()
        page.add_style_tag(content=css)

        page.evaluate("""
            const container = document.getElementById('students-container');
            if (container) {
                container.innerHTML = `
                    <div class="student-card" style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.5rem; background: white; margin-bottom: 2rem;">
                        <div class="flex justify-between items-center" style="margin-bottom: 1.5rem;">
                            <h3 style="margin: 0;">John Doe</h3>
                            <div class="score-display">Total: <span class="score-badge" style="background: #e0f2fe; color: #0369a1;">8 / 10</span></div>
                        </div>

                        <!-- Grading Content -->
                        <div style="margin-top: 1.5rem;">
                            <div class="grading-header" style="display: flex; border-bottom: 1px solid var(--border-color); padding-bottom: 1rem; margin-bottom: 1rem;">
                                <div style="display: flex; align-items: center; gap: 0.5rem;">
                                    <h4 style="margin: 0; font-family: var(--font-sans); font-weight: 600; font-size: 1.1rem; color: #0f172a;">Q1</h4>
                                </div>
                                <div class="flex items-center gap-1">
                                    <div class="score-display"><span class="score-badge" style="background-color: #d1fae5; color: #065f46; border: none; padding: 0.35rem 0.75rem; border-radius: 6px; font-weight: 700; font-size: 1rem;">8 / 10</span></div>
                                </div>
                            </div>

                            <div class="feedback-stack" style="display: flex; gap: 1.5rem; width: 100%;">
                                <div class="feedback-box" style="flex: 1; padding: 1.25rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
                                    <h5 style="margin-top: 0; margin-bottom: 0.5rem; color: #64748b; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700;">Playbook Justification</h5>
                                    <p style="margin: 0; font-size: 0.95rem; color: #334155; line-height: 1.6;">Good math logic.</p>
                                </div>

                                <div class="feedback-box" style="flex: 1; padding: 1.25rem; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
                                    <h5 style="margin-top: 0; margin-bottom: 0.5rem; color: #64748b; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700;">Constructive Feedback</h5>
                                    <p style="margin: 0; font-size: 0.95rem; color: #334155; line-height: 1.6;">Keep up the great work.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }
        """)

        page.wait_for_timeout(1000)

        # Open nav menu if it exists
        page.evaluate("""
            const nav = document.querySelector('.nav-links');
            if (nav) nav.classList.add('active');
        """)

        page.screenshot(path='/home/jules/verification/mobile_review.png', full_page=True)
        browser.close()

if __name__ == '__main__':
    verify_mobile()
