import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_PUBLIC_KEY =
  process.env.DISCORD_PUBLIC_KEY || 'fd9dd86cfeb0d94d65b9371d81a83de023bc93b82debc87f9ba449f631401b4c';
const GUILD_ID = process.env.GUILD_ID || '1540374512812425236';
const DEFAULT_CHANNEL_ID = '1540375006578737213'; // #🎸-now-listening
const HOST_URL = (process.env.HOST_URL || 'https://mag-video-dropzone.onrender.com').replace(/\/+$/, '');
const PORT = Number(process.env.PORT || 8080);
const MAX_DISCORD_BYTES = 9.5 * 1024 * 1024; // 9.5 MB Discord free limit safe ceiling

if (!DISCORD_TOKEN) {
  console.warn('⚠️ Warning: DISCORD_TOKEN environment variable is not set!');
}

const KNOWN_USERS = [
  {
    id: '336972475906654209',
    username: '.fartland',
    displayName: 'Fartland',
    avatar: 'https://cdn.discordapp.com/avatars/336972475906654209/62de4b557500bde555ebd267d013855f.png?size=256',
  },
  {
    id: '351229276097347584',
    username: 'ianisrad',
    displayName: 'ianisrad',
    avatar: 'https://cdn.discordapp.com/avatars/351229276097347584/e204e72e4ad65cd068670ab38d8af1f0.png?size=256',
  },
  {
    id: '358810768239624192',
    username: 'brebb',
    displayName: 'brebbory',
    avatar: 'https://cdn.discordapp.com/avatars/358810768239624192/3e3ae418e99e7419184ae9960bfa532e.png?size=256',
  },
  {
    id: '529408058229784581',
    username: 'jungluck',
    displayName: 'younglucas',
    avatar: 'https://cdn.discordapp.com/avatars/529408058229784581/b8d906acb99df9f34c870906f8e20e47.png?size=256',
  },
  {
    id: '377119901506076675',
    username: 'fleeceitout69',
    displayName: 'Marshall',
    avatar: 'https://cdn.discordapp.com/avatars/377119901506076675/4594042501e0ee95bb4a0157359f8ba3.png?size=256',
  },
  {
    id: '788571716015226920',
    username: 'papajamon',
    displayName: 'PapaJamón',
    avatar: 'https://cdn.discordapp.com/avatars/788571716015226920/8ef5d6cf74361ee7103f63279041aeff.png?size=256',
  },
  {
    id: '176848796804841474',
    username: 'waidoomariommi',
    displayName: 'MO-SKI',
    avatar: 'https://cdn.discordapp.com/avatars/176848796804841474/4ead1501eb30830eb18695ce350a5814.png?size=256',
  },
  {
    id: '461520339936215050',
    username: 'bripbropdontstop',
    displayName: 'bripbropdontstop',
    avatar: null,
  },
  {
    id: '768268927577882665',
    username: 'greennudedeal',
    displayName: 'greennudedeal',
    avatar: null,
  },
];

let cachedChannels = null;
let cachedChannelsAt = 0;
const webhookCache = new Map();

