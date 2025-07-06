import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface VSCOImage {
  width: number;
  height: number;
  id: string;
  date: string;
  description: string;
  location: {
    lat: number;
    lon: number;
  } | null;
  src: string;
}

interface VSCOMediaResponse {
  media: Array<{
    image: {
      width: number;
      height: number;
      _id: string;
      capture_date: string;
      description: string;
      location_coords: {
        lat: number;
        lon: number;
      } | null;
      responsive_url: string;
    };
  }>;
}

async function fetchVSCOData(siteId: string, limit: number = 20): Promise<VSCOImage[]> {
  if (!process.env.VSCO_SECRET) {
    throw new Error('VSCO_SECRET environment variable is required');
  }

  try {
    console.log(`Fetching VSCO data for site_id: ${siteId}, limit: ${limit}`);
    console.log(`Using secret: ${process.env.VSCO_SECRET.substring(0, 10)}...`);
    
    // Try different API endpoints
    const endpoints = [
      `https://vsco.co/api/3.0/medias/profile?site_id=${siteId}&limit=${limit}`,
      `https://vsco.co/api/3.0/medias/profile?site_id=${siteId}`,
      `https://vsco.co/api/3.0/medias/profile?site_id=${siteId}&limit=6`,
    ];
    
    let response;
    let lastError;
    
    for (const endpoint of endpoints) {
      try {
        console.log(`Trying endpoint: ${endpoint}`);
        response = await axios.get(endpoint, {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${process.env.VSCO_SECRET}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Referer': 'https://vsco.co/',
            'Origin': 'https://vsco.co',
          },
        });
        console.log(`✅ Success with endpoint: ${endpoint}`);
        break;
      } catch (error) {
        lastError = error;
        console.log(`❌ Failed with endpoint: ${endpoint} - ${error.response?.status}`);
        continue;
      }
    }
    
    if (!response) {
      throw lastError;
    }

    const data = response.data as VSCOMediaResponse;
    
    const photos = data.media.map((item) => ({
      width: item.image.width,
      height: item.image.height,
      id: item.image._id,
      date: item.image.capture_date,
      description: item.image.description,
      location: item.image.location_coords,
      src: `${item.image.responsive_url.replace('im.vsco.co/aws-us-west-2', 'https://fbf0ebb.webp.li')}`,
    }));

    console.log(`Successfully fetched ${photos.length} photos`);
    return photos;
    
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('VSCO API Error:');
      console.error(`Status: ${error.response?.status}`);
      console.error(`Status Text: ${error.response?.statusText}`);
      console.error(`Response Data:`, error.response?.data);
      console.error(`Request URL: ${error.config?.url}`);
      console.error(`Request Headers:`, error.config?.headers);
    } else {
      console.error('Error fetching VSCO data:', error);
    }
    throw error;
  }
}

async function downloadImage(url: string, filePath: string): Promise<void> {
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 30000,
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log(`Downloaded: ${path.basename(filePath)}`);
        resolve();
      });
      writer.on('error', reject);
    });
    
  } catch (error) {
    console.error(`Error downloading image ${url}:`, error);
    throw error;
  }
}

async function saveDataAsJSON(data: VSCOImage[], outputPath: string): Promise<void> {
  try {
    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Save data as JSON
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    console.log(`Data saved to: ${outputPath}`);
    
  } catch (error) {
    console.error('Error saving JSON data:', error);
    throw error;
  }
}

async function downloadImages(photos: VSCOImage[], outputDir: string): Promise<void> {
  try {
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log(`Starting download of ${photos.length} images...`);
    
    // Download images concurrently with a limit to avoid overwhelming the server
    const downloadPromises = photos.map(async (photo, index) => {
      const fileName = `${photo.id}.jpg`;
      const filePath = path.join(outputDir, fileName);
      
      // Add delay between downloads to be respectful to the server
      await new Promise(resolve => setTimeout(resolve, index * 100));
      
      try {
        await downloadImage(photo.src, filePath);
      } catch (error) {
        console.warn(`Skipped: ${photo.src} (reason: ${error instanceof Error ? error.message : error})`);
      }
    });

    await Promise.all(downloadPromises);
    console.log('All images processed (successful downloads and skips logged above).');
    
  } catch (error) {
    console.error('Error downloading images:', error);
    throw error;
  }
}

async function testVSCOConnection(): Promise<void> {
  console.log('Testing VSCO API connection...');
  
  // Test 1: Basic connection without auth
  try {
    const response = await axios.get('https://vsco.co/api/3.0/medias/profile?site_id=304275568&limit=1', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });
    console.log('✅ Basic connection works (no auth)');
  } catch (error) {
    console.log('❌ Basic connection failed:', error.response?.status);
  }
  
  // Test 2: With auth
  if (process.env.VSCO_SECRET) {
    try {
      const response = await axios.get('https://vsco.co/api/3.0/medias/profile?site_id=304275568&limit=1', {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${process.env.VSCO_SECRET}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Referer': 'https://vsco.co/',
          'Origin': 'https://vsco.co',
        },
      });
      console.log('✅ Authenticated connection works');
    } catch (error) {
      console.log('❌ Authenticated connection failed:', error.response?.status);
      console.log('Response data:', error.response?.data);
    }
  }
}

async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2);
    
    // Check if we should test connection first
    if (args.includes('--test')) {
      await testVSCOConnection();
      return;
    }
    
    // Default values
    const outputDir = process.env.VSCO_OUTPUT_DIR || 'vsco';
    const jsonPath = path.join(outputDir, 'photos.json');
    const imagesDir = path.join(outputDir, 'images');

    console.log('Starting VSCO data fetch and download process...');
    console.log(`Output directory: ${outputDir}`);

    // Fetch VSCO data
    const photos = await fetchVSCOData(process.env.VSCO_SITE_ID!, 20);

    // Save data as JSON
    await saveDataAsJSON(photos, jsonPath);

    // Download images
    await downloadImages(photos, imagesDir);

    console.log('Process completed successfully!');
    console.log(`- JSON data: ${jsonPath}`);
    console.log(`- Images: ${imagesDir}`);
    
  } catch (error) {
    console.error('Process failed:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}
