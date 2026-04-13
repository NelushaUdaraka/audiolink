/**
 * AudioLink Update Server
 * Serves the dist/ folder over HTTP so installed apps can auto-update.
 *
 * Usage:
 *   node scripts/serve-updates.mjs          (default port 8766)
 *   node scripts/serve-updates.mjs 9000     (custom port)
 *
 * On each client PC, set the update server URL once:
 *   Edit  ~/.audiolink/settings.json  and add:
 *     "updateServerUrl": "http://<THIS_MACHINE_IP>:<PORT>"
 *
 * To switch to GitHub later: remove updateServerUrl from settings and
 * add a "publish" block with provider "github" to package.json.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '../dist');
const PORT = parseInt(process.argv[2] || '8766', 10);

const MIME = {
  '.exe':  'application/octet-stream',
  '.yml':  'text/yaml',
  '.yaml': 'text/yaml',
  '.json': 'application/json',
  '.blockmap': 'application/octet-stream',
};

if (!fs.existsSync(DIST_DIR)) {
  console.error('✗  dist/ folder not found. Run "npm run make" first.');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const filePath = path.join(DIST_DIR, decodeURIComponent(req.url || '/'));

  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
    });
    fs.createReadStream(filePath).pipe(res);
    console.log(`  → ${req.url}`);
  });
});

server.listen(PORT, () => {
  // Print all non-internal IPv4 addresses for convenience
  const nets = os.networkInterfaces();
  const ips = ['127.0.0.1'];
  for (const list of Object.values(nets)) {
    for (const iface of list || []) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }

  console.log('\n AudioLink Update Server\n');
  console.log(' Serving:', DIST_DIR);
  console.log(' URLs:');
  ips.forEach(ip => console.log(`   http://${ip}:${PORT}`));
  console.log('\n On each client PC, add this to ~/.audiolink/settings.json:');
  const networkIp = ips.find(ip => ip !== '127.0.0.1') || '127.0.0.1';
  console.log(`   "updateServerUrl": "http://${networkIp}:${PORT}"`);
  console.log('\n Ctrl+C to stop.\n');
});
