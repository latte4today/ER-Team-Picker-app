/**
 * import_trait_images.mjs
 *
 * One-time helper: copy the 16 core (주특성) trait icons from your local
 * Eternal Return loadout image folder into the app's assets/traits/ folder
 * with clean slug filenames the app expects.
 *
 * Usage (from the repo root):
 *   node tools/import_trait_images.mjs
 *   node tools/import_trait_images.mjs "D:\\path\\to\\Loadout"   (custom source)
 *
 * After it finishes, commit the new files:
 *   git add assets/traits
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SOURCE = process.argv[2] || "C:/Users/WIN11/Desktop/ER/Loadout";
const DEST = path.join(ROOT, "assets", "traits");

// source (relative to SOURCE) -> destination slug filename
const MAP = {
  "01. Havoc/01. Frailty Infliction.png": "frailty-infliction.png",
  "01. Havoc/02. Vampiric Bloodline.png": "vampiric-bloodline.png",
  "01. Havoc/03. Adrenaline.png": "adrenaline.png",
  "01. Havoc/04. Accelerator.png": "accelerator.png",
  "02. Chaos/01. Stellar Charge.png": "stellar-charge.png",
  "02. Chaos/02. Ghost Light.png": "ghost-light.png",
  "02. Chaos/03. Red Sprite.png": "red-sprite.png",
  "02. Chaos/04. Siphon Maelstrom.png": "siphon-maelstrom.png",
  "03. Fortification/01. Diamond Shard.png": "diamond-shard.png",
  "03. Fortification/02. Ironclad.png": "ironclad.png",
  "03. Fortification/03. Heavy Kneepads.png": "heavy-kneepads.png",
  "03. Fortification/04. Bitter Retribution.png": "bitter-retribution.png",
  "04. Support/01. Healing Factor.png": "healing-factor.png",
  "04. Support/02. Amplification Drone.png": "amplification-drone.png",
  "04. Support/03. Healing Drone.png": "healing-drone.png",
  "04. Support/04. Sentinel.png": "sentinel.png",
};

fs.mkdirSync(DEST, { recursive: true });

let ok = 0;
let fail = 0;
for (const [rel, slug] of Object.entries(MAP)) {
  const src = path.join(SOURCE, rel);
  const dst = path.join(DEST, slug);
  try {
    fs.copyFileSync(src, dst);
    ok += 1;
  } catch (err) {
    console.warn(`MISSING: ${rel} (${err.code})`);
    fail += 1;
  }
}

console.log(`\nCopied ${ok}/${ok + fail} trait icons to ${path.relative(ROOT, DEST)}`);
if (fail > 0) {
  console.log(`Could not find ${fail}. Check the source path:\n  ${SOURCE}`);
  console.log(`Pass the correct folder as an argument if needed.`);
}
