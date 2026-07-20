const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  page.on('requestfailed', request => console.log('REQUEST FAILED:', request.url(), request.failure().errorText));

  // Set fake localStorage to simulate logged-in user with onboarding completed
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('mindset_token', 'fake-token');
    localStorage.setItem('hasCompletedOnboarding', 'true');
    localStorage.setItem('mindset_ai_name', 'AHA');
    localStorage.setItem('mindset_user_name', 'User');
  });

  console.log("Navigating to localhost:5173...");
  await page.goto('http://localhost:5173');
  
  console.log("Waiting for Activer le Systeme button...");
  await page.waitForSelector('.btn-primary');
  
  console.log("Clicking button...");
  await page.click('.btn-primary');
  
  console.log("Waiting 3 seconds...");
  await new Promise(r => setTimeout(r, 3000));
  
  console.log("Taking screenshot...");
  await page.screenshot({ path: 'screenshot.png' });
  
  console.log("Done.");
  await browser.close();
})();
