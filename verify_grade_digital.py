from playwright.sync_api import sync_playwright

def run_cuj(page):
    # Mock auth and DB so we can load the page without Supabase connectivity
    page.add_init_script("""
        localStorage.setItem('playbook_session', JSON.stringify({ role: 'professor' }));
        window.PlaybookDB = {
            getSession: async () => ({ id: 'sess1', name: 'Assignment 1', session_type: 'digital', publish_status: 'draft' }),
            getCourses: async () => [{ id: 'c1', name: 'Software Engineering 101' }],
            getSessionsByCourse: async () => [
                { id: 'sess1', name: 'Assignment 1', session_type: 'digital', publish_status: 'draft' }
            ],
            getSubmissionsBySession: async () => [
                { id: 'sub1', student_id: 'stu1', file_url: 'dummy.pdf' },
                { id: 'sub2', student_id: 'stu2', file_url: 'dummy2.pdf' }
            ],
            updateSession: async () => ({ id: 'sess1' })
        };
    """)
    page.goto("http://localhost:3000/grade_digital.html?session_id=sess1")
    page.wait_for_timeout(2000)

    # 1. Initial State
    page.screenshot(path="/home/jules/verification/screenshots/grade_digital_initial.png")
    page.wait_for_timeout(500)

    # 2. Fill Marking Scheme
    page.locator("#raw-scheme-text").fill("1. Question 1 (10 marks)\n2. Question 2 (10 marks)")
    page.wait_for_timeout(500)
    page.locator("#total-marks").fill("20")
    page.wait_for_timeout(500)

    # 3. Trigger Grading Action
    # we don't want to actually call the AI in the playwright script, but we can verify the button is clickable
    page.get_by_role("button", name="Grade All Submissions").hover()

    page.screenshot(path="/home/jules/verification/screenshots/grade_digital_ready.png")
    page.wait_for_timeout(1000)


if __name__ == "__main__":
    import os
    os.makedirs("/home/jules/verification/videos", exist_ok=True)
    os.makedirs("/home/jules/verification/screenshots", exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            record_video_dir="/home/jules/verification/videos"
        )
        page = context.new_page()
        try:
            run_cuj(page)
        finally:
            context.close()
            browser.close()
