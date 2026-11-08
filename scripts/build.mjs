import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// macOS tar otherwise includes AppleDouble ._ files, including a second root entry.
const cli = fileURLToPath(new URL('../node_modules/@busy-app/cli/dist/index.js', import.meta.url));
const result = spawnSync(process.execPath, [cli, 'build', ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
