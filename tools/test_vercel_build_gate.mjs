import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await fs.mkdtemp(path.join(root, '../../build-gate-'));
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const git = (...args) => {
  const result = spawnSync('git', args, {cwd:scratch, encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const commit = () => { git('add','.'); git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture'); return git('rev-parse','HEAD'); };
const check = (previous, expected) => {
  const env = {...process.env};
  if (previous === null) delete env.VERCEL_GIT_PREVIOUS_SHA;
  else env.VERCEL_GIT_PREVIOUS_SHA = previous;
  const result = spawnSync(bash, ['scripts/vercel-should-build.sh'], {cwd:scratch, env, encoding:'utf8'});
  assert.equal(result.status, expected, result.stdout + result.stderr);
};
try {
  git('init');
  await fs.mkdir(path.join(scratch,'scripts'));
  await fs.mkdir(path.join(scratch,'src'));
  await fs.copyFile(path.join(root,'scripts/vercel-should-build.sh'), path.join(scratch,'scripts/vercel-should-build.sh'));
  await fs.writeFile(path.join(scratch,'src/data.js'),'initial');
  const deployed = commit();
  await fs.writeFile(path.join(scratch,'src/data.js'),'new roster');
  commit();
  await fs.writeFile(path.join(scratch,'src/metaData.js'),'statistics');
  const batch = commit();
  check(deployed,1); // The roster change is behind a later statistics commit.
  await fs.writeFile(path.join(scratch,'src/metaData.js'),'new statistics');
  commit();
  check(batch,0); // Only statistics changed since the successful deployment.
  await fs.writeFile(path.join(scratch,'src/tournamentMeta.compact.json'),'new tournament data');
  commit();
  check(batch,0); // Tournament data is refreshed by the running app.
  check(null,1);
  check('0000000000000000000000000000000000000000',1);
  await fs.appendFile(path.join(scratch,'scripts/vercel-should-build.sh'),'\n# changed gate\n');
  commit();
  check(batch,1);
} finally {
  assert.ok(scratch.startsWith(path.resolve(root,'../..') + path.sep));
  await fs.rm(scratch,{recursive:true,force:true});
}
console.log('Vercel build gate regression passed: batched app changes build, stats-only changes skip, missing base builds, gate changes build.');
