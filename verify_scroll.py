from playwright.sync_api import sync_playwright

def verify_frontend():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Open page directly by file path
        page.goto("http://localhost:8000/index.html")
        page.evaluate("""
            () => {
                return new Promise((resolve) => {
                    const req = indexedDB.open('PlaybookDB', 1);
                    req.onsuccess = (e) => {
                        const db = e.target.result;
                        const tx = db.transaction(['sessions', 'students'], 'readwrite');

                        tx.objectStore('sessions').put({
                            id: 'test-session-123',
                            name: 'Mock Exam Session',
                            date: new Date().toISOString(),
                            status: 'Reviewing',
                            markingScheme: 'Mock scheme'
                        });

                        tx.objectStore('students').put({
                            id: 'student-1',
                            sessionId: 'test-session-123',
                            studentName: 'John Doe',
                            pages: [],
                            grading: {
                                totalScore: 7,
                                maxScore: 10,
                                questions: [
                                    {
                                        questionId: '1a',
                                        questionTitle: 'Define Photosynthesis',
                                        marks_awarded: 3,
                                        max_marks: 5,
                                        justification: 'The student correctly identified the process but missed the role of chlorophyll as per the marking scheme.',
                                        constructive_feedback: 'Make sure to mention all key components of the process, including the specific pigments involved.'
                                    },
                                    {
                                        questionId: '1b(i)',
                                        questionTitle: 'Identify the balanced equation',
                                        marks_awarded: 4,
                                        max_marks: 5,
                                        justification: 'Equation is balanced but state symbols are missing.',
                                        constructive_feedback: 'Always include state symbols (s, l, g, aq) in chemical equations unless instructed otherwise.'
                                    },
                                    {
                                        questionId: '2',
                                        questionTitle: 'Explain the difference between plant and animal cells.',
                                        marks_awarded: 8,
                                        max_marks: 10,
                                        justification: 'Good explanation of cell wall and chloroplasts. Missed vacuole differences.',
                                        constructive_feedback: 'Also mention the size difference of vacuoles in plant vs animal cells.'
                                    },
                                    {
                                        questionId: '3',
                                        questionTitle: 'Draw a diagram of a leaf cross-section.',
                                        marks_awarded: 5,
                                        max_marks: 10,
                                        justification: 'Basic layers are present but lack detail.',
                                        constructive_feedback: 'Include more detail in the spongy mesophyll layer and clearly label the stomata.'
                                    }
                                ]
                            }
                        });

                        tx.oncomplete = () => resolve();
                    };
                });
            }
        """)

        page.goto("http://localhost:8000/review.html?session=test-session-123")
        page.wait_for_selector('.grading-item') # Wait for JS to render the items

        # Scroll the grading panel down to see if it works properly
        page.evaluate("document.querySelector('.grading-panel').scrollTop = document.querySelector('.grading-panel').scrollHeight")
        page.wait_for_timeout(500)

        # Take a screenshot to verify the new granular UI format and the scroll fix
        page.screenshot(path="review_page_scrolled.png")

        browser.close()

if __name__ == "__main__":
    verify_frontend()
