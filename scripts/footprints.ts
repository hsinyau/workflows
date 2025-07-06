import fs from 'fs';
import path from 'path';
import axios from 'axios';
import AdmZip from 'adm-zip';
import { parseString } from 'xml2js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface GeoJSONFeature {
  type: 'Feature';
  properties: Record<string, any>;
  geometry: GeoJSONGeometry | null;
}

interface GeoJSONGeometry {
  type: 'Point' | 'LineString' | 'Polygon';
  coordinates: number[] | number[][] | number[][][];
}

interface GeoJSON {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

interface KMLCoordinates {
  lon: number;
  lat: number;
  alt?: number;
}

async function downloadKMZFile(url: string, outputPath: string): Promise<void> {
  try {
    console.log(`Downloading KMZ file from: ${url}`);
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'arraybuffer',
      timeout: 30000,
    });

    fs.writeFileSync(outputPath, response.data);
    console.log(`KMZ file downloaded successfully to: ${outputPath}`);
  } catch (error) {
    console.error('Error downloading KMZ file:', error);
    throw error;
  }
}

function parseCoordinates(coordString: string): KMLCoordinates[] {
  const coordinates: KMLCoordinates[] = [];
  const coordPairs = coordString.trim().split(/\s+/);
  
  for (const pair of coordPairs) {
    const [lon, lat, alt] = pair.split(',').map(Number);
    coordinates.push({
      lon,
      lat,
      alt: alt || 0
    });
  }
  
  return coordinates;
}

function kmlToGeoJSON(kmlElement: any): GeoJSON {
  const geojson: GeoJSON = {
    type: 'FeatureCollection',
    features: []
  };

  // Find all Placemark elements
  const placemarks = findElementsByTagName(kmlElement, 'Placemark');
  
  for (const placemark of placemarks) {
    const feature: GeoJSONFeature = {
      type: 'Feature',
      properties: {},
      geometry: null
    };

    // Extract name
    const nameElement = findElementByTagName(placemark, 'name');
    if (nameElement) {
      feature.properties.name = typeof nameElement === 'string' ? nameElement : (nameElement._ || nameElement);
    }

    // Extract description
    const descriptionElement = findElementByTagName(placemark, 'description');
    if (descriptionElement) {
      feature.properties.description = typeof descriptionElement === 'string' ? descriptionElement : (descriptionElement._ || descriptionElement);
    }

    // Handle Point geometry
    const pointElement = findElementByTagName(placemark, 'Point');
    if (pointElement) {
      const coordsElement = findElementByTagName(pointElement, 'coordinates');
      if (coordsElement) {
        const coordsText = typeof coordsElement === 'string' ? coordsElement : (coordsElement._ || coordsElement);
        const coords = parseCoordinates(coordsText);
        if (coords.length > 0) {
          feature.geometry = {
            type: 'Point',
            coordinates: [coords[0].lon, coords[0].lat]
          };
        }
      }
    }

    // Handle LineString geometry
    const lineStringElement = findElementByTagName(placemark, 'LineString');
    if (lineStringElement) {
      const coordsElement = findElementByTagName(lineStringElement, 'coordinates');
      if (coordsElement) {
        const coordsText = typeof coordsElement === 'string' ? coordsElement : (coordsElement._ || coordsElement);
        const coords = parseCoordinates(coordsText);
        if (coords.length > 0) {
          feature.geometry = {
            type: 'LineString',
            coordinates: coords.map(coord => [coord.lon, coord.lat])
          };
        }
      }
    }

    // Handle Polygon geometry
    const polygonElement = findElementByTagName(placemark, 'Polygon');
    if (polygonElement) {
      const outerBoundaryElement = findElementByTagName(polygonElement, 'outerBoundaryIs');
      if (outerBoundaryElement) {
        const linearRingElement = findElementByTagName(outerBoundaryElement, 'LinearRing');
        if (linearRingElement) {
          const coordsElement = findElementByTagName(linearRingElement, 'coordinates');
          if (coordsElement) {
            const coordsText = typeof coordsElement === 'string' ? coordsElement : (coordsElement._ || coordsElement);
            const coords = parseCoordinates(coordsText);
            if (coords.length > 0) {
              feature.geometry = {
                type: 'Polygon',
                coordinates: [coords.map(coord => [coord.lon, coord.lat])]
              };
            }
          }
        }
      }
    }

    if (feature.geometry !== null) {
      geojson.features.push(feature);
    }
  }

  return geojson;
}

