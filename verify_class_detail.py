from playwright.sync_api import sync_playwright

def run_cuj(page):
    # Mock auth and DB so we can load the page without Supabase connectivity
    page.add_init_script("""
        localStorage.setItem('playbook_session', JSON.stringify({ role: 'professor' }));
        const mockDB = {
            getCourse: async () => ({ id: 'test_course_id', name: 'Software Engineering 101', join_code: 'SE101X' }),
            getSessionsForCourse: async () => [
                { id: '1', name: 'Midterm Exam', session_type: 'physical', created_at: new Date().toISOString(), due_date: null, publish_status: 'draft' },
                { id: '2', name: 'Assignment 1', session_type: 'digital', created_at: new Date().toISOString(), due_date: new Date(Date.now() + 86400000).toISOString(), publish_status: 'draft' }
            ],
            getStudentsForCourse: async () => [
                { id: 's1', student_name: 'Alice Smith', registration_number: 'REG001' },
                { id: 's2', student_name: 'Bob Jones', registration_number: 'REG002' }
            ],
            getCourseMaterials: async () => [],
            createSession: async () => ({ id: 'new_session_id' })
        };
        Object.defineProperty(window, 'PlaybookDB', { writable: false, value: mockDB });
    """)
    page.goto("http://localhost:3000/class_detail.html?id=test_course_id")
    page.wait_for_timeout(2000)

    # Click Materials tab first using javascript to bypass any overlay issues
    page.evaluate("document.querySelector('button.tab-btn[data-tab=\"materials-tab\"]').click()")
    page.wait_for_timeout(500)

    # Click Upload Material to open modal
    page.evaluate("document.querySelector('#upload-material-btn').click()")
    page.wait_for_timeout(500)
    page.screenshot(path="/home/jules/verification/screenshots/class_detail_upload_modal.png")
    page.wait_for_timeout(500)

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(record_video_dir="/home/jules/verification/videos")
        page = context.new_page()
        try:
            run_cuj(page)
        finally:
            context.close()
            browser.close()
