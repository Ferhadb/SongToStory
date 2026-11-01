// Usage: node render.mjs <job.json>
// job: { project, assetBase, outPath, scale, crf, cacheDir }
// Emits one JSON object per line on stdout: {stage, progress?, message?}.
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");

function newestMtime(dir) {
  let m = 0;
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    m = Math.max(m, f.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs);
  }
  return m;
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ];
  return candidates.find((c) => existsSync(c)) ?? null; // null: Remotion downloads its own headless shell
}

async function main() {
  const job = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const compSrc = path.resolve(here, "../../packages/compositions/src");
  const stamp = Math.round(Math.max(newestMtime(path.join(here, "src")), newestMtime(compSrc)));
  const outDir = path.join(job.cacheDir, `bundle-${stamp}`);
  mkdirSync(job.cacheDir, { recursive: true });

  let serveUrl = outDir;
  if (!existsSync(path.join(outDir, "index.html"))) {
    emit({ stage: "bundling", progress: 0 });
    serveUrl = await bundle({ entryPoint: path.join(here, "src/index.tsx"), outDir });
    for (const d of readdirSync(job.cacheDir)) if (d.startsWith("bundle-") && d !== path.basename(outDir)) rmSync(path.join(job.cacheDir, d), { recursive: true, force: true });
  }

  const browserExecutable = findChrome();
  const inputProps = { project: job.project, assetBase: job.assetBase, analysis: job.analysis ?? null };
  emit({ stage: "preparing", progress: 0 });
  const composition = await selectComposition({ serveUrl, id: "Story", inputProps, browserExecutable });

  let lastPct = -1;
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: job.outPath,
    inputProps,
    browserExecutable,
    crf: job.crf ?? 18,
    scale: job.scale ?? 1,
    pixelFormat: "yuv420p",
    audioCodec: "aac",
    muted: !job.project.audio.snippetAssetId,
    concurrency: job.concurrency ?? null,
    onProgress: ({ progress, renderedFrames, encodedFrames, stitchStage }) => {
      const pct = Math.round(progress * 100);
      if (pct !== lastPct) {
        lastPct = pct;
        emit({ stage: stitchStage === "muxing" ? "finalizing" : encodedFrames < composition.durationInFrames ? "rendering" : "encoding", progress, renderedFrames, totalFrames: composition.durationInFrames });
      }
    },
  });
  emit({ stage: "done", progress: 1, totalFrames: composition.durationInFrames, width: composition.width, height: composition.height });
}

main().catch((e) => {
  emit({ stage: "error", message: String(e?.message ?? e).slice(0, 2000) });
  process.exit(1);
});
