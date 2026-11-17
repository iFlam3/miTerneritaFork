// Servidor estatico minimo para Railway: sirve el build de Angular como SPA.
// Sin dependencias. Las rutas que no son archivo devuelven index.html.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/miternerita-front/browser/', import.meta.url));
const port = Number(process.env.PORT) || 4200;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
};

// Angular nombra los bundles con hash (main-ABCD1234.js): se pueden cachear para siempre.
const hashed = /-[A-Z0-9]{8}\.(js|css)$/;

const fileAt = (p) => {
  try {
    return statSync(p).isFile() ? p : null;
  } catch {
    return null;
  }
};

createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  // normalize + comprobar prefijo: impide salir de la carpeta con ../
  const target = normalize(join(root, pathname));
  let file = target.startsWith(root) ? fileAt(target) : null;

  if (!file) {
    // Ruta de la app (/home/event/1) o navegacion del navegador: index.html.
    // Un archivo con extension que no existe es 404 de verdad.
    const isRoute = !extname(pathname) || (req.headers.accept ?? '').includes('text/html');
    if (!isRoute) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    file = join(root, 'index.html');
  }

  const ext = extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': types[ext] ?? 'application/octet-stream',
    'Cache-Control':
      ext === '.html'
        ? 'no-cache'
        : hashed.test(file)
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}).listen(port, '0.0.0.0', () => console.log(`serve: ${root} en el puerto ${port}`));
