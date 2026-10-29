#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createClient, exportProfile, makeFiles, makeZip } from './docs/core.mjs';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log('Usage: node --use-env-proxy cli.mjs <Must username or profile URL> [--out exports] [--no-seasons]\n       node cli.mjs --from-backup path/to/backup.json [--out exports]');
  process.exit(args.includes('--help') ? 0 : 1);
}
let username, input, output = 'exports', includeSeasons = true;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') { if (!args[i + 1]) throw new Error('--out needs a path'); output = args[++i]; }
  else if (args[i] === '--from-backup') { if (!args[i + 1]) throw new Error('--from-backup needs a path'); input = args[++i]; }
  else if (args[i] === '--no-seasons') includeSeasons = false;
  else if (args[i].startsWith('--') || username) throw new Error(`Unknown argument: ${args[i]}`);
  else username = args[i];
}
if (!username && !input) throw new Error('A username or --from-backup is required');
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
try {
  const request = createClient({ signal: controller.signal, onRetry: ({ error }) => console.error(`Retrying: ${error}`) });
  const backup = input ? JSON.parse(await readFile(input, 'utf8')) : await exportProfile(username, { request, includeSeasons, onProgress: ({ phase, done, total }) => console.error(`${phase}: ${done}/${total}`) });
  const { files, counts } = makeFiles(backup);
  const root = resolve(output);
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(root, name);
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, content);
  }
  await writeFile(resolve(root, 'must-rescue.zip'), makeZip(files));
  console.log(JSON.stringify({ output: root, counts, warnings: backup.warnings }, null, 2));
  if (backup.warnings?.some(warning => warning.startsWith('INCOMPLETE') || warning.startsWith('SEASONS_UNAVAILABLE'))) process.exitCode = 2;
} catch (error) {
  console.error(error.name === 'AbortError' ? 'Cancelled.' : `Export failed: ${error.message}. Must may be unavailable; no credentials are required.`);
  process.exitCode = 1;
}
