import 'dotenv/config';
import { CookieJar } from 'tough-cookie';
import axios from 'axios';
import path from 'path';
import fs from 'fs';

const baseUrl = 'https://www.instagram.com';
const COOKIE_URL = baseUrl;
const ROOT_DIR = process.cwd();
const INSTAGRAM_DIR = path.join(ROOT_DIR, 'instagram');
const PHOTOS_DIR = path.join(INSTAGRAM_DIR, 'photos');
const JSON_FILE_PATH = path.join(INSTAGRAM_DIR, 'instagram.json');

// 确保目录结构存在
if (!fs.existsSync(INSTAGRAM_DIR)) {
  fs.mkdirSync(INSTAGRAM_DIR, { recursive: true });
}
if (!fs.existsSync(PHOTOS_DIR)) {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}

const cookieJar = new CookieJar();

// Set cookies from environment variables
const setCookies = async () => {
  const cookies = process.env.INSTAGRAM_COOKIES;
  if (!cookies) {
    throw new Error('Instagram cookies not found in environment variables');
  }
  
  const cookiePairs = cookies.split(';');
  for (const cookiePair of cookiePairs) {
    if (cookiePair.trim()) {
      await cookieJar.setCookie(cookiePair.trim(), COOKIE_URL);
    }
  }
};

const getCSRFTokenFromJar = async () => {
  const cookieString = await cookieJar.getCookieString(COOKIE_URL);
  return cookieString.match(/csrftoken=([^;]+)/)?.[1];
};

const getHeaders = async () => ({
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'x-asbd-id': '359341',
  'x-csrftoken': await getCSRFTokenFromJar(),
  'x-ig-app-id': '936619743392459',
  'x-ig-www-claim': '0',
  'cookie': await cookieJar.getCookieString(COOKIE_URL),
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
});

const checkLogin = async () => {
  try {
    const response = await axios.post(`${baseUrl}/api/v1/web/fxcal/ig_sso_users/`, null, {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(await getHeaders()),
      },
    });

    return Boolean(response.data.status === 'ok');
  } catch (error) {
    console.error('Login check failed:', error.message);
    return false;
  }
};

const getUserInfo = async (username: string) => {
  try {
    const response = await axios.get(`${baseUrl}/api/v1/users/web_profile_info/`, {
      headers: await getHeaders(),
      params: { username },
    });

    if (response.request.res.responseUrl?.includes('/accounts/login/')) {
      throw new Error('Invalid cookie');
    }

    return response.data.data.user;
  } catch (error) {
    console.error('Failed to get user info:', error.message);
    throw error;
  }
};

const getUserFeedItems = async (username: string) => {
  try {
    const response = await axios.get(`${baseUrl}/api/v1/feed/user/${username}/username/`, {
      headers: await getHeaders(),
      params: { count: 30 },
    });

    if (response.request.res.responseUrl?.includes('/accounts/login/')) {
      throw new Error('Invalid cookie. Please also check if your account is being blocked by Instagram.');
    }

    return response.data.items;
  } catch (error) {
    console.error('Failed to get user feed:', error.message);
    throw error;
  }
};

// 从URL中提取原始文件名
const getOriginalFilenameFromUrl = (url: string): string => {
  // 提取形如 443711036_417575674565247_1156670569594802102_n.webp 的文件名
  const match = url.match(/\/([^\/]+_[^\/]+_[^\/]+_[^\/]+\.(webp|jpg|jpeg|png))/);
  if (match && match[1]) {
    return match[1];
  }
  
  // 如果无法提取，生成随机文件名
  const randomName = `instagram_${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`;
  console.log(`无法从URL提取文件名，使用随机名称: ${randomName}`);
  return randomName;
};

const downloadImage = async (url: string, customFilename?: string) => {
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
  });
  
  // 使用原始文件名或自定义文件名
  const filename = customFilename || getOriginalFilenameFromUrl(url);
  const filePath = path.join(PHOTOS_DIR, filename);
  
  const writer = fs.createWriteStream(filePath);
  
  response.data.pipe(writer);
  
  return new Promise<string>((resolve, reject) => {
    writer.on('finish', () => resolve(filename));
    writer.on('error', (err) => reject(err));
  });
};

