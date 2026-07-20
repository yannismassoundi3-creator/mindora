const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  page.on('requestfailed', request => console.log('REQUEST FAILED:', request.url(), request.failure().errorText));

  await page.setViewport({ width: 1920, height: 1080 });

  // Set fake localStorage to simulate logged-in user with onboarding completed
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('mindset_token', 'fake-token');
    localStorage.setItem('hasCompletedOnboarding', 'true');
    localStorage.setItem('mindset_ai_name', 'AHA');
    localStorage.setItem('mindset_user_name', 'User');
  });

  console.log("Navigating to https://mindora-brown-one.vercel.app...");
  await page.goto('https://mindora-brown-one.vercel.app', { waitUntil: 'networkidle2' });
  
  console.log("Waiting 1 second for React to render...");
  await new Promise(r => setTimeout(r, 1000));
  
  console.log("Clicking Activer le Systeme...");
  await page.click('.welcome-btn');
  
  console.log("Waiting 2 seconds for Dashboard to render...");
  await new Promise(r => setTimeout(r, 2000));
  
  await page.screenshot({ path: 'screenshot.png' });
  console.log("Screenshot saved to screenshot.png");
  
  console.log("PAGE HTML AFTER CLICK:");
  const html = await page.content();
  console.log(html);
  
  await browser.close();
  const content = await page.content();
  console.log("PAGE HTML AFTER CLICK:");
  console.log(content.substring(0, 1000));
  if (content.length > 1000) console.log(content.substring(content.length - 1000));

  console.log("Done.");
  await browser.close();
})();
