import { defineConfig } from '@playwright/test';
const externalBaseURL=process.env.BOK_E2E_URL;
export default defineConfig({
  testDir:'./tests/e2e',timeout:30000,expect:{timeout:5000},fullyParallel:false,workers:1,
  outputDir:'output/playwright/results',
  reporter:[['list'],['json',{outputFile:'output/playwright/results.json'}]],
  use:{baseURL:externalBaseURL??'http://127.0.0.1:4173',locale:'pl-PL',headless:true,viewport:{width:1440,height:1000},screenshot:'only-on-failure',trace:'retain-on-failure'},
  projects:[
    {name:'chromium-desktop',use:{browserName:'chromium'}},
    {name:'firefox-desktop',use:{browserName:'firefox'}},
    {name:'chromium-mobile',use:{browserName:'chromium',viewport:{width:390,height:844},isMobile:true,hasTouch:true}},
    {name:'firefox-mobile',use:{browserName:'firefox',viewport:{width:390,height:844},hasTouch:true}},
  ],
  webServer:externalBaseURL?undefined:{command:'node server.mjs',url:'http://127.0.0.1:4173',reuseExistingServer:true,timeout:10000},
});
