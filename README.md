# Music Story Studio

Paste a music link → metadata → artwork → audio → snippet → customize → render an MP4 story.
Full plan: see `docs/` (architecture to be added). Status: foundations + link recognition done.

```bash
make setup && make dev
```

**Audio caveat:** downloading YouTube audio (yt-dlp adapter) conflicts with YouTube's ToS; this is a
personal-use decision. It is isolated behind `ENABLE_YTDLP` and can be removed.

## Hosting online

See `deploy/ORACLE.md` for a free Oracle Cloud setup with Docker Compose and a Cloudflare tunnel.

## Exporting video

The editor's **Export** button renders an MP4 (H.264 + AAC) on the server: FastAPI queues the job, a Node
script (`apps/renderer`) renders the same `@mss/compositions` React components the editor previews with
Remotion, and the result is checked with `ffprobe` (codec and duration) before it is offered for download.
Progress streams to the browser over SSE. Presets: Draft (half resolution), Standard, High.

- Needs Node, ffmpeg and a Chrome/Chromium (found automatically, or set `CHROME_PATH`). Without one, Remotion
  tries to download its own headless browser on first use.
- The first export bundles the renderer (~10–20s); later ones reuse `data/renderer-cache`.
- One export runs at a time; exports are limited to 5 minutes. History lives in `data/renders.db`.
- **Licensing:** Remotion is free for individuals and companies of up to three people; larger teams need a
  Remotion company license (https://www.remotion.dev/license).
