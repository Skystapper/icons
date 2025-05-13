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

// Example item URLs from PixCap to download (this matches the format you found)
const ITEM_URLS = [
  '/item/move-animated-3d-icon-1356142536261',
  // Add more items here
];

async function main() {
  console.log('Starting PixCap item direct downloader...');
  
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
    
    // Process each item URL
    for (const itemUrl of ITEM_URLS) {
      try {
        const itemSlug = itemUrl.split('/').pop();
        console.log(`\nProcessing item: ${itemSlug}`);
        
        // Navigate to the item page
        const fullItemUrl = `https://pixcap.com${itemUrl}`;
        console.log(`Navigating to: ${fullItemUrl}`);
        
        await page.goto(fullItemUrl, {
          waitUntil: 'networkidle2',
          timeout: 60000
        });
        
        // Take a screenshot for debugging
        await page.screenshot({ path: `${itemSlug}-page.png` });
        console.log(`Saved screenshot to ${itemSlug}-page.png`);
        
        // Look for the "Use in Editor" button
        console.log('Looking for "Use in Editor" button or similar...');
        
        // Extract the design link
        const designUrl = await page.evaluate(() => {
          // Try different button/link selectors
          const editorBtn = document.querySelector('a[href*="/design/create"], button[data-action="editor"], a.editor-button');
          
          if (editorBtn) {
            if (editorBtn.tagName === 'A') {
              return editorBtn.href;
            } else {
              const dataUrl = editorBtn.getAttribute('data-url');
              if (dataUrl) return dataUrl;
            }
          }
          
          // Fallback to looking for data attributes with the design link
          const elements = document.querySelectorAll('[data-design-url], [data-editor-url]');
          for (const el of elements) {
            const url = el.getAttribute('data-design-url') || el.getAttribute('data-editor-url');
            if (url) return url;
          }
          
          // Look for any links to design/create
          const links = Array.from(document.querySelectorAll('a'));
          for (const link of links) {
            if (link.href && link.href.includes('/design/create')) {
              return link.href;
            }
          }
          
          return null;
        });
        
        if (!designUrl) {
          console.log('No design URL found. Saving page content for analysis...');
          const pageContent = await page.content();
          fs.writeFileSync(`${itemSlug}-debug.html`, pageContent);
          console.log(`Saved page HTML to ${itemSlug}-debug.html for inspection`);
          continue;
        }
        
        console.log(`Found design URL: ${designUrl}`);
        
        // Create response interceptor for this item
        const responseHandler = createResponseHandler(itemSlug);
        page.on('response', responseHandler);
        
        // Navigate to the design page
        await page.goto(designUrl, {
          waitUntil: 'networkidle2',
          timeout: 60000
        });
        
        // Wait for redirection and processing
        console.log('Waiting for redirect and API requests...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // Get the current URL after possible redirects
        const currentUrl = page.url();
        console.log(`Current URL after redirect: ${currentUrl}`);
        
        // Extract UUID from the URL if available
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
            await downloadGlbFile(presignedResponse.presignedUrl, itemSlug, uuid);
          } else if (presignedResponse.error) {
            console.error(`Error getting presigned URL: ${presignedResponse.error}`);
          } else {
            console.error('No presigned URL found in response');
          }
        } else {
          console.log('No UUID found in URL. Trying to find it in page content...');
          
          // Save page HTML for debugging
          const pageContent = await page.content();
          fs.writeFileSync(`${itemSlug}-debug.html`, pageContent);
          
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
              await downloadGlbFile(presignedResponse.presignedUrl, itemSlug, pageUuid);
            } else if (presignedResponse.error) {
              console.error(`Error getting presigned URL with extracted UUID: ${presignedResponse.error}`);
            }
          }
        }
        
        // Remove the response listener
        page.removeListener('response', responseHandler);
        
      } catch (error) {
        console.error(`Error processing item ${itemUrl}: ${error.message}`);
      }
    }
    
    // After processing all direct items, try to find more from the PixCap 3D icon packs page
    console.log('\nLooking for additional 3D icons on the icon packs page...');
    
    await page.goto('https://pixcap.com/3d-icon-packs', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    
    // Take a screenshot
    await page.screenshot({ path: 'icon-packs-page.png' });
    
    // Extract item URLs from the page
    const additionalItems = await page.evaluate(() => {
      const itemLinks = [];
      
      // Look for all item links based on the provided XPath structure
      // In JavaScript, we'll use querySelectorAll instead
      const items = document.querySelectorAll('a[href^="/item/"]');
      
      for (const item of items) {
        itemLinks.push(item.getAttribute('href'));
      }
      
      if (itemLinks.length === 0) {
        // Try alternative selectors
        const cards = document.querySelectorAll('[data-v-24e913ac]');
        for (const card of cards) {
          const links = card.querySelectorAll('a[href*="/item/"]');
          for (const link of links) {
            itemLinks.push(link.getAttribute('href'));
          }
        }
      }
      
      return itemLinks;
    });
    
    console.log(`Found ${additionalItems.length} additional items on the page`);
    
    if (additionalItems.length > 0) {
      // Save the list of items for reference
      fs.writeFileSync('found-items.json', JSON.stringify(additionalItems, null, 2));
      console.log('Saved list of found items to found-items.json');
      
      // Process ALL of these items, not just the first 5
      console.log(`Processing all ${additionalItems.length} additional items...`);
      
      for (const itemUrl of additionalItems) {
        try {
          const itemSlug = itemUrl.split('/').pop();
          console.log(`\nProcessing additional item: ${itemSlug}`);
          
          // Navigate to the item page
          const fullItemUrl = `https://pixcap.com${itemUrl}`;
          console.log(`Navigating to: ${fullItemUrl}`);
          
          await page.goto(fullItemUrl, {
            waitUntil: 'networkidle2',
            timeout: 60000
          });
          
          // Take a screenshot for debugging
          await page.screenshot({ path: `${itemSlug}-page.png` });
          
          // Extract the "Use in Editor" link
          const editorLink = await page.evaluate(() => {
            // Try to find the use in editor button/link
            const editorBtn = document.querySelector('a[href*="/design/create"], button[data-action="editor"]');
            if (editorBtn) {
              if (editorBtn.tagName === 'A') {
                return editorBtn.href;
              } else {
                return editorBtn.getAttribute('data-url');
              }
            }
            return null;
          });
          
          if (editorLink) {
            console.log(`Found editor link for ${itemSlug}: ${editorLink}`);
            
            // Create response interceptor
            const responseHandler = createResponseHandler(itemSlug);
            page.on('response', responseHandler);
            
            // Visit the editor link
            await page.goto(editorLink, {
              waitUntil: 'networkidle2',
              timeout: 60000
            });
            
            // Wait for redirection and processing
            await new Promise(resolve => setTimeout(resolve, 10000));
            
            // Remove the response listener
            page.removeListener('response', responseHandler);
          } else {
            console.log(`No editor link found for ${itemSlug}`);
          }
          
        } catch (error) {
          console.error(`Error processing additional item: ${error.message}`);
        }
      }
    }
    
  } catch (error) {
    console.error(`An error occurred: ${error.message}`);
  } finally {
    await browser.close();
    console.log('Download completed');
  }
}

