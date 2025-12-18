#!/usr/bin/env node

/**
 * Mock Export API Server for Profiling
 *
 * Provides a minimal HTTP server that responds to Export API endpoints
 * with successful responses, avoiding 404 errors during profiling.
 *
 * Usage:
 *   node scripts/mock-export-api.js
 *
 * Endpoints:
 *   POST /exports - Start export (returns 201 with exportId)
 *   GET /exports/:exportId - Get export status (returns 200 with READY status)
 *
 * This server is automatically started by clinic-profile.sh
 */

const http = require('http');

const PORT = process.env.MOCK_API_PORT || 8080;

// Mock responses
const createExportResponse = (exportId) => ({
  exportId,
  status: 'PROCESSING',
  createdAt: new Date().toISOString(),
});

const getExportStatusResponse = (exportId) => ({
  exportId,
  status: 'READY',
  files: [
    {
      fileName: 'export.json',
      url: 'https://httpbin.org/delay/1',
      size: 1024,
    },
  ],
  completedAt: new Date().toISOString(),
});

// Request handler
const server = http.createServer((req, res) => {
  const { method, url } = req;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle OPTIONS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // POST /exports - Start export
  if (method === 'POST' && url === '/exports') {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const exportId = data.exportId || `export-${Date.now()}`;

        const response = createExportResponse(exportId);

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));

        console.log(`✓ POST /exports - Created export: ${exportId}`);
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });

    return;
  }

  // GET /exports/:exportId - Get export status
  if (method === 'GET' && url.startsWith('/exports/')) {
    const exportId = url.split('/')[2];

    const response = getExportStatusResponse(exportId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));

    console.log(`✓ GET /exports/${exportId} - Status: READY`);
    return;
  }

  // Health check
  if (method === 'GET' && url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // 404 for unknown routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Start server
server.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║  Mock Export API Server - Profiling Mode              ║`);
  console.log(`╚════════════════════════════════════════════════════════╝`);
  console.log(`\n✓ Server running on http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST   /exports           - Start export`);
  console.log(`  GET    /exports/:id       - Get export status`);
  console.log(`  GET    /health            - Health check`);
  console.log(`\nPress Ctrl+C to stop\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n✓ Mock API server shutting down...');
  server.close(() => {
    console.log('✓ Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n\n✓ Mock API server shutting down...');
  server.close(() => {
    console.log('✓ Server closed');
    process.exit(0);
  });
});
