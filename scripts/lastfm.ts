import 'dotenv/config'
import { octokit } from '../lib/octokit'

// Types
interface LastfmImage {
  size: string
  '#text': string
}

interface LastfmArtist {
  mbid?: string
  '#text'?: string
  name?: string
}

interface LastfmTrack {
  artist: string | LastfmArtist
  name: string
  image: LastfmImage[]
  url: string
  date?: {
    uts: string
    '#text': string
  }
  '@attr'?: {
    nowplaying: string
  }
}

interface RecentTracksResponse {
  recenttracks: {
    track: LastfmTrack[]
    '@attr': {
      user: string
      totalPages: string
      page: string
      perPage: string
      total: string
    }
  }
}

// Configuration
const LASTFM_API_KEY = process.env.LASTFM_API_KEY
const LASTFM_USERNAME = process.env.LASTFM_USERNAME || 'eggsywashere'
const LASTFM_GIST_ID = process.env.LASTFM_GIST_ID

// API helper
async function fetchLastfmApi<T>(method: string, params: Record<string, string | number> = {}): Promise<T> {
  const searchParams = new URLSearchParams({
    method,
    user: LASTFM_USERNAME,
    api_key: LASTFM_API_KEY!,
    format: 'json',
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    )
  })

  const response = await fetch(`https://ws.audioscrobbler.com/2.0/?${searchParams.toString()}`)
  
  if (!response.ok) {
    throw new Error(`Last.fm API error: ${response.statusText}`)
  }

  return response.json()
}

// Format track for display
function formatTrack(track: LastfmTrack, index: number): string {
  const artist = typeof track.artist === 'string' 
    ? track.artist 
    : (track.artist.name || track.artist['#text'] || 'Unknown Artist')
  
  const name = track.name || 'Unknown Track'
  const isNowPlaying = track['@attr']?.nowplaying === 'true'
  
  // Truncate long names
  const maxArtistLen = 20
  const maxTrackLen = 30
  
  const truncatedArtist = artist.length > maxArtistLen 
    ? artist.substring(0, maxArtistLen - 3) + '...' 
    : artist
  
  const truncatedTrack = name.length > maxTrackLen 
    ? name.substring(0, maxTrackLen - 3) + '...' 
    : name
  
  // Format time ago if not currently playing
  let timeInfo = ''
  if (isNowPlaying) {
    timeInfo = '🎵 Now Playing'
  } else if (track.date?.uts) {
    const timestamp = parseInt(track.date.uts) * 1000
    timeInfo = getTimeAgo(timestamp)
  }
  
  return `${truncatedTrack} - ${truncatedArtist}`
}

// Calculate time ago
function getTimeAgo(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

// Fetch recent tracks
async function getRecentTracks(limit: number = 10): Promise<LastfmTrack[]> {
  const data = await fetchLastfmApi<RecentTracksResponse>('user.getrecenttracks', {
    limit,
    extended: 0
  })
  
  return data.recenttracks.track || []
}

// Update Gist
async function updateGist(tracks: LastfmTrack[]) {
  if (!LASTFM_GIST_ID) {
    throw new Error('LASTFM_GIST_ID environment variable is not set')
  }

  let gist: Awaited<ReturnType<typeof octokit.gists.get>> | undefined

  try {
    gist = await octokit.request('GET /gists/{gist_id}', {
      gist_id: LASTFM_GIST_ID,
      headers: {
        'X-GitHub-Api-Version': '2022-11-28'
      }
    })
  } catch (error) {
    console.error(`Unable to get gist\n${error}`)
    throw error
  }

  // Format tracks
  const lines: string[] = []
  const displayLimit = Math.min(tracks.length, 10)
  
  for (let i = 0; i < displayLimit; i++) {
    lines.push(formatTrack(tracks[i], i))
  }

  if (lines.length === 0) {
    lines.push('No recent tracks found')
  }

  try {
    // Get original filename
    const filename = gist?.data?.files ? Object.keys(gist.data.files)[0] : undefined
    
    if (!filename) {
      throw new Error('Could not find existing gist filename')
    }

    await octokit.request('PATCH /gists/{gist_id}', {
      gist_id: LASTFM_GIST_ID,
      files: {
        [filename]: {
          filename: `🎧 Recent tracks from Last.fm`,
          content: lines.join('\n')
        }
      },
      headers: {
        'X-GitHub-Api-Version': '2022-11-28'
      }
    })

    console.log('✅ Gist updated successfully!')
  } catch (error) {
    console.error(`Unable to update gist\n${error}`)
    throw error
  }
}

// Main function
async function main() {
  try {
    if (!LASTFM_API_KEY) {
      throw new Error('LASTFM_API_KEY environment variable is not set')
    }

    if (!LASTFM_GIST_ID) {
      throw new Error('LASTFM_GIST_ID environment variable is not set')
    }

    console.log(`Fetching recent tracks for user: ${LASTFM_USERNAME}`)
    
    const tracks = await getRecentTracks(14)
    console.log(`Found ${tracks.length} recent tracks`)
    
    await updateGist(tracks)
    
    console.log('Last.fm sync completed!')
  } catch (error) {
    console.error('Error during Last.fm sync:', error)
    throw error
  }
}

// Run the script
if (require.main === module) {
  main()
}

export { main as syncLastfm, getRecentTracks }
