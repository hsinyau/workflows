import dotenv from 'dotenv'
import { WakaTimeClient, RANGE } from 'wakatime-client'
import { Octokit } from '@octokit/rest'

dotenv.config()

const { WAKABOX_GIST_ID, GH_SECERT, WAKATIME_API_KEY } = process.env

if (!WAKABOX_GIST_ID || !GH_SECERT || !WAKATIME_API_KEY) {
  console.error('Missing required environment variables: WAKABOX_GIST_ID, GH_TOKEN, WAKATIME_API_KEY')
  process.exit(1)
}

type LanguageStat = {
  name: string
  percent: number
  text: string
}

type WakaStats = {
  data: {
    languages: LanguageStat[]
  }
}

const wakatime = new WakaTimeClient(WAKATIME_API_KEY)

const octokit = new Octokit({ auth: `token ${GH_SECERT}` })

async function main() {
  const stats: WakaStats = await wakatime.getMyStats({ range: RANGE.LAST_7_DAYS })
  // console.log(stats)
  await updateGist(stats);
}

function trimRightStr(str, len) {
  // Ellipsis takes 3 positions, so the index of substring is 0 to total length - 3.
  return str.length > len ? str.substring(0, len - 3) + "..." : str;
}

async function updateGist(stats: WakaStats) {
  let gist:
    | Awaited<ReturnType<typeof octokit.gists.get>>
    | undefined;
  try {
    gist = await octokit.gists.get({ gist_id: WAKABOX_GIST_ID! });
  } catch (error) {
    console.error(`Unable to get gist\n${error}`);
  }

  const lines: string[] = [];
  for (let i = 0; i < Math.min(stats.data.languages.length, 5); i++) {
    const data = stats.data.languages[i];
    const { name, percent, text: time } = data;

    const line = [
      trimRightStr(name, 10).padEnd(10),
      time.padEnd(14),
      generateBarChart(percent, 21),
      String(percent.toFixed(1)).padStart(5) + "%"
    ];

    lines.push(line.join(" "));
  }

  if (lines.length == 0) return;

  try {
    // Get original filename to update that same file
    const filename = gist && gist.data && gist.data.files ? Object.keys(gist.data.files)[0] : undefined
    if (!filename) return
    await octokit.gists.update({
      gist_id: WAKABOX_GIST_ID!,
      files: {
        [filename]: {
          filename: `📊 Weekly development breakdown`,
          content: lines.join("\n")
        }
      }
    });
  } catch (error) {
    console.error(`Unable to update gist\n${error}`);
  }
}

function generateBarChart(percent, size) {
  const syms = "░▏▎▍▌▋▊▉█";

  const frac = Math.floor((size * 8 * percent) / 100);
  const barsFull = Math.floor(frac / 8);
  if (barsFull >= size) {
    return syms.substring(8, 9).repeat(size);
  }
  const semi = frac % 8;

  return [syms.substring(8, 9).repeat(barsFull), syms.substring(semi, semi + 1)]
    .join("")
    .padEnd(size, syms.substring(0, 1));
}

// Run the script
if (require.main === module) {
  main();
}
