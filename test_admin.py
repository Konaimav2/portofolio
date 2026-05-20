from playwright.sync_api import sync_playwright

print("Running Admin UI Test...")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    
    # 1. Navigate to the Admin Panel
    page.goto('http://localhost:3001/admin.html')
    page.wait_for_load_state('networkidle')
    
    # 2. Test Login
    print("Testing Login...")
    password_input = page.locator('input[type="password"]')
    password_input.fill('admin')  # Default password in .env
    page.locator('button:has-text("Login")').click()
    
    # Wait for the dashboard to load by checking for the Logout button
    page.wait_for_selector('button:has-text("Logout")', timeout=5000)
    print("✅ Login successful!")
    
    # 3. Test Navigation Tabs
    print("Testing Navigation...")
    page.locator('.tab:has-text("Experience")').click()
    page.wait_for_selector('h3:has-text("Add Experience")')
    print("✅ Navigated to Experience tab")
    
    page.locator('.tab:has-text("Projects")').click()
    page.wait_for_selector('h3:has-text("Add New Project")')
    print("✅ Navigated to Projects tab")

    browser.close()
    print("🎉 All UI tests passed successfully!")