function findElementByTagName(element: any, tagName: string): any {
  if (!element) return null;
  
  // Try exact match first
  if (element[tagName]) {
    return Array.isArray(element[tagName]) ? element[tagName][0] : element[tagName];
  }
  
  // Try with namespace
  const namespacedTag = `{http://www.opengis.net/kml/2.2}${tagName}`;
  if (element[namespacedTag]) {
    return Array.isArray(element[namespacedTag]) ? element[namespacedTag][0] : element[namespacedTag];
  }
  
  // Search recursively
  for (const key in element) {
    if (typeof element[key] === 'object' && element[key] !== null) {
      const result = findElementByTagName(element[key], tagName);
      if (result) return result;
    }
  }
  
  return null;
}

function findElementsByTagName(element: any, tagName: string): any[] {
  const results: any[] = [];
  
  if (!element) return results;
  
  // Try exact match first
  if (element[tagName]) {
    const elements = Array.isArray(element[tagName]) ? element[tagName] : [element[tagName]];
    results.push(...elements);
  }
  
  // Try with namespace
  const namespacedTag = `{http://www.opengis.net/kml/2.2}${tagName}`;
  if (element[namespacedTag]) {
    const elements = Array.isArray(element[namespacedTag]) ? element[namespacedTag] : [element[namespacedTag]];
    results.push(...elements);
  }
  
  // Search recursively
  for (const key in element) {
    if (typeof element[key] === 'object' && element[key] !== null) {
      const childResults = findElementsByTagName(element[key], tagName);
      results.push(...childResults);
    }
  }
  
  return results;
}

async function convertKMZToGeoJSON(kmzFilePath: string, geojsonFilePath: string): Promise<void> {
  try {
    console.log(`Converting KMZ file: ${kmzFilePath}`);
    
    // Read and extract KMZ file
    const zip = new AdmZip(kmzFilePath);
    const kmlEntry = zip.getEntry('doc.kml');
    
    if (!kmlEntry) {
      throw new Error('Could not find doc.kml in KMZ file');
    }
    
    const kmlContent = kmlEntry.getData().toString('utf8');
    
    // Parse KML XML
    const kmlElement = await new Promise<any>((resolve, reject) => {
      parseString(kmlContent, { explicitArray: false }, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
    
    // Convert to GeoJSON
    const geojson = kmlToGeoJSON(kmlElement);
    
    // Ensure output directory exists
    const outputDir = path.dirname(geojsonFilePath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Write GeoJSON file
    fs.writeFileSync(geojsonFilePath, JSON.stringify(geojson, null, 2));
    console.log(`GeoJSON file created successfully: ${geojsonFilePath}`);
    console.log(`Features extracted: ${geojson.features.length}`);
    
  } catch (error) {
    console.error('Error converting KMZ to GeoJSON:', error);
    throw error;
  }
}

async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
      // Default behavior: download and convert
      const kmzFilePath = 'footprints.kmz';
      const geojsonFilePath = 'footprints/footprints.json';
      
      console.log('Starting KMZ download and conversion process...');
      
      // Download KMZ file
      await downloadKMZFile(process.env.KMZ_URL!, kmzFilePath);
      
      // Convert to GeoJSON
      await convertKMZToGeoJSON(kmzFilePath, geojsonFilePath);
      
      console.log('Process completed successfully!');
      
    } else if (args.length === 2) {
      // Custom file paths provided
      const [kmzFilePath, geojsonFilePath] = args;
      await convertKMZToGeoJSON(kmzFilePath, geojsonFilePath);
      
    } else {
      console.error('Usage: npm run footprints [kmz_file_path] [geojson_file_path]');
      console.error('If no arguments provided, will download from default URL and save to data/geo.json');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('Process failed:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}
