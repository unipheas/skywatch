import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/@busy-app/cli/dist/index.js', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../src/appmeta/manifest.json', import.meta.url)));
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root, stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, [cli, 'build', '--emit', 'dir']);
// Standard ustar keeps macOS AppleDouble and extended-attribute headers out of
// installable packages. Compilation and the app layout come from the official CLI.
run('tar', ['--format=ustar', ...(process.platform === 'darwin' ? ['--no-xattrs', '--no-acls', '--no-fflags'] : []),
  '-czf', `dist/${manifest.id}.tgz`, '-C', 'dist', manifest.id]);
console.log(`Packaged dist/${manifest.id}.tgz`);
