<div align="center">

# 🎵 Music Story Studio

**Paste a music link. Get a shareable MP4 story.**

Link → metadata → artwork → audio → snippet → customize → rendered video.

![Python](https://img.shields.io/badge/python-3.12-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-000?logo=nextdotjs&logoColor=white)
![Remotion](https://img.shields.io/badge/Remotion-0B84F3?logo=remotion&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

</div>

<!-- Add a screenshot or GIF here: docs/screenshot.png -->

## Features

- **Link recognition** – paste a Spotify, Apple Music, Deezer, Bandcamp or YouTube link and get title, artist and cover art (via official APIs, oEmbed or Open Graph tags).
- **Artwork picker** – choose from candidate covers, or upload your own image.
- **Audio snippet editor** – waveform view with beat analysis for picking the exact clip; upload your own audio or fetch it with the optional yt-dlp adapter.
- **Photo Story** – build a story from your own photos instead of cover art.
- **Live editor** – templates, typography, colors, animations and visualizers, previewed in the browser with the same React components used for the final render.
- **MP4 export** – server-side rendering with [Remotion](https://www.remotion.dev) (H.264 + AAC), verified with `ffprobe`, with live progress over SSE. Presets: Draft, Standard, High.

## Architecture

```
apps/web            Next.js editor (UI, live preview)
apps/renderer       Node script that renders compositions to MP4 with Remotion
packages/compositions   Shared React compositions (preview and render use the same code)
backend             FastAPI: link parsing, providers, artwork, audio, render queue
deploy              Dockerfiles and Oracle Cloud hosting guide
```

## Quick start

### Prerequisites

- macOS (the `make setup` target uses Homebrew; on Linux install the tools below manually)
- Python 3.12, [uv](https://docs.astral.sh/uv/), Node 20+, [pnpm](https://pnpm.io), `ffmpeg`, and `yt-dlp` (optional)
- Chrome or Chromium (used by the renderer; auto-detected, or set `CHROME_PATH`)

### Run

```bash
git clone <your-fork-url> music-story-studio
cd music-story-studio
make setup   # installs tools, copies .env.example to .env, installs deps
make dev     # API on :8000, web on :3000
```

Open <http://localhost:3000>.

### Configuration

Copy `.env.example` to `.env`. Everything is optional:

| Variable | Purpose |
| --- | --- |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Richer Spotify metadata (falls back to oEmbed / OG tags) |
| `YOUTUBE_API_KEY` | Ranked YouTube search for audio matching |
| `ENABLE_YTDLP` | Enable the yt-dlp audio adapter (see [legal note](#legal-notes)) |
| `DATA_DIR` | Where uploads, assets and render history are stored (default `./data`) |
| `CHROME_PATH` | Chrome/Chromium binary for rendering |
| `RENDER_ASSET_BASE` | URL the renderer's browser uses to fetch covers/audio |
| `RENDER_TIMEOUT_S` | Render timeout |

### Make targets

| Command | What it does |
| --- | --- |
| `make setup` | Install toolchain and project dependencies |
| `make dev` | Run API + web in the foreground |
| `make start` / `make stop` / `make logs` | Run in the background |
| `make test` | Backend (pytest) and frontend tests |
| `make lint` | ruff and ESLint |
| `make build` | Production web build |
| `make update-ytdlp` | Upgrade yt-dlp (it breaks often) |

## Exporting video

The editor's **Export** button queues a job in FastAPI. A Node script (`apps/renderer`) renders the same `@mss/compositions` components the editor previews, and the output is validated with `ffprobe` before download.

- The first export bundles the renderer (~10–20s); later ones reuse `data/renderer-cache`.
- One export runs at a time, limited to 5 minutes. History is stored in `data/renders.db`.
- Without a local Chrome, Remotion downloads its own headless browser on first use.

## Hosting

Run everything on one machine with Docker Compose:

```bash
docker compose up -d --build
docker compose logs tunnel   # prints the public https://….trycloudflare.com URL
```

For a free always-on setup, follow [`deploy/ORACLE.md`](deploy/ORACLE.md) (Oracle Cloud + Cloudflare tunnel).

## API

The FastAPI backend serves interactive docs at <http://localhost:8000/docs> when running. Main endpoints under `/api/v1`: `detect`, `resolve`, `audio/*`, `artwork/*`, `uploads/*`, `assets/*`, `renders/*`.

## Contributing

Issues and PRs are welcome. Please run `make lint test` before opening a PR. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Legal notes

- **Audio:** downloading YouTube audio via yt-dlp conflicts with YouTube's Terms of Service. It is a personal-use feature isolated behind `ENABLE_YTDLP` and can be disabled or removed. Only use music you have the right to use.
- **Remotion licensing:** free for individuals and companies of up to three people; larger teams need a [Remotion company license](https://www.remotion.dev/license).
- Not affiliated with Spotify, Apple, Deezer, Bandcamp or YouTube.

## License

[MIT](LICENSE)
