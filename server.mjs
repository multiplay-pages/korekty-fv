import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const routes=new Map([
  ['/',['index.html','text/html; charset=utf-8']],['/index.html',['index.html','text/html; charset=utf-8']],
  ['/styles.css',['styles.css','text/css; charset=utf-8']],['/app.mjs',['app.mjs','text/javascript; charset=utf-8']],
  ...['calculator','basket','summary','examples','invoice-plan','daily-proration'].map(name=>[`/src/${name}.mjs`,[`src/${name}.mjs`,'text/javascript; charset=utf-8']]),
  ['/favicon.svg',['favicon.svg','image/svg+xml']],
]);
export function createLocalServer() {
  const server=createServer(async(req,res)=>{
    const port=server.address()?.port;
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    const host=req.headers.host;
    if(host!==`127.0.0.1:${port}`&&host!==`localhost:${port}`) {res.writeHead(403);res.end('Tylko lokalny adres.');return;}
    if(!['GET','HEAD'].includes(req.method)) {res.setHeader('Allow','GET, HEAD');res.writeHead(405);res.end();return;}
    let path;
    try{path=new URL(req.url,'http://127.0.0.1').pathname;}catch{res.writeHead(400);res.end();return;}
    const route=routes.get(path);
    if(!route) {res.writeHead(404);res.end('Nie znaleziono.');return;}
    try {
      const content=await readFile(new URL(route[0],import.meta.url));
      res.setHeader('Content-Type',route[1]);
      res.writeHead(200);res.end(req.method==='HEAD'?undefined:content);
    } catch {res.writeHead(500);res.end('Nie można odczytać lokalnego pliku aplikacji.');}
  });
  return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const server=createLocalServer();
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'Port 4173 jest zajęty. Zamknij poprzednie uruchomienie lub sprawdź działającą aplikację.':error.message);process.exitCode=1;});
  server.listen(4173,'127.0.0.1',()=>console.log('Multiplay BOK — lokalny prototyp: http://127.0.0.1:4173 (Ctrl+C kończy pracę).'));
}
