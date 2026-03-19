const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT_DIR = __dirname; // Serve from root to access both /shared and /apps

// MIME types
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // Handle CORS for Google Sheets requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Remove query params
  let urlPath = req.url.split('?')[0];

  // Route handling
  let filePath;

  if (urlPath === '/') {
    // Root → dispatch/index.html
    filePath = '/apps/dispatch/index.html';
  } else {
    filePath = urlPath;
  }

  // Build full path
  let fullPath = path.join(ROOT_DIR, filePath);

  // Security: prevent directory traversal
  if (!fullPath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Access denied');
    return;
  }

  // Get file extension
  const ext = path.extname(fullPath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  // Try to read the file
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // If not found and no extension, try with .html
        if (!ext) {
          const htmlPath = fullPath + '.html';
          fs.readFile(htmlPath, (err2, data2) => {
            if (err2) {
              console.error(`❌ 404: ${fullPath}`);
              res.writeHead(404, { 'Content-Type': 'text/plain' });
              res.end('404 Not Found: ' + filePath);
            } else {
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(data2);
            }
          });
          return;
        }

        console.error(`❌ 404: ${fullPath}`);
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found: ' + filePath);
        return;
      }

      console.error(`❌ Error reading file: ${fullPath}`, err.message);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error');
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, 'localhost', () => {
  console.log(`\n🚀 Servidor Dispatch running on http://localhost:${PORT}\n`);
  console.log(`📂 Serving files from: ${ROOT_DIR}\n`);
  console.log('Press Ctrl+C to stop the server\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Puerto ${PORT} está en uso. Elige otro puerto.`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});
