'use strict';
const express = require('express');
const http    = require('http');
const router  = express.Router();

const SERVICES = [
  { id: 'kolibri',   url: 'http://127.0.0.1:8080', name: 'Kolibri' },
  { id: 'kiwix',     url: 'http://127.0.0.1:8081', name: 'Kiwix' },
];

function checkService(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

// GET /api/services/status
router.get('/status', async (req, res) => {
  const results = await Promise.all(
    SERVICES.map(async (svc) => ({
      id:        svc.id,
      name:      svc.name,
      available: await checkService(svc.url),
    }))
  );
  res.json(results);
});

module.exports = router;