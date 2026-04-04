from playwright.sync_api import sync_playwright

def run_cuj(page):
    page.add_init_script("""
        localStorage.setItem('playbook_session', JSON.stringify({
            role: 'professor',
            user_id: 'prof1'
        }));
        Object.defineProperty(window, 'PlaybookDB', {
            writable: false,
            value: {
                getCourses: async () => [{ id: 'c1', name: 'Software Engineering 101' }],
                saveSession: async () => ({ id: 'sess1' })
            }
        });

        Object.defineProperty(window, 'supabaseClient', {
             writable: false,
             value: {
                 storage: {
                     from: () => ({
                         upload: async () => ({ data: { path: 'dummy/path' }, error: null })
                     })
                 },
                 from: () => ({
                     update: () => ({
                         eq: async () => ({ data: null, error: null })
                     })
                 })
             }
        });

        // Mock Queue
        window.PlaybookQueue = {
            getFirstPendingSession: async () => null,
            saveMeta: async () => {},
            saveChunk: async () => {},
            getCompletedCount: async () => 0,
            getNextPendingChunk: async () => null,
            getPendingCount: async () => 0
        };

    """)
    page.goto("http://localhost:3000/upload.html")
    page.wait_for_timeout(2000)

    # 1. Fill basic details
    page.locator("#session-name").fill("Midterm Exam")
    page.wait_for_timeout(500)

    # Wait for course select to populate and select it
    page.locator("#course-select").select_option("c1")
    page.wait_for_timeout(500)

    page.locator("#total-exam-marks").fill("100")
    page.wait_for_timeout(500)

    # 2. Fill Marking Scheme
    page.locator("#raw-scheme-text").fill("1. Q1: 5 marks\n2. Q2: 5 marks")
    page.wait_for_timeout(500)

    # 3. Upload a file
    # We will just dispatch a change event to mock file selection,
    # but the actual file needs to be real enough to pass the File validation,
    # or we can mock the submit handler locally in the test if needed.
    # For this verification, we just want to show the UI filled out correctly and ready to submit.

    # Mocking file upload
    with open("dummy_exam.pdf", "wb") as f:
        f.write(b"%PDF-1.4 dummy pdf content")

    page.locator("#exams-file").set_input_files("dummy_exam.pdf")
    page.wait_for_timeout(1000)

    page.screenshot(path="/home/jules/verification/screenshots/upload_ready.png")
    page.wait_for_timeout(500)

    # Mocking the AI so it doesn't try to parse real PDF
    page.evaluate("""
        window.PlaybookAI = {
            extractMarkingSchemeOCR: async () => "dummy text"
        };
        // Stub pdfjs so it doesn't fail
        window['pdfjs-dist/build/pdf'] = {
            GlobalWorkerOptions: { workerSrc: '' },
            getDocument: () => ({
                promise: Promise.resolve({
                    numPages: 1,
                    getPage: async () => ({
                        getViewport: () => ({ width: 100, height: 100 }),
                        render: () => ({ promise: Promise.resolve() })
                    })
                })
            })
        };
    """)

    # Click start grading to trigger the logic that updates the session
    # (The chunking logic will run with our stubbed pdfjs)
    page.get_by_role("button", name="Start Playbook Grading").click()
    page.wait_for_timeout(2000)

    page.screenshot(path="/home/jules/verification/screenshots/upload_processing.png")
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
