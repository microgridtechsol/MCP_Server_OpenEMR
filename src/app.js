import express from 'express';
import cors from 'cors';

// Import routes
import authRoutes from './routes/auth.routes.js';
import statusRoutes from './routes/status.routes.js';
import mcpRoutes from './mcp/mcp.routes.js';
import apiRoutes from './routes/api.routes.js';
import logRoutes from './routes/log.routes.js';


const app = express();

// Trust proxy - CRITICAL for nginx reverse proxy
// This allows Express to trust X-Forwarded-* headers from nginx
app.set('trust proxy', true);

// CORS for MCP routes - allow all origins for MCP endpoints
app.use('/mcp', cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'mcp-session-id', 'Authorization'],
  exposedHeaders: ['mcp-session-id'],
  credentials: false
}));

app.use('/logs', logRoutes);
// Security headers for proxied requests
app.use((req, res, next) => {
  // Set security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Check if request is from localhost/local network
  const isLocalRequest = 
    req.ip === '127.0.0.1' || 
    req.ip === '::1' || 
    req.ip === '::ffff:127.0.0.1' ||
    req.ip?.startsWith('172.168.') || // Your local network
    req.hostname === 'localhost' ||
    !req.get('X-Forwarded-Proto'); // Direct connection (not through proxy)
  
  // Only enforce HTTPS for external production requests
  if (process.env.NODE_ENV === 'production' && 
      !isLocalRequest && 
      req.get('X-Forwarded-Proto') === 'http') {
    return res.status(403).json({ 
      error: 'HTTPS required',
      message: 'This service requires HTTPS in production'
    });
  }
  
  next();
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/', statusRoutes);
app.use('/oauth', authRoutes);
app.use('/auth', authRoutes);
app.use('/mcp', mcpRoutes);
app.use('/api', apiRoutes);  // Direct OpenEMR API endpoints (raw responses)

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

export { app };
