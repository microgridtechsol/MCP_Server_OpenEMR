import { Router } from 'express';
import { sessionStore } from '../core/sessionStore.js';
import { OPENEMR_CONFIG } from '../config/openemr.js';

const router = Router();

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "OpenEMR MCP Server",
    version: "1.0.0",
    uptime: process.uptime()
  });
});

// Server status
router.get('/status', async (req, res) => {
  const activeSessions = await sessionStore.size();
  const authenticatedSessions = (await sessionStore.getAuthenticatedSessions()).length;
  
  res.json({
    server: "OpenEMR MCP Server",
    status: "running",
    port: process.env.PORT || 8082,
    node_version: process.version,
    environment: process.env.NODE_ENV || 'development',
    openemr_config: {
      base_url: OPENEMR_CONFIG.BASE_URL,
      api_prefix: OPENEMR_CONFIG.API_PREFIX,
      client_id: OPENEMR_CONFIG.CLIENT_ID.substring(0, 10) + '...'
    },
    sessions: await sessionStore.getSummary(),
    timestamp: new Date().toISOString()
  });
});

// Server info
router.get('/info', (req, res) => {
  res.json({
    name: "openemr-mcp-server",
    version: "1.0.0",
    description: "MCP Server for OpenEMR with OAuth2 and FHIR API support",
    endpoints: {
      health: "/health",
      status: "/status",
      auth: {
        authorize: "/oauth/authorize",
        callback: "/oauth/callback",
        verify: "/oauth/verify",
        test: "/auth/test"
      },
      mcp: {
        sse: "/mcp (GET)",
        jsonrpc: "/mcp (POST)",
        tools: "Use JSON-RPC 2.0 with /mcp endpoint"
      },
      session: "/auth/session/:id",
      sessions: "/auth/sessions"
    },
    mcp_protocol: {
      version: "2024-11-05",
      transport: "SSE + JSON-RPC 2.0",
      capabilities: ["tools", "resources"]
    },
    authentication: {
      methods: ["OAuth2 PKCE", "Bearer Token"],
      scopes: "Comprehensive OpenEMR scopes",
      pkce: "Required"
    }
  });
});

// Session endpoints
router.get('/sessions', async (req, res) => {
  const sessions = await sessionStore.getAllSessions();
  
  res.json({
    sessions: sessions,
    count: sessions.length,
    summary: await sessionStore.getSummary()
  });
});

// Configuration
router.get('/config', (req, res) => {
  // Return sanitized config (without secrets)
  res.json({
    openemr: {
      base_url: OPENEMR_CONFIG.BASE_URL,
      api_prefix: OPENEMR_CONFIG.API_PREFIX,
      auth_url: OPENEMR_CONFIG.AUTH_URL,
      token_url: OPENEMR_CONFIG.TOKEN_URL,
      jwks_url: OPENEMR_CONFIG.JWKS_URL,
      client_id: OPENEMR_CONFIG.CLIENT_ID.substring(0, 10) + '...',
      redirect_uri: OPENEMR_CONFIG.REDIRECT_URI
    },
    server: {
      port: process.env.PORT || 8082,
      node_env: process.env.NODE_ENV || 'development',
      session_timeout: "24 hours"
    },
    mcp: {
      protocol_version: "2024-11-05",
      endpoint: "/mcp",
      sse_supported: true
    }
  });
});

// Root endpoint
router.get('/', (req, res) => {
  res.json({
    message: "OpenEMR MCP Server",
    description: "Model Context Protocol server for OpenEMR with OAuth2 authentication",
    documentation: {
      authentication: "Start with GET /oauth/authorize",
      mcp: "Use POST /mcp for JSON-RPC 2.0 or GET /mcp for SSE",
      health: "GET /health for server status"
    },
    quick_start: [
      "1. GET /oauth/authorize to start OAuth flow",
      "2. Open the authUrl in browser and authorize",
      "3. Use the returned sessionId with MCP endpoints",
      "4. POST /mcp?sessionId=... with JSON-RPC 2.0 requests"
    ],
    examples: {
      list_tools: '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}',
      list_patients: '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_patients","arguments":{"limit":10}},"id":1}'
    }
  });
});

export default router;