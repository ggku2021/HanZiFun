import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import { minify as minifyHtml } from "html-minifier-terser";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
const packageVersion = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
const { execSync } = await import("node:child_process");
let gitCommit = "unknown";
try { gitCommit = execSync("git rev-parse --short HEAD").toString().trim(); } catch {}
const fingerprint = createHash("sha256");
for (const file of [
  "index.html",
  "robots.txt",
  "sitemap.xml",
  "tailwind.css",
  "style.css",
  "app.js",
  "service-worker.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "data/content-templates.js",
  "data/strokes.js",
  "data/stroke-index.js",
  "data/pinyin.js",
  "vendor/fflate.min.js",
  "vendor/jspdf.umd.min.js",
]) {
  fingerprint.update(await readFile(path.join(root, file)));
}
for (const file of (await readdir(path.join(root, "data"))).filter((file) => /^strokes-pack-\d+(?:-[a-f0-9]+)?\.zip$/.test(file)).sort()) {
  fingerprint.update(await readFile(path.join(root, "data", file)));
}
const version = `v${packageVersion}-${gitCommit}-${fingerprint.digest("hex").slice(0, 10)}`;
const cdnBase = "https://cdn.jsdelivr.net/gh/rickytan/HanZiFun@main";

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

async function minifyJavaScript(source, target, replacements = {}) {
  let code = await readFile(path.join(root, source), "utf8");
  for (const [key, value] of Object.entries(replacements)) code = code.replaceAll(key, value);
  const result = await transform(code, { minify: true, target: "es2020", legalComments: "none" });
  await writeFile(path.join(output, target), result.code);
}

const html = await minifyHtml(await readFile(path.join(root, "index.html"), "utf8"), {
  collapseWhitespace: true,
  removeComments: true,
  removeRedundantAttributes: true,
  sortAttributes: true,
  sortClassName: true,
});
await writeFile(path.join(output, "index.html"), html);

const css = await transform(await readFile(path.join(root, "style.css"), "utf8"), {
  loader: "css",
  minify: true,
  target: "es2020",
});
await writeFile(path.join(output, "style.css"), css.code);
await cp(path.join(root, "tailwind.css"), path.join(output, "tailwind.css"));

await minifyJavaScript("app.js", "app.js", { __BUILD_VERSION__: version, __CDN_BASE__: cdnBase });
await minifyJavaScript("service-worker.js", "service-worker.js", { __BUILD_VERSION__: version });
await cp(path.join(root, "data"), path.join(output, "data"), { recursive: true });
await rm(path.join(output, "data", "characters"), { recursive: true, force: true });
await cp(path.join(root, "icons"), path.join(output, "icons"), { recursive: true });
const vendorFiles = [
  "fflate.min.js",
  "fflate.LICENSE",
  "jspdf.umd.min.js",
  "jspdf.LICENSE",
  "hb-subset.wasm",
  "hb-subset.LICENSE",
  "kai.LICENSE",
  "zip.LICENSE",
  "fonts/kai.ttf",
  "fonts/kai-chars.json",
  "fonts/song.ttf",
  "fonts/song-chars.json",
  "fonts/hei.ttf",
  "fonts/hei-chars.json",
  "fonts/fangsong.ttf",
  "fonts/fangsong-chars.json",
];
for (const file of vendorFiles) {
  const target = path.join(output, "vendor", file);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(path.join(root, "vendor", file), target);
}
await cp(path.join(root, "manifest.webmanifest"), path.join(output, "manifest.webmanifest"));
await cp(path.join(root, "robots.txt"), path.join(output, "robots.txt"));
await cp(path.join(root, "sitemap.xml"), path.join(output, "sitemap.xml"));
await cp(path.join(root, "NOTICE.md"), path.join(output, "NOTICE.md"));

async function directorySize(directory) {
  const { output: size } = await import("node:child_process").then(({ execFile }) =>
    new Promise((resolve, reject) => execFile("du", ["-sk", directory], (error, stdout) => error ? reject(error) : resolve({ output: stdout.trim().split(/\s+/)[0] })))
  );
  return Number(size) * 1024;
}

const appShellFiles = ["index.html", "tailwind.css", "style.css", "app.js", "service-worker.js", "manifest.webmanifest"];
let appShellBytes = 0;
for (const file of appShellFiles) appShellBytes += (await stat(path.join(output, file))).size;
console.log(`Built dist/: app shell ${(appShellBytes / 1024).toFixed(1)}KB, total ${((await directorySize(output)) / 1024 / 1024).toFixed(1)}MB.`);
