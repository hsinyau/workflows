import 'dotenv/config'
import axios from 'axios'
import { octokit } from '../lib/octokit'

const endpoint = 'https://v1.hitokoto.cn'

// Response is response struct referring to https://developer.hitokoto.cn/sentence/#%E8%BF%94%E5%9B%9E%E6%A0%BC%E5%BC%8F
interface HitokotoResponse {
  hitokoto: string
  from: string
  from_who: string
}

async function getHitokoto(categories: string[]): Promise<HitokotoResponse> {
  const queryParams = new URLSearchParams()
  
  for (const category of categories) {
    const trimmed = category.trim()
    if (trimmed) {
      queryParams.append('c', trimmed)
    }
  }
  
  queryParams.append('encode', 'json')
  queryParams.append('charset', 'utf-8')

  const response = await axios.get<HitokotoResponse>(`${endpoint}?${queryParams.toString()}`)
  return response.data
}

async function updateGist(hitokoto: HitokotoResponse): Promise<void> {
  try {
    // Get gist
    const gist = await octokit.gists.get({ gist_id: process.env.HITOKOTO_GIST_ID! })
    
    // Format timestamp
    const now = new Date().toLocaleString('en-US', {
      timeZone: 'Asia/Shanghai',
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })

    let from = ''
    if (hitokoto.from === '' && hitokoto.from_who === '') {
      from = ''
    } else if (hitokoto.from !== '') {
      from = `\n ---${hitokoto.from}`
    } else {
      from = `\n ---${hitokoto.from_who}`
    }

    const content = `${hitokoto.hitokoto}${from}\n\nUpdated at ${now}`

    // Get original filename to update that same file
    const filename = gist.data.files ? Object.keys(gist.data.files)[0] : undefined
    if (!filename) {
      throw new Error('No files found in gist')
    }
    
    await octokit.gists.update({
      gist_id: process.env.HITOKOTO_GIST_ID!,
      files: {
        [filename]: {
          filename: '🌧Hitokoto',
          content: content
        }
      },
      headers: {
        'X-GitHub-Api-Version': '2022-11-28'
      }
    })
    
    console.log('Hitokoto updated successfully!')
  } catch (error) {
    console.error('Unable to update gist:', error)
    throw error
  }
}

async function main(): Promise<void> {
  try {
    const categories = process.env.CATEGORY ? process.env.CATEGORY.split('') : []
    
    const hitokoto = await getHitokoto(categories)
    await updateGist(hitokoto)
  } catch (error) {
    console.error('Process failed:', error)
    process.exit(1)
  }
}

// Run the script
if (require.main === module) {
  main()
}
