// Explicit, one-shot conversion. This script is never run by plugin startup.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2), write = args.includes('--write');
const backupFlag = args.indexOf('--backup-dir');
const backup = backupFlag >= 0 ? args[backupFlag + 1] : undefined;
const files = args.filter((arg, i) => arg !== '--write' && arg !== '--backup-dir' && (backupFlag < 0 || i !== backupFlag + 1));
if (!files.length || (write && !backup)) throw new Error('Usage: node scripts/convert-thought-paths.mjs [--write --backup-dir DIR] FILE.md ...');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundle = await build({ entryPoints: [path.join(root, 'src/thought-document.ts')], bundle: true, write: false, format: 'esm', platform: 'node' });
const { convertListPathsToArrows, parseLegacyListDocument, parseThoughtDocument } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const planned = [];
for (const file of files) {
  const before = await readFile(file, 'utf8'), old = parseLegacyListDocument(before), after = convertListPathsToArrows(before);
  const next = parseThoughtDocument(after);
  planned.push({ file, before, after });
  console.log(JSON.stringify({ file, changed: before !== after, nodes: next.nodes.length, visits: next.occurrences.length, edgesBefore: old.relations.length, edgesAfter: next.relations.length }));
}
if (write) {
  await mkdir(backup, { recursive: true });
  // Validate all files before any mutation and retain exact originals independently of undo history.
  for (const item of planned) if (await readFile(item.file, 'utf8') !== item.before) throw new Error('File changed during conversion: ' + item.file);
  for (const [index, item] of planned.entries()) {
    if (item.before === item.after) continue;
    await writeFile(path.join(backup, `${index}-${path.basename(item.file)}`), item.before, { flag: 'wx' });
  }
  await writeFile(path.join(backup, 'manifest.json'), JSON.stringify(planned.map((item, index) => ({ file: item.file, backup: `${index}-${path.basename(item.file)}`, changed: item.before !== item.after })), null, 2), { flag: 'wx' });
  for (const item of planned) {
    if (item.before === item.after) continue;
    if (await readFile(item.file, 'utf8') !== item.before) throw new Error('File changed before write: ' + item.file);
    await writeFile(item.file, item.after);
  }
  console.log(JSON.stringify({ converted: planned.filter(item => item.before !== item.after).length, backup }));
}
