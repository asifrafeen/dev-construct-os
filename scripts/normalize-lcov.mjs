// Rewrites coverage/lcov.info so every `SF:` path is repo-relative with forward slashes.
// The SonarQube scan runs on Linux in the pipeline; a report generated on Windows
// (`SF:src\lib\utils.ts`) or with absolute paths would match no file there.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const file = path.resolve('coverage/lcov.info');
const root = process.cwd();

const normalized = readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .map((line) => {
    if (!line.startsWith('SF:')) return line;
    const source = line.slice(3);
    const relative = path.isAbsolute(source) ? path.relative(root, source) : source;
    return `SF:${relative.split(path.sep).join('/').replaceAll('\\', '/')}`;
  })
  .join('\n');

writeFileSync(file, normalized);
console.log(`normalized ${file}`);