async function discordApi(endpoint, options = {}) {
  const res = await fetch(`https://discord.com/api/v10${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bot ${DISCORD_TOKEN}`,
      ...(options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord API ${endpoint} (${res.status}): ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function getGuildChannels() {
  if (cachedChannels && Date.now() - cachedChannelsAt < 60_000) {
    return cachedChannels;
  }
  const chans = await discordApi(`/guilds/${GUILD_ID}/channels`);
  const priorityIds = [
    '1540375006578737213', // #🎸-now-listening
    '1540374888899153920', // #🐶-cute-stuff
    '1540374514322641009', // #🌎-general
    '1540375066972397589', // #🍿-now-watching
    '1540375168549916812', // #💪-what-im-working-on
    '1540374938832085143', // #🥗-let-him-cook
  ];
  const textChans = chans
    .filter((c) => c.type === 0)
    .map((c) => ({ id: c.id, name: c.name, position: c.position }))
    .sort((a, b) => {
      const pa = priorityIds.indexOf(a.id);
      const pb = priorityIds.indexOf(b.id);
      if (pa !== -1 && pb !== -1) return pa - pb;
      if (pa !== -1) return -1;
      if (pb !== -1) return 1;
      return a.position - b.position;
    });
  cachedChannels = textChans;
  cachedChannelsAt = Date.now();
  return textChans;
}

async function getOrCreateChannelWebhook(channelId) {
  if (webhookCache.has(channelId)) {
    return webhookCache.get(channelId);
  }
  const hooks = await discordApi(`/channels/${channelId}/webhooks`);
  let hook = hooks.find((h) => h.name === 'magSlackArchiveHook' && h.token);
  if (!hook) {
    hook = await discordApi(`/channels/${channelId}/webhooks`, {
      method: 'POST',
      body: JSON.stringify({ name: 'magSlackArchiveHook' }),
    });
  }
  webhookCache.set(channelId, hook);
  return hook;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function getVideoDuration(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    const duration = parseFloat(stdout.trim());
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  } catch (err) {
    console.warn('ffprobe duration check failed:', err.message);
    return null;
  }
}

async function compressVideo(inputPath, originalExt) {
  const inputStat = fs.statSync(inputPath);

  // If already a small MP4, skip re-encoding
  if (originalExt === '.mp4' && inputStat.size <= MAX_DISCORD_BYTES) {
    return {
      outputPath: inputPath,
      summary: `${formatBytes(inputStat.size)} • Original MP4`,
      finalBytes: inputStat.size,
      originalBytes: inputStat.size,
      cleanup: () => {},
    };
  }

  const duration = await getVideoDuration(inputPath);
  console.log(`Input video duration: ${duration ? `${duration.toFixed(1)}s` : 'unknown'}`);

  // Target 8.8 MB to comfortably fit under 9.5 MB ceiling
  const TARGET_BYTES = 8.8 * 1024 * 1024;
  let videoBitrate = 1800; // default 1.8 Mbps
  if (duration && duration > 0) {
    const totalKbits = (TARGET_BYTES * 8) / 1024;
    const audioKbits = 128;
    const computed = Math.floor(totalKbits / duration - audioKbits);
    videoBitrate = Math.max(250, Math.min(computed, 4500));
  }

  const outPath = path.join(
    os.tmpdir(),
    `mag-vid-${crypto.randomBytes(6).toString('hex')}.mp4`
  );

  const ffmpegArgs = [
    '-y',
    '-i',
    inputPath,
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-vf',
    "scale='min(1280,iw)':-2", // keep aspect ratio, max 1280 wide
    '-b:v',
    `${videoBitrate}k`,
    '-maxrate',
    `${Math.round(videoBitrate * 1.4)}k`,
    '-bufsize',
    `${Math.round(videoBitrate * 2)}k`,
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outPath,
  ];

  console.log(`Running ffmpeg with target bitrate ${videoBitrate}k...`);
  await execFileAsync('ffmpeg', ffmpegArgs);

  if (!fs.existsSync(outPath)) {
    throw new Error('ffmpeg did not generate output file');
  }

  const outStat = fs.statSync(outPath);
  console.log(
    `ffmpeg compressed: ${formatBytes(inputStat.size)} -> ${formatBytes(outStat.size)}`
  );

  return {
    outputPath: outPath,
    summary: `${formatBytes(inputStat.size)} → ${formatBytes(outStat.size)} • 720p H.264`,
    finalBytes: outStat.size,
    originalBytes: inputStat.size,
    cleanup: () => {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    },
  };
}

async function uploadToCatboxFallback(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', new Blob([fileBuffer], { type: 'video/mp4' }), 'video.mp4');

  const res = await fetch('https://catbox.moe/user/api.php', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    throw new Error(`External video fallback failed (${res.status})`);
  }
  const url = (await res.text()).trim();
  if (!url.startsWith('https://')) {
    throw new Error(`Unexpected response from fallback host: ${url}`);
  }
  return url;
}

function buildVidsInteractionResponse(userId, channelId) {
  const targetChannel = channelId || DEFAULT_CHANNEL_ID;
  const userParam = userId ? `?user=${userId}&channel=${targetChannel}` : `?channel=${targetChannel}`;
  const dropzoneUrl = `${HOST_URL}/${userParam}`;

  return {
    type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
    data: {
      content: `📹 **MAGlite 69 Video Dropzone**\nUpload phone videos (.mov, .mp4) to auto-shrink to 720p HD and post directly into <#${targetChannel}>—no Nitro needed!`,
      components: [
        {
          type: 1, // ACTION_ROW
          components: [
            {
              type: 2, // BUTTON
              style: 5, // LINK
              label: 'Open Video Dropzone',
              url: dropzoneUrl,
              emoji: { name: '📹' },
            },
          ],
        },
      ],
    },
  };
}

function verifyDiscordInteraction(rawBody, signature, timestamp, clientPublicKey) {
  try {
    return crypto.verify(
      null,
      Buffer.concat([Buffer.from(timestamp, 'utf-8'), Buffer.from(rawBody, 'utf-8')]),
      crypto.createPublicKey({
        key: Buffer.concat([
          Buffer.from('302a300506032b6570032100', 'hex'),
          Buffer.from(clientPublicKey, 'hex'),
        ]),
        format: 'der',
        type: 'spki',
      }),
      Buffer.from(signature, 'hex')
    );
  } catch {
    return false;
  }
}

function renderHtmlPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <title>MAGlite 69 • Video Dropzone</title>
  <style>
    :root {
      --bg: #1e1f22;
      --card: #2b2d31;
      --input: #383a40;
      --text: #f2f3f5;
      --muted: #b5bac1;
      --blurple: #5865f2;
      --blurple-hover: #4752c4;
      --green: #23a55a;
      --border: #3f4147;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      justify-content: center;
      padding: 16px;
    }
    .container {
      width: 100%;
      max-width: 480px;
      background: var(--card);
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.35);
      border: 1px solid var(--border);
      align-self: flex-start;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }
    .logo {
      width: 42px;
      height: 42px;
      border-radius: 12px;
      background: var(--blurple);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      flex-shrink: 0;
    }
    h1 {
      font-size: 19px;
      margin: 0 0 2px 0;
      font-weight: 700;
    }
    .subtitle {
      font-size: 13px;
      color: var(--muted);
      margin: 0;
    }
    label {
      display: block;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
      margin: 16px 0 8px;
    }
    .user-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }
    .user-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      background: var(--input);
      border: 2px solid transparent;
      border-radius: 10px;
      cursor: pointer;
      color: var(--text);
      font-size: 13px;
      font-weight: 600;
      overflow: hidden;
      transition: all 0.15s ease;
      user-select: none;
    }
    .user-pill.active {
      border-color: var(--blurple);
      background: rgba(88, 101, 242, 0.18);
    }
    .user-pill img, .user-pill .avatar-fallback {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      flex-shrink: 0;
      object-fit: cover;
      background: #5865f2;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
    }
    .user-pill span {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    select, input[type="text"], textarea {
      width: 100%;
      background: var(--input);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px;
      font-size: 15px;
      font-family: inherit;
      outline: none;
    }
    select:focus, input[type="text"]:focus, textarea:focus {
      border-color: var(--blurple);
    }
    textarea {
      resize: vertical;
      min-height: 68px;
    }
    .dropzone {
      border: 2px dashed var(--border);
      border-radius: 14px;
      padding: 24px 16px;
      text-align: center;
      background: rgba(56, 58, 64, 0.5);
      cursor: pointer;
      transition: all 0.15s ease;
      position: relative;
    }
    .dropzone:hover, .dropzone.dragover {
      border-color: var(--blurple);
      background: rgba(88, 101, 242, 0.1);
    }
    .dropzone input[type="file"] {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
      width: 100%;
      height: 100%;
    }
    .drop-icon {
      font-size: 32px;
      margin-bottom: 6px;
    }
    .drop-title {
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .drop-hint {
      font-size: 12px;
      color: var(--muted);
    }
    .file-preview {
      margin-top: 12px;
      background: var(--input);
      border-radius: 10px;
      padding: 10px 12px;
      display: none;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      font-size: 13px;
    }
    .file-preview.visible {
      display: flex;
    }
    .badge {
      background: rgba(35, 165, 90, 0.2);
      color: #4ade80;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
    }
    .submit-btn {
      margin-top: 18px;
      width: 100%;
      background: var(--blurple);
      color: #fff;
      border: none;
      border-radius: 12px;
      padding: 14px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .submit-btn:hover:not(:disabled) {
      background: var(--blurple-hover);
    }
    .submit-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .status-box {
      margin-top: 14px;
      padding: 12px;
      border-radius: 10px;
      background: var(--input);
      display: none;
      font-size: 14px;
    }
    .status-box.visible {
      display: block;
    }
    .progress-bar-wrap {
      width: 100%;
      height: 8px;
      background: #1e1f22;
      border-radius: 99px;
      overflow: hidden;
      margin-top: 8px;
    }
    .progress-bar {
      height: 100%;
      width: 0%;
      background: var(--blurple);
      transition: width 0.2s ease;
    }
    .success-link {
      display: inline-block;
      margin-top: 10px;
      background: var(--green);
      color: #fff;
      text-decoration: none;
      padding: 8px 14px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">🎸</div>
      <div>
        <h1>MAGlite 69 Video Dropzone</h1>
        <p class="subtitle">24/7 video uploader • Shrinks big phone clips to HD &amp; posts them under your name in Discord.</p>
      </div>
    </div>

    <form id="uploadForm">
      <label>1. Who are you?</label>
      <div class="user-grid" id="userGrid"></div>

      <label for="channelSelect">2. Discord Channel</label>
      <select id="channelSelect" required></select>

      <label>3. Pick Video from Camera Roll</label>
      <div class="dropzone" id="dropzone">
        <div class="drop-icon">📹</div>
        <div class="drop-title" id="dropTitle">Tap to choose a video</div>
        <div class="drop-hint">Any size (.mov, .mp4) • Auto-converted to HD &lt;10 MB</div>
        <input type="file" id="fileInput" accept="video/*,image/*" required />
      </div>

      <div class="file-preview" id="filePreview">
        <span id="fileName" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
        <span class="badge" id="fileSizeBadge"></span>
      </div>

      <label for="captionInput">4. Message / Caption (optional)</label>
      <textarea id="captionInput" placeholder="Add a comment to go with your video..."></textarea>

      <button type="submit" class="submit-btn" id="submitBtn">Upload &amp; Post to Discord</button>

      <div class="status-box" id="statusBox">
        <div id="statusText">Preparing upload...</div>
        <div class="progress-bar-wrap" id="progressWrap">
          <div class="progress-bar" id="progressBar"></div>
        </div>
        <div id="resultActions"></div>
      </div>
    </form>
  </div>

  <script>
    const params = new URLSearchParams(window.location.search);
    let selectedUserId = params.get('user') || localStorage.getItem('mag_user_id') || '336972475906654209';
    const preselectedChannel = params.get('channel') || '${DEFAULT_CHANNEL_ID}';

    const userGrid = document.getElementById('userGrid');
    const channelSelect = document.getElementById('channelSelect');
    const fileInput = document.getElementById('fileInput');
    const filePreview = document.getElementById('filePreview');
    const fileNameEl = document.getElementById('fileName');
    const fileSizeBadge = document.getElementById('fileSizeBadge');
    const dropTitle = document.getElementById('dropTitle');
    const submitBtn = document.getElementById('submitBtn');
    const statusBox = document.getElementById('statusBox');
    const statusText = document.getElementById('statusText');
    const progressBar = document.getElementById('progressBar');
    const progressWrap = document.getElementById('progressWrap');
    const resultActions = document.getElementById('resultActions');

    function formatMB(bytes) {
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    async function init() {
      const res = await fetch('/api/meta');
      const data = await res.json();

      const matchedByName = data.users.find(
        u => u.id === selectedUserId ||
             u.username.replace(/^\\./, '').toLowerCase() === selectedUserId.toLowerCase() ||
             u.displayName.toLowerCase() === selectedUserId.toLowerCase()
      );
      if (matchedByName) selectedUserId = matchedByName.id;

      userGrid.innerHTML = '';
      for (const u of data.users) {
        const pill = document.createElement('div');
        pill.className = 'user-pill' + (u.id === selectedUserId ? ' active' : '');
        const avatarHtml = u.avatar
          ? '<img src="' + u.avatar + '" alt="" />'
          : '<div class="avatar-fallback">' + u.displayName.slice(0, 2).toUpperCase() + '</div>';
        pill.innerHTML = avatarHtml + '<span>' + u.displayName + '</span>';
        pill.onclick = () => {
          selectedUserId = u.id;
          localStorage.setItem('mag_user_id', u.id);
          document.querySelectorAll('.user-pill').forEach(el => el.classList.remove('active'));
          pill.classList.add('active');
        };
        userGrid.appendChild(pill);
      }

      channelSelect.innerHTML = '';
      for (const c of data.channels) {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = '#' + c.name;
        if (c.id === preselectedChannel) opt.selected = true;
        channelSelect.appendChild(opt);
      }
    }

    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0];
      if (!f) return;
      dropTitle.textContent = 'Selected: ' + f.name;
      fileNameEl.textContent = f.name;
      fileSizeBadge.textContent = formatMB(f.size) + (f.size > 9.5 * 1024 * 1024 ? ' → Auto-shrink' : ' → Ready');
      filePreview.classList.add('visible');
    });

    document.getElementById('uploadForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const file = fileInput.files[0];
      if (!file) return;

      submitBtn.disabled = true;
      statusBox.classList.add('visible');
      progressWrap.style.display = 'block';
      resultActions.innerHTML = '';
      progressBar.style.width = '0%';
      statusText.textContent = 'Uploading video (' + formatMB(file.size) + ')...';

      const channelId = channelSelect.value;
      const caption = document.getElementById('captionInput').value;

      const xhr = new XMLHttpRequest();
      const url = '/api/upload?userId=' + encodeURIComponent(selectedUserId) +
                  '&channelId=' + encodeURIComponent(channelId) +
                  '&caption=' + encodeURIComponent(caption) +
                  '&filename=' + encodeURIComponent(file.name);

      xhr.open('POST', url, true);

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          const pct = Math.round((ev.loaded / ev.total) * 75);
          progressBar.style.width = pct + '%';
          if (ev.loaded >= ev.total) {
            statusText.textContent = '⚡ Compressing video to HD MP4 & posting to Discord...';
            progressBar.style.width = '88%';
          } else {
            statusText.textContent = 'Uploading video... ' + Math.round((ev.loaded / ev.total) * 100) + '%';
          }
        }
      };

      xhr.onload = () => {
        submitBtn.disabled = false;
        try {
          const resp = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300 && resp.ok) {
            progressBar.style.width = '100%';
            progressBar.style.background = '#23a55a';
            statusText.innerHTML = '✅ <strong>Posted to Discord!</strong> (' + resp.summary + ')';
            resultActions.innerHTML =
              '<a class="success-link" href="' + resp.discordUrl + '" target="_blank">Open in Discord →</a>';
            document.getElementById('captionInput').value = '';
          } else {
            progressWrap.style.display = 'none';
            statusText.innerHTML = '❌ Error: ' + (resp.error || 'Upload failed');
          }
        } catch (err) {
          progressWrap.style.display = 'none';
          statusText.textContent = '❌ Unexpected server response';
        }
      };

      xhr.onerror = () => {
        submitBtn.disabled = false;
        progressWrap.style.display = 'none';
        statusText.textContent = '❌ Network error while uploading.';
      };

      xhr.send(file);
    });

    init();
  </script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      res.end(renderHtmlPage());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/meta') {
      const channels = await getGuildChannels();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ users: KNOWN_USERS, channels }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/interactions') {
      const signature = req.headers['x-signature-ed25519'];
      const timestamp = req.headers['x-signature-timestamp'];
      if (!signature || !timestamp) {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('Missing signature headers');
        return;
      }

      let rawBody = '';
      req.on('data', (chunk) => {
        rawBody += chunk;
      });
      req.on('end', () => {
        const isValid = verifyDiscordInteraction(
          rawBody,
          signature,
          timestamp,
          DISCORD_PUBLIC_KEY
        );
        if (!isValid) {
          res.writeHead(401, { 'Content-Type': 'text/plain' });
          res.end('Invalid signature');
          return;
        }

        const interaction = JSON.parse(rawBody);
        if (interaction.type === 1) {
          // PING -> PONG
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ type: 1 }));
          return;
        }

        if (interaction.type === 2 && interaction.data?.name === 'vids') {
          const userId = interaction.member?.user?.id || interaction.user?.id;
          const channelId = interaction.channel_id;
          const responseBody = buildVidsInteractionResponse(userId, channelId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(responseBody));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ type: 4, data: { content: 'Unknown command' } }));
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/upload') {
      const userId = url.searchParams.get('userId') || '336972475906654209';
      const channelId = url.searchParams.get('channelId') || DEFAULT_CHANNEL_ID;
      const caption = (url.searchParams.get('caption') || '').trim();
      const rawFilename = url.searchParams.get('filename') || 'video.mov';
      const ext = (path.extname(rawFilename) || '.mov').toLowerCase();

      const user =
        KNOWN_USERS.find((u) => u.id === userId) || KNOWN_USERS[0];

      const tempInputPath = path.join(
        os.tmpdir(),
        `mag-upload-${crypto.randomBytes(6).toString('hex')}${ext}`
      );
      const writeStream = fs.createWriteStream(tempInputPath);

      let totalBytes = 0;
      const MAX_UPLOAD_BYTES = 250 * 1024 * 1024; // 250 MB max upload

      await new Promise((resolve, reject) => {
        req.on('data', (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_UPLOAD_BYTES) {
            req.destroy(new Error('File exceeds 250 MB limit'));
            return;
          }
          writeStream.write(chunk);
        });
        req.on('end', () => {
          writeStream.end(resolve);
        });
        req.on('error', reject);
        writeStream.on('error', reject);
      });

      console.log(
        `📥 Received upload from ${user.displayName}: ${rawFilename} (${formatBytes(totalBytes)}) for channel ${channelId}`
      );

      let compressed = null;
      try {
        compressed = await compressVideo(tempInputPath, ext);
        const hook = await getOrCreateChannelWebhook(channelId);

        let postedMsg;
        let summaryText;

        if (compressed.finalBytes <= MAX_DISCORD_BYTES) {
          const fileBuf = fs.readFileSync(compressed.outputPath);
          const cleanBase =
            path
              .basename(rawFilename, path.extname(rawFilename))
              .replace(/[^a-zA-Z0-9_-]/g, '_')
              .slice(0, 40) || 'video';
          const outName = `${cleanBase}.mp4`;

          const form = new FormData();
          form.append(
            'payload_json',
            JSON.stringify({
              username: user.displayName,
              avatar_url: user.avatar || undefined,
              content: caption || undefined,
              allowed_mentions: { parse: ['users'] },
            })
          );
          form.append('files[0]', new Blob([fileBuf], { type: 'video/mp4' }), outName);

          const hookRes = await fetch(
            `https://discord.com/api/v10/webhooks/${hook.id}/${hook.token}?wait=true`,
            {
              method: 'POST',
              body: form,
            }
          );

          if (!hookRes.ok) {
            const errTxt = await hookRes.text();
            throw new Error(`Discord webhook upload failed (${hookRes.status}): ${errTxt}`);
          }
          postedMsg = await hookRes.json();
          summaryText = compressed.summary;
        } else {
          const externalUrl = await uploadToCatboxFallback(compressed.outputPath);
          const contentWithVideo = caption ? `${caption}\n${externalUrl}` : externalUrl;
          const hookRes = await fetch(
            `https://discord.com/api/v10/webhooks/${hook.id}/${hook.token}?wait=true`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                username: user.displayName,
                avatar_url: user.avatar || undefined,
                content: contentWithVideo,
                allowed_mentions: { parse: ['users'] },
              }),
            }
          );
          if (!hookRes.ok) {
            const errTxt = await hookRes.text();
            throw new Error(`Discord webhook post failed (${hookRes.status}): ${errTxt}`);
          }
          postedMsg = await hookRes.json();
          summaryText = `${formatBytes(compressed.originalBytes)} → HD Stream`;
        }

        const discordUrl = `https://discord.com/channels/${GUILD_ID}/${channelId}/${postedMsg.id}`;
        console.log(`✅ Posted video for ${user.displayName}: ${discordUrl} (${summaryText})`);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            ok: true,
            messageId: postedMsg.id,
            discordUrl,
            summary: summaryText,
          })
        );
      } finally {
        if (compressed && compressed.outputPath !== tempInputPath) {
          compressed.cleanup();
        }
        if (fs.existsSync(tempInputPath)) {
          fs.unlinkSync(tempInputPath);
        }
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (err) {
    console.error('Server error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
});

function startDiscordGateway() {
  if (!DISCORD_TOKEN) return;

  let ws = null;
  let heartbeatTimer = null;
  let heartbeatAcked = true;
  let isAlive = true;

  function connect() {
    console.log('Connecting to Discord Gateway for /vids slash command...');
    try {
      ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
    } catch (err) {
      console.error('Failed to create WebSocket:', err);
      setTimeout(connect, 5000);
      return;
    }

    ws.onopen = () => {
      console.log('✅ Connected to Discord Gateway (listening for /vids)...');
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.op === 10) {
          heartbeatAcked = true;
          const interval = msg.d.heartbeat_interval;
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          heartbeatTimer = setInterval(() => {
            if (!heartbeatAcked) {
              console.warn('Gateway heartbeat missed; reconnecting...');
              try {
                ws.close();
              } catch {}
              return;
            }
            heartbeatAcked = false;
            try {
              ws.send(JSON.stringify({ op: 1, d: null }));
            } catch {}
          }, interval);

          ws.send(
            JSON.stringify({
              op: 2,
              d: {
                token: DISCORD_TOKEN,
                intents: 0,
                properties: { os: 'linux', browser: 'mag-dropzone', device: 'mag-dropzone' },
              },
            })
          );
        } else if (msg.op === 11) {
          heartbeatAcked = true;
        } else if (msg.op === 0 && msg.t === 'INTERACTION_CREATE') {
          const interaction = msg.d;
          if (interaction.type === 2 && interaction.data?.name === 'vids') {
            const userId = interaction.member?.user?.id || interaction.user?.id;
            const channelId = interaction.channel_id;
            const responseBody = buildVidsInteractionResponse(userId, channelId);

            await fetch(
              `https://discord.com/api/v10/interactions/${interaction.id}/${interaction.token}/callback`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bot ${DISCORD_TOKEN}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(responseBody),
              }
            );
            console.log(`✅ Handled /vids via Gateway for user ${userId} in #${channelId}`);
          }
        }
      } catch (err) {
        console.error('Gateway message handler error:', err);
      }
    };

    ws.onclose = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (isAlive) {
        console.log('Gateway closed; reconnecting in 5s...');
        setTimeout(connect, 5000);
      }
    };

    ws.onerror = (err) => {
      console.error('Gateway WebSocket error:', err.message || err);
    };
  }

  connect();
}

server.listen(PORT, () => {
  console.log(`🎬 24/7 MAGlite 69 Video Dropzone listening on port ${PORT}`);
  startDiscordGateway();
});
