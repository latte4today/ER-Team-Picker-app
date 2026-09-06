/**
 * strip_png_metadata.mjs — drop text chunks from PNGs.
 *
 * assets/characters/mini holds 122x160 portraits. Most are ~39KB, which is what
 * a 122x160 RGBA PNG costs. Twelve of them were 1.8-1.9MB, and the image was
 * never the problem:
 *
 *   camilo.png  1958KB = IDAT 33.8KB + iTXt 1923.7KB
 *   nadine.png    40KB = IDAT 39.3KB + iTXt 0.9KB
 *
 * That is an editor's XMP history riding along, 50x the size of the picture. It
 * shipped in every Vercel deployment and every installer.
 *
 * tEXt, zTXt and iTXt are ancillary chunks - decoders ignore them - so removing
 * them is lossless for the image. IDAT is copied byte for byte; this never
 * re-encodes, so it cannot change a pixel.
 *
 * Usage:
 *   node tools/strip_png_metadata.mjs                  # assets/, in place
 *   node tools/strip_png_metadata.mjs --check          # report only, exit 1 if any
 *   node tools/strip_png_metadata.mjs path/to/dir ...
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DROP = new Set(["tEXt", "zTXt", "iTXt"]);
// Anything above this in text chunks is not a caption, it is an editor's history.
const REPORT_THRESHOLD = 4096;

function parseArgs(argv) {
  const args = { check: false, targets: [] };
  for (const raw of argv.slice(2)) {
    if (raw === "--check") args.check = true;
    else args.targets.push(raw);
  }
  if (!args.targets.length) args.targets = ["assets"];
  return args;
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) yield full;
  }
}

/** Returns { output, dropped } or null when the file is not a PNG we understand. */
function stripChunks(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) return null;
  const keep = [buffer.subarray(0, 8)];
  let dropped = 0;
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const end = offset + 12 + length;
    // A truncated final chunk means the file is damaged; leave it completely alone
    // rather than writing back a half-file.
    if (end > buffer.length) return null;
    if (DROP.has(type)) dropped += length + 12;
    else keep.push(buffer.subarray(offset, end));
    offset = end;
    if (type === "IEND") break;
  }
  return { output: Buffer.concat(keep), dropped };
}

const args = parseArgs(process.argv);
const files = [];
for (const target of args.targets) {
  const full = path.resolve(ROOT, target);
  if (!fs.existsSync(full)) throw new Error(`no such path: ${target}`);
  if (fs.statSync(full).isDirectory()) files.push(...walk(full));
  else files.push(full);
}

let before = 0;
let after = 0;
let changed = 0;
const offenders = [];

for (const file of files) {
  const buffer = fs.readFileSync(file);
  before += buffer.length;
  const result = stripChunks(buffer);
  if (!result) {
    console.warn(`  ! skipped (not a readable PNG): ${path.relative(ROOT, file)}`);
    after += buffer.length;
    continue;
  }
  after += result.output.length;
  if (result.dropped === 0) continue;
  changed += 1;
  if (result.dropped >= REPORT_THRESHOLD) {
    offenders.push([path.relative(ROOT, file), buffer.length, result.output.length]);
  }
  if (!args.check) fs.writeFileSync(file, result.output);
}

const mb = (bytes) => `${(bytes / 1048576).toFixed(2)}MB`;
console.log(`${files.length} PNGs, ${changed} with text chunks`);
console.log(`${mb(before)} -> ${mb(after)} (${mb(before - after)} removed)`);
for (const [name, was, now] of offenders.sort((a, b) => (b[1] - b[2]) - (a[1] - a[2]))) {
  console.log(`  ${name}: ${(was / 1024).toFixed(0)}KB -> ${(now / 1024).toFixed(0)}KB`);
}

if (args.check && before !== after) {
  console.error(`::error title=PNG metadata::${mb(before - after)} of text chunks in ${changed} file(s); run node tools/strip_png_metadata.mjs`);
  process.exit(1);
}
