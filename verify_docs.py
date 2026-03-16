from playwright.sync_api import sync_playwright

def verify_frontend():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Verify Manual Page
        page.goto("http://localhost:8000/manual.html#standard-marking-scheme")
        page.wait_for_selector('#standard-marking-scheme')
        page.screenshot(path="manual_scheme_format.png", full_page=True)

        # Verify Upload Page Quick-Reference Guide
        page.goto("http://localhost:8000/upload.html")
        page.wait_for_selector('#scheme-zone')
        page.screenshot(path="upload_quick_reference.png", full_page=True)

        browser.close()

if __name__ == "__main__":
    verify_frontend()
