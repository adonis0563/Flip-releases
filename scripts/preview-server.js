/**
 * Flip Local Preview Server
 * - Port 3000: Public Download Portal (site/) -> maps to flip.app / download.flip.app
 * - Port 3001: Dedicated Admin Console (admin/) -> maps to admin.flip.app
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const SITE_ROOT = path.resolve(__dirname, '../site');
const ADMIN_ROOT = path.resolve(__dirname, '../admin');

const PUBLIC_PORT = process.env.PORT || 3000;
const ADMIN_PORT = process.env.ADMIN_PORT || 3001;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};

function createStaticServer(rootDir, serverLabel) {
  return http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url);
    let pathname = decodeURIComponent(parsedUrl.pathname);

    if (pathname === '/' || pathname === '') {
      pathname = '/index.html';
    }

    const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(rootDir, safePath);

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`404 Not Found on ${serverLabel}`);
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const range = req.headers.range;

      if (range && ext === '.mp4') {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
        const chunksize = (end - start) + 1;
        const fileStream = fs.createReadStream(filePath, { start, end });

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stats.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*'
        });
        fileStream.pipe(res);
        return;
      }

      res.writeHead(200, {
        'Content-Length': stats.size,
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      });

      fs.createReadStream(filePath).pipe(res);
    });
  });
}

// 1. Public Portal Server
const publicServer = createStaticServer(SITE_ROOT, 'Public Portal');
publicServer.listen(PUBLIC_PORT, '127.0.0.1', () => {
  console.log(`[PUBLIC PORTAL] Running at http://localhost:${PUBLIC_PORT}/ (maps to flip.app)`);
});

// 2. Admin Subdomain Server
const adminServer = createStaticServer(ADMIN_ROOT, 'Admin Subdomain');
adminServer.listen(ADMIN_PORT, '127.0.0.1', () => {
  console.log(`[ADMIN SUBDOMAIN] Running at http://localhost:${ADMIN_PORT}/ (maps to admin.flip.app)`);
  console.log('====================================================');
});
