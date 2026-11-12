# MAGlite 69 • Video Dropzone (24/7)

A 24/7 mobile-friendly video uploader for Discord `#🎸-now-listening` and other channels in MAGlite 69.

### Features
- **Auto-Shrink with `ffmpeg`:** Converts large iPhone `.mov` / `.mp4` videos down to 720p H.264 under 9.5 MB so they upload as native Discord attachments without needing Discord Nitro.
- **Direct Discord Webhook Posting:** Posts into the chosen Discord channel under the member's Discord display name & avatar.
- **Fallback for Extra Long Clips:** If a video is long and cannot fit under 9.5 MB, automatically uploads to high-speed stream storage so it embeds and plays inline in Discord.
- **Mobile Optimized:** Clean dark-mode UI with user pill selector and channel picker.

### 🚀 1-Click Deploy to Render (100% Free, No Credit Card)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://dashboard.render.com/blueprint/new?repo=https%3A%2F%2Fgithub.com%2Fyounglucas%2Fmag-video-dropzone)

1. Click the button above (or open [Render Blueprint](https://dashboard.render.com/blueprint/new?repo=https%3A%2F%2Fgithub.com%2Fyounglucas%2Fmag-video-dropzone)).
2. Sign in with GitHub (`younglucas`).
3. Set `DISCORD_TOKEN` to your Discord Bot Token.
4. Click **Apply**! Render will build the container with `ffmpeg` and assign a permanent `https://mag-video-dropzone.onrender.com` URL.
