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

// Map to store slug to UUID mappings
const slugToUuidMap = new Map();

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

async function main() {
  console.log('Starting PixCap 3D icons scraper...');
  
  const browser = await puppeteer.launch({
    headless: false, // Using non-headless mode for debugging
    defaultViewport: null,
    args: ['--start-maximized']
  });
  
  try {
    const page = await browser.newPage();
    
    // Set cookies if available
    if (cookies.length > 0) {
      await page.setCookie(...cookies);
      console.log('Set session cookies from file');
    } else {
      console.log('No cookies available. Please log in manually when the browser opens.');
    }
    
    // Navigate to icon packs list page
    await page.goto('https://pixcap.com/3d-icon-packs', { 
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    console.log('Loaded icon packs page');
    
    // Take a screenshot for debugging
    await page.screenshot({ path: 'debug-screenshot.png' });
    console.log('Took debug screenshot - check debug-screenshot.png');
    
    // Check if we need to login
    const isLoggedIn = await page.evaluate(() => {
      // Check for login elements, adjust selectors as needed
      const loginElements = document.querySelectorAll('[href="/login"]');
      return loginElements.length === 0;
    });
    
    console.log(`Login status: ${isLoggedIn ? 'Logged in' : 'Not logged in'}`);
    
    if (!isLoggedIn) {
      console.log('Not logged in. Please log in to continue...');
      
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
      
      // Go back to the icon packs page
      await page.goto('https://pixcap.com/3d-icon-packs', { waitUntil: 'networkidle2' });
    }
    
    // Collect all pack URLs from the main page
    console.log('Extracting pack URLs from the page...');
    const packUrls = await page.evaluate(() => {
      // Look for all pack card links
      const cards = Array.from(document.querySelectorAll('a[href^="/pack/"]'));
      console.log('Found ' + cards.length + ' pack cards');
      
      // If no cards found with that selector, try a more generic approach
      if (cards.length === 0) {
        const allLinks = Array.from(document.querySelectorAll('a'));
        return allLinks
          .filter(a => a.href && a.href.includes('/pack/'))
          .map(a => new URL(a.href).pathname);
      }
      
      return cards.map(card => card.getAttribute('href'));
    });
    
    console.log(`Total packs found: ${packUrls.length}`);
    
    if (packUrls.length === 0) {
      console.log('No packs found. There may be an issue with the page structure or selectors.');
      console.log('Trying alternate approach - checking HTML structure...');
      
      // Save page HTML for debugging
      const pageContent = await page.content();
      fs.writeFileSync('page-debug.html', pageContent);
      console.log('Saved page HTML to page-debug.html for inspection');
      
      // Try getting all links to analyze patterns
      const allLinks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a'))
          .map(a => a.href)
          .filter(href => href && href.length > 0);
      });
      
      console.log('All links found on page:', allLinks.length);
      fs.writeFileSync('all-links.json', JSON.stringify(allLinks, null, 2));
      console.log('Saved all links to all-links.json for analysis');
      
      // Try a hardcoded approach with specific packs
      console.log('Using hardcoded approach with known packs for testing...');
      const hardcodedPacks = [
        '/pack/3d-icon-pack-furniture-models',
        '/pack/3d-icon-set-buildings-houses'
        // Add more known packs if needed
      ];
      
      // Process these hardcoded packs
      for (const packUrl of hardcodedPacks) {
        try {
          const fullPackUrl = `https://pixcap.com${packUrl}`;
          const packSlug = packUrl.split('/').pop();
          console.log(`Processing hardcoded pack: ${fullPackUrl} (${packSlug})`);
          
          // Create a directory for this pack
          const packDir = path.join(OUTPUT_DIR, packSlug);
          fs.ensureDirSync(packDir);
          
          await page.goto(fullPackUrl, { 
            waitUntil: 'networkidle2',
            timeout: 60000
          });
          
          // Save the pack page for debugging
          await page.screenshot({ path: `${packSlug}-debug.png` });
          
          // Extract icon slugs from the pack page
          const iconSlugs = await page.evaluate(() => {
            // First try to find direct links to icon creation
            const createLinks = Array.from(document.querySelectorAll('a[href*="design/create?slug="]'));
            if (createLinks.length > 0) {
              return createLinks.map(link => {
                const href = link.getAttribute('href');
                const match = href.match(/slug=([^&]+)/);
                return match ? match[1] : null;
              }).filter(Boolean);
            }
            
            // If no direct links, look for icon cards or images that might contain the data
            const iconCards = Array.from(document.querySelectorAll('[data-slug], [data-icon-slug]'));
            if (iconCards.length > 0) {
              return iconCards.map(card => 
                card.getAttribute('data-slug') || card.getAttribute('data-icon-slug')
              ).filter(Boolean);
            }
            
            // Try to find any images with slugs in their URLs or alt text
            const images = Array.from(document.querySelectorAll('img[src*="icon"], img[alt*="icon"]'));
            return images.map(img => {
              // Extract potential slug from image src or alt
              const src = img.getAttribute('src') || '';
              const alt = img.getAttribute('alt') || '';
              
              // Look for patterns like 'icon-name-3d' in src or alt
              const srcMatch = src.match(/\/([^\/]+)-3d-icon/);
              const altMatch = alt.match(/([a-z0-9-]+)-3d-icon/);
              
              return (srcMatch && srcMatch[1]) || (altMatch && altMatch[1]) || null;
            }).filter(Boolean);
          });
          
          console.log(`Found ${iconSlugs.length} icons in pack ${packSlug}`);
          
          if (iconSlugs.length === 0) {
            console.log('No icons found in this pack. Saving page content for analysis...');
            const packPageContent = await page.content();
            fs.writeFileSync(`${packSlug}-debug.html`, packPageContent);
          }
          
          // Process each icon in the pack
          for (const iconSlug of iconSlugs) {
            try {
              console.log(`Processing icon: ${iconSlug}`);
              
              // Skip if file already exists
              const possibleFilenames = fs.readdirSync(packDir);
              const fileExists = possibleFilenames.some(filename => 
                filename.startsWith(iconSlug + '__') && filename.endsWith('.glb')
              );
              
              if (fileExists) {
                console.log(`Icon ${iconSlug} already downloaded, skipping...`);
                continue;
              }
              
              // Set up response interception for this specific icon
              const responseHandler = async (response) => {
                const url = response.url();
                
                if (url.includes('/api/v1/assetmanager/presigned/loadProject/')) {
                  try {
                    const responseData = await response.json();
                    
                    if (responseData && responseData.presignedUrl) {
                      const presignedUrl = responseData.presignedUrl;
                      const iconUuid = url.split('/').pop().split('?')[0];
                      
                      // Store mapping of slug to UUID
                      slugToUuidMap.set(iconSlug, iconUuid);
                      
                      console.log(`Found presigned URL for icon: ${iconSlug} (UUID: ${iconUuid})`);
                      
                      // Download the .glb file
                      try {
                        const glbResponse = await axios.get(presignedUrl, { 
                          responseType: 'arraybuffer' 
                        });
                        
                        // Save with both slug and UUID for reference
                        const filename = `${iconSlug}__${iconUuid}.glb`;
                        const outputPath = path.join(packDir, filename);
                        
                        await fs.writeFile(outputPath, Buffer.from(glbResponse.data));
                        console.log(`Successfully downloaded: ${filename}`);
                      } catch (dlError) {
                        console.error(`Error downloading .glb file: ${dlError.message}`);
                      }
                    }
                  } catch (jsonError) {
                    console.error(`Error parsing response JSON: ${jsonError.message}`);
                  }
                }
              };
              
              // Add the response listener
              page.on('response', responseHandler);
              
              // Visit the design creation page
              await page.goto(`https://pixcap.com/design/create?slug=${iconSlug}`, {
                waitUntil: 'networkidle2',
                timeout: 60000 // Extended timeout for page load
              });
              
              // Wait for the page to load and redirect
              await page.waitForTimeout(5000); // Allow time for the redirect and API requests
              
              // Remove the response listener to avoid duplicates
              page.removeListener('response', responseHandler);
              
            } catch (iconError) {
              console.error(`Error processing icon ${iconSlug}: ${iconError.message}`);
            }
          }
          
        } catch (packError) {
          console.error(`Error processing pack ${packUrl}: ${packError.message}`);
        }
      }
    } else {
      // Process each pack that was found
      for (const packUrl of packUrls) {
        try {
          const fullPackUrl = `https://pixcap.com${packUrl}`;
          const packSlug = packUrl.split('/').pop();
          console.log(`Processing pack: ${fullPackUrl} (${packSlug})`);
          
          // Create a directory for this pack
          const packDir = path.join(OUTPUT_DIR, packSlug);
          fs.ensureDirSync(packDir);
          
          await page.goto(fullPackUrl, { waitUntil: 'networkidle2' });
          
          // Extract icon slugs from the pack page
          const iconSlugs = await page.evaluate(() => {
            // Look for embedded JSON data in the page
            // This might need adjusting based on actual page structure
            const scripts = Array.from(document.querySelectorAll('script'));
            let iconData = [];
            
            for (const script of scripts) {
              const content = script.textContent;
              if (content && content.includes('window.__NUXT__')) {
                try {
                  // Extract data from script
                  const dataMatch = content.match(/window\.__NUXT__\s*=\s*(\{.+\})/s);
                  if (dataMatch && dataMatch[1]) {
                    const nuxtData = eval(`(${dataMatch[1]})`);
                    
                    // Look for icon data in the Nuxt state
                    // This path might need adjustment based on actual data structure
                    const icons = nuxtData?.state?.pack?.pack?.items || [];
                    iconData = icons.map(icon => icon.slug || icon.id);
                    break;
                  }
                } catch (e) {
                  console.error('Error parsing page data:', e);
                }
              }
            }
            
            // Fallback to DOM parsing if JSON extraction fails
            if (iconData.length === 0) {
              const links = Array.from(document.querySelectorAll('a[href*="design/create?slug="]'));
              iconData = links.map(link => {
                const href = link.getAttribute('href');
                const match = href.match(/slug=([^&]+)/);
                return match ? match[1] : null;
              }).filter(Boolean);
            }
            
            return iconData;
          });
          
          console.log(`Found ${iconSlugs.length} icons in pack`);
          
          // Process each icon in the pack
          for (const iconSlug of iconSlugs) {
            try {
              console.log(`Processing icon: ${iconSlug}`);
              
              // Skip if file already exists
              const possibleFilenames = fs.readdirSync(packDir);
              const fileExists = possibleFilenames.some(filename => 
                filename.startsWith(iconSlug + '__') && filename.endsWith('.glb')
              );
              
              if (fileExists) {
                console.log(`Icon ${iconSlug} already downloaded, skipping...`);
                continue;
              }
              
              // Set up response interception for this specific icon
              const responseHandler = async (response) => {
                const url = response.url();
                
                if (url.includes('/api/v1/assetmanager/presigned/loadProject/')) {
                  try {
                    const responseData = await response.json();
                    
                    if (responseData && responseData.presignedUrl) {
                      const presignedUrl = responseData.presignedUrl;
                      const iconUuid = url.split('/').pop().split('?')[0];
                      
                      // Store mapping of slug to UUID
                      slugToUuidMap.set(iconSlug, iconUuid);
                      
                      console.log(`Found presigned URL for icon: ${iconSlug} (UUID: ${iconUuid})`);
                      
                      // Download the .glb file
                      try {
                        const glbResponse = await axios.get(presignedUrl, { 
                          responseType: 'arraybuffer' 
                        });
                        
                        // Save with both slug and UUID for reference
                        const filename = `${iconSlug}__${iconUuid}.glb`;
                        const outputPath = path.join(packDir, filename);
                        
                        await fs.writeFile(outputPath, Buffer.from(glbResponse.data));
                        console.log(`Successfully downloaded: ${filename}`);
                      } catch (dlError) {
                        console.error(`Error downloading .glb file: ${dlError.message}`);
                      }
                    }
                  } catch (jsonError) {
                    console.error(`Error parsing response JSON: ${jsonError.message}`);
                  }
                }
              };
              
              // Add the response listener
              page.on('response', responseHandler);
              
              // Visit the design creation page
              await page.goto(`https://pixcap.com/design/create?slug=${iconSlug}`, {
                waitUntil: 'networkidle2',
                timeout: 60000 // Extended timeout for page load
              });
              
              // Wait for the page to load and redirect
              await page.waitForTimeout(5000); // Allow time for the redirect and API requests
              
              // Remove the response listener to avoid duplicates
              page.removeListener('response', responseHandler);
              
            } catch (iconError) {
              console.error(`Error processing icon ${iconSlug}: ${iconError.message}`);
            }
          }
          
        } catch (packError) {
          console.error(`Error processing pack ${packUrl}: ${packError.message}`);
        }
      }
    }
    
    // Save slug to UUID mapping for reference
    const mappingPath = path.join(OUTPUT_DIR, 'slug-uuid-mapping.json');
    await fs.writeFile(
      mappingPath, 
      JSON.stringify(Object.fromEntries(slugToUuidMap), null, 2)
    );
    console.log(`Saved slug to UUID mapping at ${mappingPath}`);
    
  } catch (error) {
    console.error(`An error occurred: ${error.message}`);
  } finally {
    await browser.close();
    console.log('Scraping completed');
  }
}

main().catch(console.error); 