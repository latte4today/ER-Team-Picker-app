import fs from 'node:fs/promises';
import {publicPage, seasonFromPage, SEASON_URL} from './season_metadata.mjs';
const jsonUrl = new URL('../src/seasonState.json',import.meta.url);
let previous;
try {previous=JSON.parse(await fs.readFile(jsonUrl,'utf8'));} catch {}
const state=seasonFromPage(await publicPage(SEASON_URL),previous);
const json=JSON.stringify(state);
await fs.writeFile(jsonUrl,json+'\n');
await fs.writeFile(new URL('../src/seasonState.js',import.meta.url),'// Generated public season metadata.\nexport const seasonState = '+json+';\n');
console.log(`Season ${state.seasonId}, ${state.phase}, patch ${state.patch}`);
