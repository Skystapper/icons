import puppeteer from 'puppeteer';
import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'glb');
const COOKIES_PATH = path.join(__dirname, 'cookies.json');

// Ensure output directory exists
fs.ensureDirSync(OUTPUT_DIR);

// Known PixCap 3D icon slugs to download
const ICON_SLUGS = [
  'cursor-arrow-active-animated-3d-icon-1620202589713',
  'checkmark-success-green-animated-3d-icon-1616629774336',
  'chat-conversation-blue-animated-3d-icon-1614249414671'
  // Add more icon slugs here as needed
];

async function main() {
  console.log('Starting PixCap direct downloader...');
  
  // Load cookies if they exist
  let cookies = [];
  try {
    if (fs.existsSync(COOKIES_PATH)) {
      cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
      console.log('Loaded cookies from file');
    } else {
      console.log('No cookies file found. Run login.js first or the script will run in interactive mode.');
    }
  } catch (error) {
    console.error(`Error loading cookies: ${error.message}`);
  }
  
  const browser = await puppeteer.launch({
    headless: false, // Use non-headless mode for debugging
    defaultViewport: null,
    args: ['--start-maximized']
  });
  
  try {
    const page = await browser.newPage();
    
    // Enable verbose logging
    page.on('console', message => console.log(`Browser console: ${message.text()}`));
    
    // Set cookies if available
    if (cookies.length > 0) {
      await page.setCookie(...cookies);
      console.log('Set session cookies from file');
    } else {
      console.log('No cookies available. Please log in manually when the browser opens.');
    }
    
    // Navigate to PixCap homepage to check login status
    await page.goto('https://pixcap.com', { 
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    
    // Check if we need to login
    const isLoggedIn = await page.evaluate(() => {
      const loginElements = document.querySelectorAll('[href="/login"]');
      return loginElements.length === 0;
    });
    
    console.log(`Login status: ${isLoggedIn ? 'Logged in' : 'Not logged in'}`);
    
    if (!isLoggedIn) {
      console.log('Not logged in. Please log in manually...');
      
      // Navigate to login page
      await page.goto('https://pixcap.com/login', { waitUntil: 'networkidle2' });
      
      // Wait for user to manually log in
      console.log('Please log in manually in the browser window...');
      await page.waitForNavigation({ 
        waitUntil: 'networkidle2',
        timeout: 300000 // 5 minutes timeout
      });
      
      // Save cookies for future runs
      const newCookies = await page.cookies();
      await fs.writeFile(COOKIES_PATH, JSON.stringify(newCookies, null, 2));
      console.log('Saved new session cookies for future runs');
    }
    
    // Process each icon slug
    for (const iconSlug of ICON_SLUGS) {
      try {
        console.log(`\nProcessing icon: ${iconSlug}`);
        
        // Create a mapped function to capture the iconSlug in closure
        const responseHandler = createResponseHandler(iconSlug);
        
        // Add the response listener
        page.on('response', responseHandler);
        
        // Visit the design creation page
        console.log(`Navigating to: https://pixcap.com/design/create?slug=${iconSlug}`);
        await page.goto(`https://pixcap.com/design/create?slug=${iconSlug}`, {
          waitUntil: 'networkidle2',
          timeout: 60000 // Extended timeout for page load
        });
        
        // Take a screenshot for debugging
        await page.screenshot({ path: `${iconSlug}-page.png` });
        console.log(`Saved screenshot to ${iconSlug}-page.png`);
        
        // Wait for the page to load and redirect (using setTimeout instead of waitForTimeout)
        console.log('Waiting for redirect and API requests...');
        await new Promise(resolve => setTimeout(resolve, 10000)); // 10 second wait
        
        // Get the new URL after redirect
        const currentUrl = page.url();
        console.log(`Current URL after redirect: ${currentUrl}`);
        
        // If the URL has a UUID, capture it directly
        const urlMatch = currentUrl.match(/\/design\/([a-f0-9-]+)/i);
        if (urlMatch && urlMatch[1]) {
          const uuid = urlMatch[1];
          console.log(`Extracted UUID from URL: ${uuid}`);
          
          // Directly access the presigned URL endpoint
          const presignedUrl = `https://pixcap.com/api/v1/assetmanager/presigned/loadProject/${uuid}?lang=en`;
          console.log(`Accessing presigned URL endpoint: ${presignedUrl}`);
          
          // Use the page to fetch the presigned URL
          const presignedResponse = await page.evaluate(async (url) => {
            try {
              const response = await fetch(url);
              if (!response.ok) {
                return { error: `HTTP error! status: ${response.status}` };
              }
              const data = await response.json();
              return data;
            } catch (error) {
              return { error: error.toString() };
            }
          }, presignedUrl);
          
          console.log('Presigned response:', presignedResponse);
          
          if (presignedResponse && presignedResponse.presignedUrl) {
            await downloadGlbFile(presignedResponse.presignedUrl, iconSlug, uuid);
          } else if (presignedResponse.error) {
            console.error(`Error getting presigned URL: ${presignedResponse.error}`);
          } else {
            console.error('No presigned URL found in response');
          }
        } else {
          console.log('No UUID found in URL. The page may not have redirected properly.');
          console.log('Checking page content for clues...');
          
          // Save page HTML for debugging
          const pageContent = await page.content();
          fs.writeFileSync(`${iconSlug}-debug.html`, pageContent);
          console.log(`Saved page HTML to ${iconSlug}-debug.html for inspection`);
          
          // Try to extract UUID from the page content
          const pageUuid = await page.evaluate(() => {
            // Look for UUID in various places
            const metaTags = document.querySelectorAll('meta[content*="-"]');
            for (const tag of metaTags) {
              const content = tag.getAttribute('content');
              const match = content.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
              if (match) return match[1];
            }
            
            // Look in script tags
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
              const text = script.textContent;
              if (text) {
                const match = text.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
                if (match) return match[1];
              }
            }
            
            return null;
          });
          
          if (pageUuid) {
            console.log(`Found UUID in page content: ${pageUuid}`);
            
            // Try with the extracted UUID
            const extractedPresignedUrl = `https://pixcap.com/api/v1/assetmanager/presigned/loadProject/${pageUuid}?lang=en`;
            console.log(`Trying with extracted UUID: ${extractedPresignedUrl}`);
            
            // Use the page to fetch the presigned URL
            const presignedResponse = await page.evaluate(async (url) => {
              try {
                const response = await fetch(url);
                if (!response.ok) {
                  return { error: `HTTP error! status: ${response.status}` };
                }
                const data = await response.json();
                return data;
              } catch (error) {
                return { error: error.toString() };
              }
            }, extractedPresignedUrl);
            
            if (presignedResponse && presignedResponse.presignedUrl) {
              await downloadGlbFile(presignedResponse.presignedUrl, iconSlug, pageUuid);
            } else if (presignedResponse.error) {
              console.error(`Error getting presigned URL with extracted UUID: ${presignedResponse.error}`);
            }
          }
        }
        
        // Remove the response listener
        page.removeListener('response', responseHandler);
        
      } catch (error) {
        console.error(`Error processing icon ${iconSlug}: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error(`An error occurred: ${error.message}`);
  } finally {
    await browser.close();
    console.log('Download completed');
  }
}

// Create a response handler function that captures the iconSlug in closure
function createResponseHandler(iconSlug) {
  return async function(response) {
    const url = response.url();
    
    if (url.includes('/api/v1/assetmanager/presigned/loadProject/')) {
      console.log(`Intercepted presigned URL response: ${url}`);
      
      try {
        const responseData = await response.json();
        
        if (responseData && responseData.presignedUrl) {
          const presignedUrl = responseData.presignedUrl;
          const iconUuid = url.split('/').pop().split('?')[0];
          
          console.log(`Found presigned URL for icon: ${iconSlug} (UUID: ${iconUuid})`);
          
          await downloadGlbFile(presignedUrl, iconSlug, iconUuid);
        }
      } catch (jsonError) {
        console.error(`Error parsing response JSON: ${jsonError.message}`);
      }
    }
  };
}

// Function to download the .glb file
async function downloadGlbFile(presignedUrl, iconSlug, iconUuid) {
  try {
    console.log(`Downloading .glb from: ${presignedUrl}`);
    
    const glbResponse = await axios.get(presignedUrl, { 
      responseType: 'arraybuffer',
      timeout: 30000 // 30 second timeout
    });
    
    // Save with both slug and UUID for reference
    const filename = `${iconSlug}__${iconUuid}.glb`;
    const outputPath = path.join(OUTPUT_DIR, filename);
    
    await fs.writeFile(outputPath, Buffer.from(glbResponse.data));
    console.log(`Successfully downloaded: ${filename}`);
    
    // Save a mapping file just for reference
    const mappingPath = path.join(OUTPUT_DIR, 'icon-mappings.json');
    let mappings = {};
    
    // Try to load existing mappings if available
    if (fs.existsSync(mappingPath)) {
      try {
        mappings = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
      } catch (e) {
        console.error(`Error reading existing mappings: ${e.message}`);
      }
    }
    
    // Add the new mapping
    mappings[iconSlug] = iconUuid;
    
    // Save the updated mappings
    await fs.writeFile(mappingPath, JSON.stringify(mappings, null, 2));
    
  } catch (dlError) {
    console.error(`Error downloading .glb file: ${dlError.message}`);
  }
}

main().catch(console.error); 