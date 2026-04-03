from playwright.sync_api import sync_playwright

def run_cuj(page):
    # Mock auth and DB so we can load the page without Supabase connectivity
    page.add_init_script("""
        localStorage.setItem('playbook_session', JSON.stringify({ role: 'professor' }));
        window.PlaybookDB = {
            getCourseById: async () => ({ id: 'test_course_id', name: 'Software Engineering 101', join_code: 'SE101X' }),
            getSessionsByCourse: async () => [
                { id: '1', name: 'Midterm Exam', session_type: 'physical', created_at: new Date().toISOString(), due_date: null, publish_status: 'draft' },
                { id: '2', name: 'Assignment 1', session_type: 'digital', created_at: new Date().toISOString(), due_date: new Date(Date.now() + 86400000).toISOString(), publish_status: 'draft' }
            ],
            getStudentsByCourse: async () => [
                { id: 's1', student_name: 'Alice Smith', registration_number: 'REG001' },
                { id: 's2', student_name: 'Bob Jones', registration_number: 'REG002' }
            ],
            createSession: async () => ({ id: 'new_session_id' })
        };
    """)
    page.goto("http://localhost:3000/class_detail.html?id=test_course_id")
    page.wait_for_timeout(2000)

    # 1. View Assignments (default tab)
    page.screenshot(path="/home/jules/verification/screenshots/class_detail_assignments.png")
    page.wait_for_timeout(500)

    # 2. View Course Materials
    page.locator("button.tab-btn[data-tab='materials-tab']").click()
    page.wait_for_timeout(500)
    page.screenshot(path="/home/jules/verification/screenshots/class_detail_materials.png")

    # 3. View Student Roster
    page.locator("button.tab-btn[data-tab='students-tab']").click()
    page.wait_for_timeout(500)
    page.screenshot(path="/home/jules/verification/screenshots/class_detail_roster.png")

    # 4. Open Create Assignment Modal
    page.locator("button.tab-btn[data-tab='assignments-tab']").click()
    page.wait_for_timeout(500)
    page.get_by_role("button", name="Create Online Assignment").click()
    page.wait_for_timeout(500)

    page.locator("#new-assign-name").fill("Final Project Presentation")
    page.wait_for_timeout(500)
    page.locator("#new-assign-desc").fill("Submit your slides in PDF format.")
    page.wait_for_timeout(500)

    page.screenshot(path="/home/jules/verification/screenshots/class_detail_modal.png")
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