// Create a response handler function to catch the presigned URL responses
function createResponseHandler(itemSlug) {
  return async function(response) {
    const url = response.url();
    
    if (url.includes('/api/v1/assetmanager/presigned/loadProject/')) {
      console.log(`Intercepted presigned URL response: ${url}`);
      
      try {
        const responseData = await response.json();
        
        if (responseData && responseData.presignedUrl) {
          const presignedUrl = responseData.presignedUrl;
          const itemUuid = url.split('/').pop().split('?')[0];
          
          console.log(`Found presigned URL for item: ${itemSlug} (UUID: ${itemUuid})`);
          
          await downloadGlbFile(presignedUrl, itemSlug, itemUuid);
        }
      } catch (jsonError) {
        console.error(`Error parsing response JSON: ${jsonError.message}`);
      }
    }
  };
}

// Function to download the .glb file
async function downloadGlbFile(presignedUrl, itemSlug, itemUuid) {
  try {
    console.log(`Downloading .glb from: ${presignedUrl}`);
    
    const glbResponse = await axios.get(presignedUrl, { 
      responseType: 'arraybuffer',
      timeout: 30000 // 30 second timeout
    });
    
    // Save with both slug and UUID for reference
    const filename = `${itemSlug}__${itemUuid}.glb`;
    const outputPath = path.join(OUTPUT_DIR, filename);
    
    await fs.writeFile(outputPath, Buffer.from(glbResponse.data));
    console.log(`Successfully downloaded: ${filename}`);
    
    // Save a mapping file just for reference
    const mappingPath = path.join(OUTPUT_DIR, 'item-mappings.json');
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
    mappings[itemSlug] = itemUuid;
    
    // Save the updated mappings
    await fs.writeFile(mappingPath, JSON.stringify(mappings, null, 2));
    
  } catch (dlError) {
    console.error(`Error downloading .glb file: ${dlError.message}`);
  }
}

main().catch(console.error); 