# MAGlite 69 • Video Dropzone (24/7)

A 24/7 mobile-friendly video uploader for Discord `#🎸-now-listening` and other channels in MAGlite 69.

### Features
- **Auto-Shrink with `ffmpeg`:** Converts large iPhone `.mov` / `.mp4` videos down to 720p H.264 under 9.5 MB so they upload as native Discord attachments without needing Discord Nitro.
- **Direct Discord Webhook Posting:** Posts into the chosen Discord channel under the member's Discord display name & avatar.
- **Fallback for Extra Long Clips:** If a video is long and cannot fit under 9.5 MB, automatically uploads to high-speed stream storage so it embeds and plays inline in Discord.
- **Mobile Optimized:** Clean dark-mode UI with user pill selector and channel picker.

### Deploy to Render
1. Connect this repo to [Render](https://render.com) as a **Web Service** (Environment: Docker).
2. Set Environment Variables:
   - `DISCORD_TOKEN`: Your Discord Bot Token
   - `GUILD_ID`: `1540374512812425236`
   - `PORT`: `8080`
