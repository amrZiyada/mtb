import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version = pkg.version;
writeFileSync(resolve(root, 'VERSION'), `${version}\n`);
writeFileSync(resolve(root, 'web/lib/version.ts'), `export const APP_VERSION = '${version}'\n`);
console.log(`Synchronized application version ${version}`);
