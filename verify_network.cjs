const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  let firebaseRequests = 0;
  let supabaseRequests = 0;

  page.on('request', request => {
    const url = request.url();
    if (url.includes('firebase') || url.includes('firestore') || url.includes('googleapis')) {
      firebaseRequests++;
      console.log('Firebase request:', url);
      // Wait, Playwright doesn't easily expose initiator without CDP, but we can check the resource type
      console.log('  Type:', request.resourceType());
    }
    if (url.includes('supabase.co')) {
      supabaseRequests++;
    }
  });

  console.log("Navigating to production site...");
  await page.goto('https://6a733a0f8441febd1cc77b81--frolicking-malasada-b1c28a.netlify.app/');
  
  // Wait a bit to see if any background requests happen
  await page.waitForTimeout(5000);

  const activeBackend = await page.evaluate(() => window.ACTIVE_BACKEND);
  console.log(`\nWindow ACTIVE_BACKEND: ${activeBackend}`);

  console.log(`\nResults:`);
  console.log(`Firebase/Firestore Network Requests: ${firebaseRequests}`);
  console.log(`Supabase Network Requests: ${supabaseRequests}`);

  await browser.close();
})();
