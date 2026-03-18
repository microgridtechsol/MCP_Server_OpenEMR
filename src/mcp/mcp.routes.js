import { Router } from "express";
import { randomUUID } from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMCPServer } from "./mcp.server.js";
import { internalSessionManager } from "../core/internalSessionManager.js";
import { sessionStore } from "../core/sessionStore.js";
import { oauthService } from "../auth/oauth.service.js";

const router = Router();

// Store active Streamable HTTP sessions (MCP session ID → { server, transport })
const sessions = new Map();

/* ============================
   AUTH MIDDLEWARE
   Validates OpenEMR OAuth session before any MCP request.
   Accepts sessionId via query param, header, or body.
   Auto-refreshes expired tokens when a refresh token is available.
============================ */

async function requireSessionAuth(req, res, next) {
  let sessionId = req.query.sessionId ||
    req.headers["x-session-id"] ||
    req.headers["session-id"] ||
    req.body?.sessionId;

  // Sanitize to UUID format
  if (sessionId) {
    sessionId = sessionId.trim();
    const uuidMatch = sessionId.match(/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    if (uuidMatch) sessionId = uuidMatch[1];
  }

  // Fallback to active internal session
  if (!sessionId) {
    const activeSession = await internalSessionManager.getActiveSession();
    if (activeSession?.sessionId) {
      sessionId = activeSession.sessionId;
    } else {
      return res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Authentication required: Session ID missing" },
        hint: "Provide sessionId or authenticate at /oauth/direct",
        id: req.body?.id || null
      });
    }
  }

  let session = await sessionStore.get(sessionId);
  if (!session) {
    return res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Invalid or expired session ID" },
      hint: "Complete OAuth flow at /oauth/direct first",
      id: req.body?.id || null
    });
  }

  if (!session.accessToken) {
    return res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32002, message: "Session not authenticated" },
      hint: "Session exists but OAuth flow not completed",
      id: req.body?.id || null
    });
  }

  // Auto-refresh expired / expiring tokens
  const TOKEN_REFRESH_THRESHOLD = parseInt(process.env.TOKEN_REFRESH_THRESHOLD || "300000", 10);
  const timeUntilExpiry = session.expiresAt ? session.expiresAt - Date.now() : Infinity;

  if (timeUntilExpiry <= TOKEN_REFRESH_THRESHOLD) {
    if (session.refreshToken) {
      try {
        await oauthService.verifyAndRefreshSession(session);
        session = await sessionStore.get(sessionId);
      } catch (refreshError) {
        return res.status(401).json({
          jsonrpc: "2.0",
          error: { code: -32003, message: "Token expired and refresh failed" },
          hint: refreshError.message,
          id: req.body?.id || null
        });
      }
    } else {
      return res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32004, message: "Token expired - no refresh token available" },
        hint: "Re-authenticate at /oauth/direct",
        id: req.body?.id || null
      });
    }
  }

  // Keep session alive
  session.lastAccessed = Date.now();
  await sessionStore.set(sessionId, session);

  req.authenticatedSession = session;
  req.sessionId = sessionId;
  next();
}

/* ============================
   STREAMABLE HTTP TRANSPORT — MCP 2024-11-05+
   POST /mcp  — handles initialize, tools/call, and all JSON-RPC
   GET  /mcp  — SSE stream for server-initiated messages
   DELETE /mcp — close an MCP session
============================ */

router.post("/", requireSessionAuth, async (req, res) => {
  try {
    // Normalize Langflow's non-standard argument placement
    normalizeJsonRpcToolCallArguments(req.body);

    const mcpSessionId = req.headers["mcp-session-id"];

    // --- Existing session: route to its transport ---
    if (mcpSessionId && sessions.has(mcpSessionId)) {
      const mcpSession = sessions.get(mcpSessionId);
      return await mcpSession.transport.handleRequest(req, res, req.body);
    }

    // --- New session: only allowed on `initialize` ---
    if (isInitializeRequest(req.body)) {
      const server = createMCPServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          // Store once the transport assigns its session ID
          sessions.set(id, { server, transport, authSessionId: req.sessionId });
          console.log(`🔗 MCP session created: ${id}`);
        }
      });

      transport.onclose = () => {
        const id = transport.sessionId;
        if (id) {
          sessions.delete(id);
          console.log(`❌ MCP session closed: ${id}`);
        }
      };

      await server.connect(transport);
      return await transport.handleRequest(req, res, req.body);
    }

    // --- Invalid: stale session or missing initialize ---
    if (mcpSessionId) {
      // Client sent a session ID we don't recognize (e.g., after server restart).
      // Auto-recover: create a fresh session transparently.
      console.log(`⚠️ Stale MCP session ${mcpSessionId} — creating fresh session`);
      const server = createMCPServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { server, transport, authSessionId: req.sessionId });
          console.log(`🔗 MCP session recovered: ${id} (replaced stale ${mcpSessionId})`);
        }
      });
      transport.onclose = () => {
        const id = transport.sessionId;
        if (id) sessions.delete(id);
      };
      await server.connect(transport);
      return await transport.handleRequest(req, res, req.body);
    }

    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32600, message: "Bad Request: Send an initialize request first or include mcp-session-id header." },
      id: req.body?.id || null
    });
  } catch (error) {
    console.error("❌ MCP POST error:", error.message);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: error.message },
        id: req.body?.id || null
      });
    }
  }
});

