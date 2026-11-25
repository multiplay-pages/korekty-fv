import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createLocalServer } from '../server.mjs';

test('serwer jest ograniczony do aplikacji, loopback, GET/HEAD i bez cache/cookies',async()=>{
  const server=createLocalServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address(),url=`http://127.0.0.1:${address.port}`;
  try {
    assert.equal(address.address,'127.0.0.1');
    const page=await fetch(url);
    assert.equal(page.status,200);
    assert.match(await page.text(),/lang="pl"/);
    assert.equal(page.headers.get('cache-control'),'no-store');
    assert.equal(page.headers.get('set-cookie'),null);
    assert.match(page.headers.get('content-security-policy'),/connect-src 'none'/);
    for(const path of ['/styles.css','/app.mjs','/src/basket.mjs','/src/calculator.mjs','/src/examples.mjs','/src/summary.mjs','/src/invoice-plan.mjs','/src/daily-proration.mjs','/src/billing-policy.mjs','/favicon.svg'])assert.equal((await fetch(url+path)).status,200,path);
    for(const path of ['/docs/notion-tests-snapshot.json','/package.json','/tests/fixtures/reference.json','/node_modules/@playwright/test/package.json','/.git/config'])assert.equal((await fetch(url+path)).status,404,path);
    assert.equal((await fetch(url,{method:'POST',body:'no data'})).status,405);
    const head=await fetch(url,{method:'HEAD'});
    assert.equal(head.status,200);assert.equal(await head.text(),'');
    const badHost=await new Promise((resolve,reject)=>{const req=http.get(url,{headers:{Host:'example.test'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});
    assert.equal(badHost,403);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
