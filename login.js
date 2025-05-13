import puppeteer from 'puppeteer';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIES_PATH = path.join(__dirname, 'cookies.json');

/**
 * Utility script to extract PixCap login cookies
 * 
 * Run this script first to login and save cookies,
 * then the main scraper will use these cookies.
 */
async function extractCookies() {
  console.log('Starting login session to extract cookies...');
  
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized']
  });
  
  try {
    const page = await browser.newPage();
    
    // Navigate to PixCap
    await page.goto('https://pixcap.com/login', { 
      waitUntil: 'networkidle2' 
    });
    
    console.log('Please login to your PixCap account in the browser window...');
    console.log('After successful login, this script will save your session cookies.');
    console.log('Wait for the page to fully load to ensure all cookies are saved.');
    
    // Wait for navigation to dashboard after login
    // This selector might need to be updated based on PixCap's current UI
    await page.waitForSelector('.dashboard, .user-profile, .user-menu', {
      timeout: 300000 // 5 minutes timeout for manual login
    });
    
    console.log('Login detected, extracting cookies...');
    
    // Get cookies
    const cookies = await page.cookies();
    
    // Save cookies to file
    await fs.writeFile(
      COOKIES_PATH,
      JSON.stringify(cookies, null, 2)
    );
    
    console.log(`Successfully saved cookies to ${COOKIES_PATH}`);
    console.log('You can now run the main scraper script.');
    
  } catch (error) {
    console.error(`An error occurred: ${error.message}`);
  } finally {
    await browser.close();
  }
}

extractCookies().catch(console.error); 