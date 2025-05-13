import puppeteer from 'puppeteer';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIES_PATH = path.join(__dirname, 'cookies.json');
const ITEMS_PATH = path.join(__dirname, 'all-items.json');
const PACKS_PATH = path.join(__dirname, 'all-packs.json');
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');

// Create download directory if it doesn't exist
fs.ensureDirSync(DOWNLOAD_DIR);

async function main() {
  console.log('Starting PixCap item finder and downloader...');
  
  // Load existing items if available
  let allItems = {};
  if (fs.existsSync(ITEMS_PATH)) {
    try {
      allItems = JSON.parse(fs.readFileSync(ITEMS_PATH, 'utf8'));
      console.log(`Loaded ${Object.keys(allItems).length} existing items from file`);
    } catch (e) {
      console.error(`Error reading existing items: ${e.message}`);
    }
  }
  
  // Load existing packs if available
  let processedPacks = new Set();
  
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
    
    // Enable request and response logging
    await page.setRequestInterception(true);
    
    page.on('request', request => {
      request.continue();
    });
    
    // Set cookies if available
    if (cookies.length > 0) {
      await page.setCookie(...cookies);
      console.log('Set session cookies from file');
    } else {
      console.log('No cookies available. Please log in manually when the browser opens.');
    }
    
    // Function to save the items
    const saveItems = () => {
      fs.writeFileSync(ITEMS_PATH, JSON.stringify(allItems, null, 2));
      console.log(`Saved ${Object.keys(allItems).length} items to ${ITEMS_PATH}`);
    };
    
    // Step 1: Get all pack URLs from the main page
    console.log('\nExtracting all pack URLs from main page...');
    
    // Visit the 3D icon packs page
    await page.goto('https://pixcap.com/3d-icon-packs', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    
    // Take a screenshot of the main page
    await page.screenshot({ path: 'main-page.png' });
    
    // Function to collect all pack URLs from the current page
    const getPackUrls = async () => {
      return await page.evaluate(() => {
        const packLinks = Array.from(document.querySelectorAll('a[href^="/pack/"]'));
        return packLinks.map(link => {
          try {
            const urlObj = new URL(link.href);
            return urlObj.pathname;
          } catch (e) {
            return link.href;
          }
        }).filter((v, i, a) => a.indexOf(v) === i); // unique values only
      });
    };
    
    // Get all packs on the first page
    let allPackUrls = await getPackUrls();
    console.log(`Found ${allPackUrls.length} pack URLs on first page`);
    
    // Check if there are pagination links and navigate through all pages
    let currentPage = 1;
    let hasMorePages = true;
    
    while (hasMorePages) {
      // Check for next page button
      const hasNextPage = await page.evaluate(() => {
        const pagination = document.querySelector('.pagination, [class*="pagination"]');
        if (!pagination) return false;
        
        const nextButton = pagination.querySelector('[class*="next"], [aria-label*="next"]');
        return nextButton && !nextButton.disabled && !nextButton.classList.contains('disabled');
      });
      
      if (!hasNextPage) {
        hasMorePages = false;
        console.log('No more pagination found.');
        break;
      }
      
      // Click the next page button
      const nextPageClicked = await page.evaluate(() => {
        const nextButton = document.querySelector('.pagination [class*="next"], .pagination [aria-label*="next"]');
        if (nextButton) {
          nextButton.click();
          return true;
        }
        return false;
      });
      
      if (!nextPageClicked) {
        hasMorePages = false;
        console.log('Failed to click next page button.');
        break;
      }
      
      // Wait for the next page to load
      console.log('Waiting for next page to load...');
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(e => {
        console.error(`Navigation error: ${e.message}`);
        hasMorePages = false;
      });
      
      if (!hasMorePages) break;
      
      // Get packs from this page
      currentPage++;
      console.log(`Processing page ${currentPage} of packs...`);
      
      const pagePackUrls = await getPackUrls();
      console.log(`Found ${pagePackUrls.length} pack URLs on page ${currentPage}`);
      
      // Add unique URLs to our collection
      for (const url of pagePackUrls) {
        if (!allPackUrls.includes(url)) {
          allPackUrls.push(url);
        }
      }
    }
    
    // Show total unique packs found
    console.log(`Found ${allPackUrls.length} total unique pack URLs`);
    
    // Save all pack URLs to a file for reference
    fs.writeFileSync(PACKS_PATH, JSON.stringify(allPackUrls, null, 2));
    console.log(`Saved all pack URLs to ${PACKS_PATH}`);
    
    // Function to download a GLB file
    async function downloadGlbFile(item, page) {
      try {
        const itemSlug = typeof item === 'string' ? item.split('/').pop() : item.itemUrl.split('/').pop();
        console.log(`Downloading item: ${itemSlug}`);
        
        // Create pack folder
        const packFolder = path.join(DOWNLOAD_DIR, `${item.packName || 'unknown-pack'}`);
        fs.ensureDirSync(packFolder);

        let presignedUrl = null;
        
        // Create response listener
        const handleResponse = async (response) => {
          try {
            if (response.url().includes('/api/v1/assetmanager/presigned/loadProject/')) {
              const data = await response.json();
              if (data?.presignedUrl && data?.contentType === 'model/gltf-binary') {
                presignedUrl = data.presignedUrl;
                console.log(`Captured presigned URL: ${presignedUrl}`);
              }
            }
          } catch (e) {
            console.error('Error processing response:', e.message);
          }
        };

        // Add listener
        page.on('response', handleResponse);

        // Navigate directly to the editor URL pattern
        await page.goto(`https://pixcap.com/design/create?slug=${itemSlug}`, {
          waitUntil: 'networkidle2',
          timeout: 90000
        });

        // Wait for UUID-based redirect
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 });
        
        // Wait for API response
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Remove listener
        page.off('response', handleResponse);

        if (presignedUrl) {
          const response = await axios({
            method: 'GET',
            url: presignedUrl,
            responseType: 'arraybuffer',
            timeout: 30000
          });
          
          const filePath = path.join(packFolder, `${itemSlug}.glb`);
          fs.writeFileSync(filePath, response.data);
          console.log(`Successfully downloaded: ${itemSlug}.glb`);
          return true;
        }

        console.log(`Failed to find presigned URL for ${itemSlug}`);
        return false;
      } catch (error) {
        console.error(`Download error: ${error.message}`);
        return false;
      }
    }
    
    // Step 2: Process each pack to extract all icons and download them
    console.log('\nProcessing all packs to extract and download icons...');
    
    // Process each pack
    for (let i = 0; i < allPackUrls.length; i++) {
      const packUrl = allPackUrls[i];
      console.log(`\nProcessing pack ${i+1}/${allPackUrls.length}: ${packUrl}`);
      
      try {
        const fullPackUrl = `https://pixcap.com${packUrl}`;
        
        // Navigate to the pack page
        await page.goto(fullPackUrl, {
          waitUntil: 'networkidle2',
          timeout: 90000
        });
        
        // Extract pack name for better logging
        const packName = await page.evaluate(() => {
          const titleEl = document.querySelector('h1, .title, [class*="title"]');
          return titleEl ? titleEl.textContent.trim() : 'Unknown Pack';
        });
        
        console.log(`Pack name: ${packName}`);
        
        // Create folder for this pack
        const packFolder = path.join(DOWNLOAD_DIR, packName.replace(/[^\w\s]/gi, '_'));
        fs.ensureDirSync(packFolder);
        
        // Take a screenshot of the pack page
        const packSlug = packUrl.split('/').pop();
        const screenshotName = `pack-${packSlug}.png`;
        await page.screenshot({ path: screenshotName });
        
        // Find all item links on this pack page
        const getItemUrls = async () => {
          return await page.evaluate(() => {
            // Store found URLs
            const urls = new Set();
            
            // Helper function to scan elements for item links
            const scanForItemLinks = (elements) => {
              for (const el of elements) {
                if (el.href && el.href.includes('/item/')) {
                  urls.add(el.href);
                }
              }
            };
            
            // Strategy 1: Direct links to items
            scanForItemLinks(document.querySelectorAll('a[href*="/item/"]'));
            
            // Strategy 2: Links inside specific components (based on the XPath provided)
            const components = document.querySelectorAll('[data-v-24e913ac]');
            for (const comp of components) {
              scanForItemLinks(comp.querySelectorAll('a'));
            }
            
            // Strategy 3: Look for thumbnail grids and cards
            const cards = document.querySelectorAll('.card, .thumbnail, .asset-card, [class*="card"], [class*="item"]');
            for (const card of cards) {
              scanForItemLinks(card.querySelectorAll('a'));
            }
            
            // Strategy 4: Look for library tags
            const libraryTags = document.querySelectorAll('.library--info-tag, [class*="library"]');
            scanForItemLinks(libraryTags);
            
            // Return unique URLs
            return Array.from(urls).map(url => {
              try {
                const urlObj = new URL(url);
                return urlObj.pathname;
              } catch (e) {
                return url;
              }
            });
          });
        };
        
        // Get all items on the first page of the pack
        let packItemUrls = await getItemUrls();
        console.log(`Found ${packItemUrls.length} items on first page of pack`);
        
        // Check if this pack has pagination and navigate through all pages
        let packCurrentPage = 1;
        let packHasMorePages = true;
        
        while (packHasMorePages) {
          // Check for next page button
          const packHasNextPage = await page.evaluate(() => {
            const pagination = document.querySelector('.pagination, [class*="pagination"]');
            if (!pagination) return false;
            
            const nextButton = pagination.querySelector('[class*="next"], [aria-label*="next"]');
            return nextButton && !nextButton.disabled && !nextButton.classList.contains('disabled');
          });
          
          if (!packHasNextPage) {
            packHasMorePages = false;
            break;
          }
          
          // Click the next page button
          const packNextPageClicked = await page.evaluate(() => {
            const nextButton = document.querySelector('.pagination [class*="next"], .pagination [aria-label*="next"]');
            if (nextButton) {
              nextButton.click();
              return true;
            }
            return false;
          });
          
          if (!packNextPageClicked) {
            packHasMorePages = false;
            break;
          }
          
          // Wait for the next page to load
          console.log('Waiting for next page of items to load...');
          await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(e => {
            console.error(`Navigation error: ${e.message}`);
            packHasMorePages = false;
          });
          
          if (!packHasMorePages) break;
          
          // Get items from this page
          packCurrentPage++;
          console.log(`Processing page ${packCurrentPage} of items in pack...`);
          
          const pageItemUrls = await getItemUrls();
          console.log(`Found ${pageItemUrls.length} items on page ${packCurrentPage}`);
          
          // Add unique URLs to our collection
          for (const url of pageItemUrls) {
            if (!packItemUrls.includes(url)) {
              packItemUrls.push(url);
            }
          }
        }
        
        // Show total items found in this pack
        console.log(`Found ${packItemUrls.length} total unique items in pack: ${packName}`);
        
        // Process ALL items in this pack and download them immediately
        console.log(`Processing and downloading ALL items in pack: ${packName}...`);
        
        // Process and download ALL items in this pack
        for (let j = 0; j < packItemUrls.length; j++) {
          const itemUrl = packItemUrls[j];
          try {
            const itemSlug = itemUrl.split('/').pop();
            console.log(`\nProcessing item ${j+1}/${packItemUrls.length}: ${itemSlug}`);
            
            // Create item entry with pack info
            const itemData = {
              itemUrl: itemUrl,
              packName: packName,
              packUrl: packUrl
            };
            
            // Add to our collection
            allItems[itemSlug] = itemData;
            
            // Download the GLB file immediately
            await downloadGlbFile(itemData, page);
            
            // Save after each item to prevent data loss
            saveItems();
          } catch (itemError) {
            console.error(`Error processing item: ${itemError.message}`);
          }
        }
        
        console.log(`Completed processing and downloading all items in pack: ${packName}`);
        
      } catch (packError) {
        console.error(`Error processing pack: ${packError.message}`);
      }
      
      // Save after each pack
      saveItems();
    }
    
    // Final save
    saveItems();
    
    console.log('\nItem discovery and download completed!');
    console.log(`Found and processed a total of ${Object.keys(allItems).length} items from ${allPackUrls.length} packs`);
    
  } catch (error) {
    console.error(`An error occurred: ${error.message}`);
  } finally {
    await browser.close();
  }
}

main().catch(console.error); 