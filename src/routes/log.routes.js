import { Router } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();

// Log file path matches server.js log output
const LOG_FILE = path.resolve(process.cwd(), 'mcp.log');

// GET /logs - show recent logs in browser
router.get('/', (req, res) => {
  fs.readFile(LOG_FILE, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).send('<h2>Error reading log file</h2><pre>' + err.message + '</pre>');
    }
    res.set('Content-Type', 'text/html');
    res.send('<h2>MCP Server Logs</h2><pre>' + data + '</pre>');
  });
});

export default router;