// 保存Instagram数据到JSON文件，只保留图片链接、时间、图片宽高和文本
const saveInstagramData = async (data: any) => {
  try {
    // 创建精简版数据结构
    const simplifiedData = data.map((item: any) => {
      // 获取图片URL、宽高
      let imageUrl = '';
      let width = 0;
      let height = 0;
      
      // 获取图片信息
      if (item.image_versions2 && item.image_versions2.candidates && item.image_versions2.candidates.length > 0) {
        const image = item.image_versions2.candidates[0];
        imageUrl = image.url;
        width = image.width;
        height = image.height;
      } else if (item.carousel_media && item.carousel_media.length > 0) {
        // 如果是轮播图，获取第一张图片
        const firstMedia = item.carousel_media[0];
        if (firstMedia.image_versions2 && firstMedia.image_versions2.candidates && firstMedia.image_versions2.candidates.length > 0) {
          const image = firstMedia.image_versions2.candidates[0];
          imageUrl = image.url;
          width = image.width;
          height = image.height;
        }
      }
      
      // 获取文本内容
      const caption = item.caption ? item.caption.text : '';
      
      // 获取时间
      const timestamp = item.taken_at;
      const date = new Date(timestamp * 1000).toISOString();
      
      // 返回精简结构
      return {
        id: item.id,
        timestamp: date,
        text: caption,
        image: {
          url: imageUrl,
          width: width,
          height: height
        },
        // 如果是轮播图，添加所有图片
        carousel_media: item.carousel_media ? item.carousel_media.map((media: any) => {
          if (media.image_versions2 && media.image_versions2.candidates && media.image_versions2.candidates.length > 0) {
            const image = media.image_versions2.candidates[0];
            return {
              url: image.url,
              width: image.width,
              height: image.height
            };
          }
          return null;
        }).filter(Boolean) : []
      };
    });
    
    fs.writeFileSync(JSON_FILE_PATH, JSON.stringify(simplifiedData, null, 2));
    console.log(`精简版Instagram数据已保存到 ${JSON_FILE_PATH}`);
    return simplifiedData;
  } catch (error) {
    console.error('保存Instagram数据失败:', error.message);
    throw error;
  }
};

async function main() {
  try {
    await setCookies();
    
    const isLoggedIn = await checkLogin();
    if (!isLoggedIn) {
      throw new Error('无法登录Instagram');
    }
    
    const username = process.env.INSTAGRAM_USERNAME;
    if (!username) {
      throw new Error('环境变量中未找到Instagram用户名');
    }
    
    const userInfo = await getUserInfo(username);
    console.log(`成功获取用户信息: ${userInfo.username}`);
    
    const feedItems = await getUserFeedItems(username);
    console.log(`获取到${feedItems.length}条Instagram帖子`);
    
    // 保存精简版数据到JSON文件
    const simplifiedData = await saveInstagramData(feedItems);
    
    // 下载照片到photos目录
    const photos: any = [];
    
    // 处理所有帖子
    for (let i = 0; i < simplifiedData.length; i++) {
      const item = simplifiedData[i];
      
      // 处理单张图片
      if (item.image && item.image.url) {
        const filename = await downloadImage(item.image.url);
        console.log(`已下载照片: ${filename}`);
        photos.push({
          url: `instagram/photos/${filename}`,
          timestamp: item.timestamp,
          text: item.text
        });
      }
      
      // 处理轮播图中的所有图片
      if (item.carousel_media && item.carousel_media.length > 0) {
        for (let j = 0; j < item.carousel_media.length; j++) {
          const media = item.carousel_media[j];
          if (media && media.url) {
            const filename = await downloadImage(media.url);
            console.log(`已下载轮播图照片: ${filename}`);
            
            // 只将第一张轮播图添加到README中
            if (j === 0) {
              photos.push({
                url: `instagram/photos/${filename}`,
                timestamp: item.timestamp,
                text: item.text
              });
            }
          }
        }
      }
      
      // 只处理前6个帖子用于README显示
      if (photos.length >= 6) {
        break;
      }
    }
    
    console.log('Instagram数据同步完成');
  } catch (error) {
    console.error('Instagram工作流错误:', error.message);
    process.exit(1);
  }
}

main();
