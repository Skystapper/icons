# PixCap 3D Icon Scraper

A Node.js script to download 3D icons from PixCap using Puppeteer.

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn

## Setup

1. Clone this repository or download the files
2. Install dependencies:

```bash
npm install
```

or

```bash
yarn install
```

## Authentication Options

PixCap requires login to access assets. You have three options:

### Option 1: Run the Login Utility (Recommended)

The script includes a login utility that will save your session cookies for future use:

```bash
node login.js
```

This will:
1. Open a browser window
2. Allow you to manually log in to PixCap
3. Save your session cookies to `cookies.json`
4. Future runs of the main script will use these cookies automatically

### Option 2: Manual Login During Script Execution

If you don't run the login utility first, the main script will:
1. Open a browser window in non-headless mode
2. Allow you to log in manually
3. Save the session cookies for future use
4. Continue with the scraping process

### Option 3: Provide Cookies Manually

If you already have your PixCap session cookies, you can create a `cookies.json` file with the following format:

```json
[
  {
    "name": "cookie_name",
    "value": "cookie_value",
    "domain": "pixcap.com",
    "path": "/",
    "expires": -1,
    "httpOnly": true,
    "secure": true
  }
]
```

## Running the Script

After setting up authentication, start the scraper:

```bash
npm start
```

or

```bash
yarn start
```

## Features

- **Organized Directory Structure**: All icons are saved in folders by pack name
- **Automatic Login Detection**: The script detects if you're logged in
- **Resume Capability**: Skips already downloaded icons when restarted
- **Error Handling**: Continues after errors with specific icons or packs
- **Slug-UUID Mapping**: Saves a mapping file for reference

## Output

All downloaded .glb files will be saved in the `glb` directory, organized by pack with the following structure:

```
glb/
  ├── pack-name-1/
  │   ├── icon-slug__UUID.glb
  │   └── another-icon-slug__UUID.glb
  ├── pack-name-2/
  │   └── ...
  └── slug-uuid-mapping.json
```

## Notes

- Adjust timeouts if needed for slower connections
- This script is for educational purposes only - respect PixCap's terms of service when using it #   i c o n s  
 