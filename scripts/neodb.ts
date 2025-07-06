import dotenv from 'dotenv'
import fs from 'fs/promises'
import path from 'path'

dotenv.config()

// Types
interface NeoDBItem {
  title: string
  description: string
  category: string
  type: string
  uuid: string
  rating: number
  rating_count: number
  cover_image_url: string
  external_resources: any
}

interface NeoDBResponse {
  data: Array<{
    item: NeoDBItem
    created_time: string
  }>
  pages: number
  count: number
}

interface CleanNeoDBItem {
  title: string
  description: string
  category: string
  type: string
  uuid: string
  rating: number
  rating_count: number
  cover_image_url: string
  external_resources: any
  created_time: string
}

interface CleanNeoDBData {
  data: CleanNeoDBItem[]
  total_count: number
  last_updated: string
}

interface CategoryData {
  movies: NeoDBResponse
  tv: NeoDBResponse
  books: NeoDBResponse
  games: NeoDBResponse
}

// Helper function to make API requests
async function fetchNeoDBData(category: string, page: number = 1): Promise<NeoDBResponse> {
  const response = await fetch(`https://neodb.social/api/me/shelf/complete?category=${category}&page=${page}`, {
    headers: {
      'Authorization': `Bearer ${process.env.NEODB_API_SECRET}`,
      'Content-Type': 'application/json',
    }
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch ${category} data: ${response.statusText}`)
  }

  return response.json()
}

// Get initial data to check counts
async function getInitialData(): Promise<CategoryData> {
  console.log('Fetching initial data to check counts...')
  
  const [movies, tv, books, games] = await Promise.all([
    fetchNeoDBData('movie'),
    fetchNeoDBData('tv'),
    fetchNeoDBData('book'),
    fetchNeoDBData('game')
  ])

  return { movies, tv, books, games }
}

// Get current count from local file
async function getCurrentCount(): Promise<number> {
  try {
    const neodbPath = path.join(process.cwd(), 'neodb', 'neodb.json')
    const data = await fs.readFile(neodbPath, 'utf-8')
    const json = JSON.parse(data)
    return json.data?.length || 0
  } catch (error) {
    console.log('No existing neodb.json found, count will be 0')
    return 0
  }
}

// Calculate remote count
function calculateRemoteCount(data: CategoryData): number {
  return data.movies.count + data.tv.count + data.books.count + data.games.count
}

// Download all pages for a category
async function downloadAllPages(category: string, pages: number): Promise<NeoDBResponse[]> {
  console.log(`Downloading all ${pages} pages for ${category}...`)
  
  const promises: Promise<NeoDBResponse>[] = []
  for (let i = 1; i <= pages; i++) {
    promises.push(fetchNeoDBData(category, i))
  }
  
  return Promise.all(promises)
}

// Merge all data from multiple pages and clean it
function mergeAndCleanData(allData: NeoDBResponse[]): CleanNeoDBData {
  const mergedData = allData.reduce((acc, curr) => {
    acc.data.push(...curr.data)
    return acc
  }, { data: [] as any[], pages: 0, count: 0 })

  // Sort by created_time in reverse order (newest first)
  mergedData.data.sort((a, b) => new Date(b.created_time).getTime() - new Date(a.created_time).getTime())
  
  // Remove duplicates based on item.uuid
  const uniqueData = mergedData.data.filter((item, index, self) => 
    index === self.findIndex(t => t.item.uuid === item.item.uuid)
  )

  // Clean and flatten the data structure
  const cleanData: CleanNeoDBItem[] = uniqueData.map(item => ({
    title: item.item.title,
    description: item.item.description,
    category: item.item.category,
    type: item.item.type,
    uuid: item.item.uuid,
    rating: item.item.rating,
    rating_count: item.item.rating_count,
    cover_image_url: item.item.cover_image_url,
    external_resources: item.item.external_resources,
    created_time: item.created_time
  }))

  return {
    data: cleanData,
    total_count: cleanData.length,
    last_updated: new Date().toISOString()
  }
}

// Extract category-specific data
function extractCategoryData(mergedData: CleanNeoDBData, category: string): NeoDBItem[] {
  return mergedData.data
    .filter(item => item.category === category)
    .map(item => ({
      title: item.title,
      description: item.description,
      category: item.category,
      type: item.type,
      uuid: item.uuid,
      rating: item.rating,
      rating_count: item.rating_count,
      cover_image_url: item.cover_image_url,
      external_resources: item.external_resources
    }))
}

// Download cover images
async function downloadCoverImages(mergedData: CleanNeoDBData): Promise<void> {
  console.log('Downloading cover images...')
  
  const coverDir = path.join(process.cwd(), 'neodb', 'cover')
  
  // Create cover directory if it doesn't exist
  try {
    await fs.mkdir(coverDir, { recursive: true })
  } catch (error) {
    // Directory might already exist
  }

  const imageUrls = mergedData.data
    .map(item => item.cover_image_url)
    .filter(url => url && url.trim() !== '')

  console.log(`Found ${imageUrls.length} cover images to download`)

  for (const url of imageUrls) {
    try {
      const filename = path.basename(url)
      const filepath = path.join(coverDir, filename)

      // Check if file already exists
      try {
        await fs.access(filepath)
        console.log(`Skipping ${filename} - File already exists`)
        continue
      } catch {
        // File doesn't exist, proceed to download
      }

      // Download the image
      const response = await fetch(url)
      if (!response.ok) {
        console.log(`Failed to download ${filename}: ${response.statusText}`)
        continue
      }

      const buffer = await response.arrayBuffer()
      await fs.writeFile(filepath, Buffer.from(buffer))
      console.log(`Downloaded ${filename}`)
    } catch (error) {
      console.log(`Error downloading image from ${url}:`, error)
    }
  }
}

// Git operations - removed as they will be handled by GitHub Actions
async function gitAddAndCommit(): Promise<void> {
  console.log('Git operations will be handled by GitHub Actions workflow')
}

// Main sync function
export async function syncNeoDBData(): Promise<void> {
  try {
    console.log('Starting NeoDB data sync...')

    // Get initial data to check counts
    const initialData = await getInitialData()
    const remoteCount = calculateRemoteCount(initialData)
    const currentCount = await getCurrentCount()

    console.log(`Remote count: ${remoteCount}`)
    console.log(`Current count: ${currentCount}`)

    // Compare counts
    if (remoteCount === currentCount) {
      console.log('Counts are equal. No update needed.')
      return
    }

    console.log('Counts are different. Proceeding with data update...')

    // Create neodb directory if it doesn't exist
    const neodbDir = path.join(process.cwd(), 'neodb')
    try {
      await fs.mkdir(neodbDir, { recursive: true })
    } catch (error) {
      // Directory might already exist
    }

    // Download all pages for each category
    const [allMovies, allTV, allBooks, allGames] = await Promise.all([
      downloadAllPages('movie', initialData.movies.pages),
      downloadAllPages('tv', initialData.tv.pages),
      downloadAllPages('book', initialData.books.pages),
      downloadAllPages('game', initialData.games.pages)
    ])

    // Merge all data
    const allData = [...allMovies, ...allTV, ...allBooks, ...allGames]
    const mergedData = mergeAndCleanData(allData)

    // Save merged data
    const neodbPath = path.join(neodbDir, 'neodb.json')
    await fs.writeFile(neodbPath, JSON.stringify(mergedData, null, 2))

    // Extract and save category-specific data
    const categoryData = {
      book: extractCategoryData(mergedData, 'book'),
      game: extractCategoryData(mergedData, 'game'),
      tv: extractCategoryData(mergedData, 'tv'),
      movie: extractCategoryData(mergedData, 'movie')
    }

    await Promise.all([
      fs.writeFile(path.join(neodbDir, 'book.json'), JSON.stringify(categoryData.book, null, 2)),
      fs.writeFile(path.join(neodbDir, 'game.json'), JSON.stringify(categoryData.game, null, 2)),
      fs.writeFile(path.join(neodbDir, 'tv.json'), JSON.stringify(categoryData.tv, null, 2)),
      fs.writeFile(path.join(neodbDir, 'movie.json'), JSON.stringify(categoryData.movie, null, 2))
    ])

    // Download cover images
    await downloadCoverImages(mergedData)

    // Git operations
    await gitAddAndCommit()

    console.log('NeoDB data sync completed successfully!')
  } catch (error) {
    console.error('Error during NeoDB sync:', error)
    throw error
  }
}

// Legacy function for backward compatibility
export async function getNeoDBData() {
  const initialData = await getInitialData()
  return initialData
}

// Run the sync if this file is executed directly
if (require.main === module) {
  syncNeoDBData().catch(console.error)
}
