// Winziger Vorschauserver fuer dist/. Nur lokal, kein Deploy-Ersatz.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './util.mjs';

const PORT = Number(process.env.PORT || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    let file = path.join(paths.dist, url);

    // Pfadausbruch verhindern: aufgeloester Pfad muss unter dist/ bleiben.
    if (!path.resolve(file).startsWith(path.resolve(paths.dist))) {
      res.writeHead(403).end('Verboten');
      return;
    }

    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      file = path.join(file, 'index.html');
    }
    if (!fs.existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }).end('<h1>404</h1>');
      return;
    }

    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .on('error', (err) => {
    // Ein belegter Port ist der Normalfall, wenn schon eine Vorschau laeuft.
    // Dafuer braucht es keinen Absturz mit Stapelverfolgung.
    if (err.code === 'EADDRINUSE') {
      process.stdout.write(
        `Port ${PORT} ist belegt. Entweder laeuft die Vorschau schon auf ` +
        `http://localhost:${PORT}, oder starte sie mit einem anderen Port: ` +
        `PORT=4174 npm run serve\n`
      );
      process.exitCode = 0;
      return;
    }
    process.stderr.write(`Vorschau konnte nicht starten: ${err.message}\n`);
    process.exitCode = 1;
  })
  .listen(PORT, () => {
    process.stdout.write(`Vorschau laeuft auf http://localhost:${PORT}\n`);
  });
