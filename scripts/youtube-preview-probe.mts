// Probe: run the server link preview on real YouTube URLs and print what comes back (title, image type, size). Usage: npx tsx scripts/youtube-preview-probe.mts <url> [...]
import { fetchLinkPreview } from "../apps/server/src/link-preview.ts"
import { youtubeIdOf } from "../packages/protocol/src/youtube.ts"

const urls = process.argv.slice(2)
for (const url of urls) {
  const t0 = Date.now()
  const id = youtubeIdOf(url)
  try {
    const r = await fetchLinkPreview(url)
    const img = r.image ?? ""
    console.log(JSON.stringify({ url, id, ms: Date.now() - t0, title: r.title?.slice(0, 40), imageType: img.slice(5, img.indexOf(";")), imageChars: img.length }))
  } catch (e) {
    console.log(JSON.stringify({ url, id, ms: Date.now() - t0, error: String(e) }))
  }
}
