import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createLocalServer } from '../server.mjs';

const browsers = fileURLToPath(new URL('../node_modules/.cache/ms-playwright', import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
const args = process.argv.slice(2);
const install = args[0] === 'install';
const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers };
const server = !install && !env.BOK_E2E_URL ? createLocalServer() : null;

try {
  if (server) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    env.BOK_E2E_URL = `http://127.0.0.1:${server.address().port}`;
    console.log(`Lokalne E2E: ${env.BOK_E2E_URL}`);
  }
  const child = spawn(process.execPath, [cli, ...(install ? ['install', 'chromium', 'firefox'] : ['test', ...args])], {
    stdio: 'inherit', env,
  });
  const [status] = await once(child, 'close');
  process.exitCode = status ?? 1;
} finally {
  server?.closeAllConnections();
  server?.close();
}
