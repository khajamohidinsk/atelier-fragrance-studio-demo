import { readFile } from 'node:fs/promises';

const files = ['app.js', 'src/domain/calculations.mjs', 'src/domain/store.mjs', 'src/domain/persistence.mjs', 'src/domain/backup.mjs', 'src/domain/comparison.mjs', 'src/domain/summaries.mjs', 'src/ui/companion.mjs', ...['tests/calculations.test.mjs', 'tests/store.test.mjs', 'tests/backup.test.mjs', 'tests/persistence.test.mjs', 'tests/comparison.test.mjs']];
for (const file of files) {
  const source = await readFile(file, 'utf8');
  new Function(source.replace(/^import .*$/gm, '').replace(/^export /gm, ''));
}
console.log(`lint: parsed ${files.length} JavaScript modules`);
