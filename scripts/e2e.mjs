import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const browsers=fileURLToPath(new URL('../node_modules/.cache/ms-playwright',import.meta.url));
const cli=fileURLToPath(new URL('../node_modules/@playwright/test/cli.js',import.meta.url));
const r=spawnSync(process.execPath,[cli,...(process.argv[2]==='install'?['install','chromium','firefox']:['test',...process.argv.slice(2)])],{stdio:'inherit',env:{...process.env,PLAYWRIGHT_BROWSERS_PATH:browsers}});
process.exit(r.status??1);
