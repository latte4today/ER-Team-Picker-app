import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'er-concordance-'));
const input = path.join(scratch, 'fixture.jsonl');
const members = ['seres:two_handed_sword', 'lucia:sniper_rifle', 'rio:bow']
  .map(variantId => ({ variantId, characterId: variantId.split(':')[0] }));
const run = () => spawnSync(process.execPath, ['tools/backtest_recommender.mjs',
  '--data', input, '--metric', 'concordance', '--configs', 'lean', '--no-control',
  '--games', '1', '--scan', '100'], { encoding: 'utf8' });
try {
  // Identical team builds must tie despite different observed placements. A tie
  // contributes 0.5; comparing score objects instead of numbers incorrectly gave 0.
  await fs.writeFile(input, [1, 2, 3, 4].map(placement => JSON.stringify({
    gameId: 'synthetic-tie', matchingMode: 3, tierBucket: 'all', members,
    result: { placement, isWin: placement === 1, isTop3: placement <= 3 },
  })).join('\n'));
  const tied = run();
  assert.equal(tied.status, 0, tied.stderr);
  assert.match(tied.stdout, /overall\s+conc=0\.500\s+pairs=6/);
  const samePlacement = (await fs.readFile(input, 'utf8')).split('\n').map(line => {
    const row = JSON.parse(line);
    row.result.placement = 1;
    return JSON.stringify(row);
  }).join('\n');
  await fs.writeFile(input, samePlacement);
  const incomparable = run();
  assert.notEqual(incomparable.status, 0);
  assert.match(incomparable.stderr, /No comparable placement pairs/);
  await fs.writeFile(input, '');
  const empty = run();
  assert.notEqual(empty.status, 0);
  assert.match(empty.stderr, /No eligible games/);
  console.log('Concordance regression passed: numeric ties count as 0.5; empty and incomparable inputs fail validation.');
} finally {
  await fs.rm(scratch, { recursive: true, force: true });
}
