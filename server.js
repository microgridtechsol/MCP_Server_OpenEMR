import { app } from './src/app.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

const logFilePath = path.resolve(process.cwd(), 'mcp.log');
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

function writeLog(level, args) {
  const timestamp = new Date().toISOString();
  const message = args
    .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
    .join(' ');
  logStream.write(`[${timestamp}] ${level.toUpperCase()} ${message}\n`);
}

console.log = (...args) => {
  writeLog('log', args);
  originalConsole.log(...args);
};

console.info = (...args) => {
  writeLog('info', args);
  originalConsole.info(...args);
};

console.warn = (...args) => {
  writeLog('warn', args);
  originalConsole.warn(...args);
};

console.error = (...args) => {
  writeLog('error', args);
  originalConsole.error(...args);
};

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

const PORT = process.env.PORT || 8082;
const HOST = process.env.HOST || '127.0.0.1';

// Start server
const server = app.listen(PORT, HOST, () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const publicUrl = process.env.PUBLIC_URL || `http://${HOST}:${PORT}`;
  
  console.log("\n🚀 OpenEMR MCP Server Started");
  console.log(`📍 Internal: http://${HOST}:${PORT}`);
  
  if (isProduction && process.env.PUBLIC_URL) {
    console.log(`🌐 Public URL: ${publicUrl}`);
    console.log(`🏥 Health: ${publicUrl}/health`);
    console.log(`🔐 Auth: ${publicUrl}/oauth/authorize`);
    console.log(`🔧 MCP Endpoint: ${publicUrl}/mcp`);
  } else {
    console.log(`🏥 Health: http://${HOST}:${PORT}/health`);
    console.log(`🔐 Auth: http://${HOST}:${PORT}/oauth/authorize`);
    console.log(`🔧 MCP Endpoint: http://${HOST}:${PORT}/mcp`);
  }
  
  console.log(`⚙️  Mode: ${isProduction ? 'Production' : 'Development'}`);
  console.log(`🔒 Proxy Trust: Enabled (for nginx)`);
  console.log("\n⏳ Ready for connections...\n");
});

// Graceful shutdown
function shutdown() {
  console.log("\n🛑 Shutting down...");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export { server };