router.get("/", requireSessionAuth, async (req, res) => {
  const mcpSessionId = req.headers["mcp-session-id"];
  if (!mcpSessionId || !sessions.has(mcpSessionId)) {
    return res.status(400).json({
      error: "Invalid or missing mcp-session-id",
      hint: "POST /mcp with an initialize request first"
    });
  }
  await sessions.get(mcpSessionId).transport.handleRequest(req, res);
});

router.delete("/", requireSessionAuth, async (req, res) => {
  const mcpSessionId = req.headers["mcp-session-id"];
  if (mcpSessionId && sessions.has(mcpSessionId)) {
    const mcpSession = sessions.get(mcpSessionId);
    await mcpSession.transport.close();
    sessions.delete(mcpSessionId);
    res.status(204).end();
  } else {
    res.status(404).json({ error: "MCP session not found" });
  }
});

/* ============================
   UTILITY ENDPOINTS (authenticated)
============================ */

router.get("/status", requireSessionAuth, async (req, res) => {
  const session = req.authenticatedSession;
  res.json({
    mcp_ready: true,
    authenticated: true,
    sessionId: req.sessionId,
    expiresIn: session.expiresAt ? Math.floor((session.expiresAt - Date.now()) / 1000) : null,
    minutesRemaining: session.expiresAt ? Math.floor((session.expiresAt - Date.now()) / 60000) : null,
    sdk: "@modelcontextprotocol/sdk",
    activeSessions: sessions.size,
    endpoints: {
      streamable: "POST /mcp (Streamable HTTP)",
      status: "GET /mcp/status"
    }
  });
});

router.get("/test", requireSessionAuth, (_req, res) => {
  res.json({ success: true, message: "MCP OK - Session authenticated", activeSessions: sessions.size });
});

router.get("/debug/sessions", async (_req, res) => {
  try {
    const sessionCount = await sessionStore.size();
    const authSessions = await sessionStore.getAuthenticatedSessions();
    res.json({
      totalSessions: sessionCount,
      authenticatedSessions: authSessions.length,
      activeMcpSessions: sessions.size,
      sessions: authSessions.map(s => ({
        sessionId: s.sessionId,
        authenticated: !!s.accessToken,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        minutesRemaining: s.expiresAt ? Math.floor((s.expiresAt - Date.now()) / 60000) : null
      }))
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to get session debug info", message: error.message });
  }
});

/* ============================
   HELPERS
============================ */

function isInitializeRequest(body) {
  return body?.method === "initialize" && body?.jsonrpc === "2.0";
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(value) {
  if (isPlainObject(value)) return value;
  if (typeof value !== "string") return {};
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return {};
  try {
    const parsed = JSON.parse(trimmed);
    return isPlainObject(parsed) ? parsed : {};
  } catch { return {}; }
}

/**
 * Langflow (and some other clients) put tool arguments in non-standard
 * locations. This normalizer merges them all into params.arguments so
 * the MCP SDK can find them.
 */
function normalizeJsonRpcToolCallArguments(body) {
  if (!isPlainObject(body) || body.method !== "tools/call") return;
  if (!isPlainObject(body.params)) body.params = {};

  const p = body.params;
  const b = body;

  // Collect args from every known location
  const sources = [
    p.input, p.args, p.kwargs, p.tool_input, p.tool_arguments, p.parameters,
    b.arguments, b.input, b.args, b.kwargs
  ].map(parseJsonObject);

  // Direct param fields (not reserved keys)
  const reserved = new Set(["name", "arguments", "input", "args", "kwargs", "tool_input", "tool_arguments", "parameters", "sessionId"]);
  const directFields = Object.fromEntries(
    Object.entries(isPlainObject(p) ? p : {}).filter(([k]) => !reserved.has(k))
  );

  const explicit = parseJsonObject(p.arguments);

  const merged = Object.assign({}, directFields, ...sources, explicit);
  body.params.arguments = Object.fromEntries(
    Object.entries(merged).filter(([, v]) => v !== undefined)
  );
}

export default router;