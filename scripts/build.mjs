import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('index.html', 'dist/index.html');
await cp('styles.css', 'dist/styles.css');
await cp('app.js', 'dist/app.js');
await cp('src', 'dist/src', { recursive: true });
console.log('build: created dist/ static application bundle');
