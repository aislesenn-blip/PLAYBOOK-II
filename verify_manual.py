import time
from playwright.sync_api import sync_playwright

def verify_manual():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Check Dashboard Navigation
        page.goto("http://localhost:8000/index.html")
        page.screenshot(path="dashboard_nav.png")

        # Click on User Manual Link
        page.click("text=User Manual")
        time.sleep(1) # wait for render

        # Verify Manual page
        assert page.url.endswith("manual.html")
        page.screenshot(path="manual_page.png", full_page=True)

        print("Successfully navigated to manual page and captured full page screenshot.")
        browser.close()

if __name__ == "__main__":
    verify_manual()