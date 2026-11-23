import { spawnSync } from 'node:child_process';
const files=['src/calculator.mjs','src/basket.mjs','src/summary.mjs','src/examples.mjs','src/invoice-plan.mjs','src/daily-proration.mjs','app.mjs','server.mjs','demo.mjs','tests/calculator.test.mjs','tests/basket.test.mjs','tests/invoice-plan.test.mjs','tests/daily-proration.test.mjs','tests/server.test.mjs','playwright.config.mjs','tests/e2e/calculator.spec.mjs','tests/e2e/error-focus.spec.mjs','tests/e2e/user-facing.spec.mjs','scripts/e2e.mjs'];
for(const file of files) {const r=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);}
console.log(`Składnia: ${files.length} plików OK.`);
