import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { oauthService } from '../auth/oauth.service.js';
import { authenticateRequest, validateSessionId } from '../auth/auth.middleware.js';
import { sessionStore } from '../core/sessionStore.js';
import { internalSessionManager } from '../core/internalSessionManager.js';
import { OPENEMR_CONFIG, ALL_SCOPES } from '../config/openemr.js';
import { generateCodeChallenge, generateCodeVerifier } from '../utils/pkce.js';

const router = Router();

// OAuth endpoints
router.get('/authorize', async (req, res) => {
  try {
    const result = await oauthService.initiateOAuthFlow();
    res.json(result);
  } catch (error) {
    console.error('❌ Authorization error:', error);
    res.status(500).json({
      error: 'Failed to initiate authorization',
      message: error.message
    });
  }
});

router.get('/auth', async (req, res) => {
  try {
    const result = await oauthService.initiateOAuthFlow();
    res.json(result);
  } catch (error) {
    console.error('❌ Authorization error:', error);
    res.status(500).json({
      error: 'Failed to initiate authorization',
      message: error.message
    });
  }
});

// Direct auth redirect (creates session on the fly)
router.get('/direct', async (req, res) => {
  try {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = uuidv4();
    const sessionId = uuidv4();

    await sessionStore.set(sessionId, {
      sessionId,
      codeVerifier,
      state,
      createdAt: Date.now(),
      step: 'authorization_started'
    });

    const authUrl = `${OPENEMR_CONFIG.AUTH_URL}?` +
      `response_type=code&` +
      `client_id=${OPENEMR_CONFIG.CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(OPENEMR_CONFIG.REDIRECT_URI)}&` +
      `scope=${ALL_SCOPES}&` +
      `state=${state}&` +
      `code_challenge=${codeChallenge}&` +
      `code_challenge_method=S256`;

    console.log(`🔐 Direct auth for session: ${sessionId}`);
    
    res.redirect(authUrl);
  } catch (error) {
    console.error('❌ Direct auth error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Callback endpoint (GET)
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    console.log(`🔄 Callback received:`);
    console.log(`   Code: ${code ? code.substring(0, 20) + '...' : 'MISSING'}`);
    console.log(`   State: ${state || 'MISSING'}`);

    if (!code || !state) {
      return res.status(400).json({
        error: 'Missing code or state',
      });
    }

    // Find session by state
    console.log(`🔍 Looking for session with state: ${state}`);
    const session = await sessionStore.findSessionByState(state);
    
    if (!session) {
      console.error(`❌ Session not found for state: ${state}`);
      
      // Debug: list all available sessions
      const allSessions = await sessionStore.getAuthenticatedSessions();
      console.error(`📊 Available sessions (${allSessions.length} total):`);
      allSessions.forEach(s => {
        console.error(`   - ID: ${s.sessionId}, State: ${s.state}, Step: ${s.step}`);
      });
      
      return res.status(400).json({ 
        error: 'Invalid state',
        debug: `State "${state}" not found in session store. Check server logs.`
      });
    }

    console.log(`✅ Session found: ${session.sessionId}`);
    console.log(`   Stored state: ${session.state}`);
    console.log(`   Code verifier: ${session.codeVerifier.substring(0, 10)}...`);
    
    const tokens = await oauthService.getAccessToken(code, session.codeVerifier);

    console.log(`📊 Token acquisition complete:`, {
      hasAccessToken: !!tokens.accessToken,
      hasRefreshToken: !!tokens.refreshToken,
      refreshTokenLength: tokens.refreshToken ? tokens.refreshToken.length : 0,
      refreshTokenPreview: tokens.refreshToken ? `${tokens.refreshToken.substring(0, 20)}...` : 'None',
      tokenType: tokens.tokenType,
      expiresIn: tokens.expiresAt ? Math.floor((tokens.expiresAt - Date.now()) / 1000) : 0
    });

    // Save tokens to session
    session.accessToken = tokens.accessToken;
    session.refreshToken = tokens.refreshToken;
    session.expiresAt = tokens.expiresAt;
    session.scope = tokens.scope;
    session.tokenInfo = tokens.tokenInfo;
    session.tokenType = tokens.tokenType;
    session.step = 'authenticated';

    await sessionStore.set(session.sessionId, session);

    // Set as active session for internal session manager
    await internalSessionManager.setActiveSession(session.sessionId);

    console.log(`✅ Session updated and authenticated: ${session.sessionId}`);
    console.log(`✅ Set as active internal session`);

    // Return HTML page with instructions
    res.send(`
      <html>
      <head>
        <title>OpenEMR MCP Authentication Successful</title>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; margin: 40px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; }
          .container { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); max-width: 900px; margin: 0 auto; }
          .success { color: #28a745; font-size: 28px; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; }
          .session-box { background: linear-gradient(135deg, #e7f3ff 0%, #d4edff 100%); padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 5px solid #007bff; }
          .session-id { background: #fff; padding: 12px 20px; border-radius: 6px; font-family: 'Courier New', monospace; font-size: 14px; word-break: break-all; border: 2px dashed #007bff; margin: 10px 0; display: flex; align-items: center; justify-content: space-between; }
          .copy-btn { background: #007bff; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 12px; }
          .copy-btn:hover { background: #0056b3; }
          .code { background: #1e1e1e; color: #d4d4d4; padding: 15px; border-radius: 8px; font-family: 'Courier New', monospace; font-size: 13px; overflow-x: auto; margin: 10px 0; }
          .code .key { color: #9cdcfe; }
          .code .string { color: #ce9178; }
          .code .number { color: #b5cea8; }
          .instructions { margin-top: 30px; }
          .endpoint { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 15px 0; border: 1px solid #dee2e6; }
          h2 { color: #333; border-bottom: 3px solid #007bff; padding-bottom: 10px; margin-top: 30px; }
          h3 { color: #007bff; margin-top: 0; }
          .warn-box { background: #fff3cd; padding: 20px; border-radius: 8px; border-left: 5px solid #ffc107; margin: 20px 0; }
          .warn-box h3 { color: #856404; }
          .info-box { background: #d1ecf1; padding: 20px; border-radius: 8px; border-left: 5px solid #17a2b8; margin: 20px 0; }
          .info-box h3 { color: #0c5460; }
          a { color: #007bff; text-decoration: none; }
          a:hover { text-decoration: underline; }
          .highlight { background: #ffc107; padding: 2px 8px; border-radius: 4px; font-weight: bold; }
          ul { line-height: 1.8; }
          .tab-container { display: flex; gap: 10px; margin-bottom: 15px; }
          .tab { padding: 10px 20px; background: #e9ecef; border-radius: 6px 6px 0 0; cursor: pointer; border: 1px solid #dee2e6; border-bottom: none; }
          .tab.active { background: #007bff; color: white; }
        </style>
        <script>
          function copyToClipboard(text, btn) {
            navigator.clipboard.writeText(text).then(() => {
              const originalText = btn.innerText;
              btn.innerText = 'Copied!';
              btn.style.background = '#28a745';
              setTimeout(() => {
                btn.innerText = originalText;
                btn.style.background = '#007bff';
              }, 2000);
            });
          }
        </script>
      </head>
      <body>
        <div class="container">
          <h1 class="success">✅ Authentication Successful!</h1>
          
          <div class="session-box">
            <h3 style="margin-top: 0; color: #004085;">🔑 Your Session ID (SAVE THIS!)</h3>
            <div class="session-id">
              <span id="sessionId">${session.sessionId}</span>
              <button class="copy-btn" onclick="copyToClipboard('${session.sessionId}', this)">📋 Copy</button>
            </div>
            <p style="margin: 0; color: #004085; font-size: 14px;">
              <strong>Token Expires:</strong> ${new Date(session.expiresAt).toLocaleString()} | 
              <strong>Scopes:</strong> ${session.tokenInfo?.scopes?.length || 0}
            </p>
          </div>
          
          <div class="warn-box">
            <h3>⚠️ All Routes Require Session ID</h3>
            <p>Every API and MCP request <strong>MUST</strong> include your session ID. No public access allowed.</p>
            <p><strong>Provide session ID via:</strong></p>
            <ul>
              <li><code>?sessionId=${session.sessionId}</code> (query parameter)</li>
              <li><code>X-Session-Id: ${session.sessionId}</code> (HTTP header)</li>
              <li><code>{"sessionId": "${session.sessionId}"}</code> (request body)</li>
            </ul>
          </div>
          
          <div class="instructions">
            <h2>🚀 MCP Protocol Usage (JSON-RPC 2.0)</h2>
            
            <div class="endpoint">
              <h3>📋 Test Authentication</h3>
              <div class="code">GET /auth/test?sessionId=${session.sessionId}</div>
              <p><a href="/auth/test?sessionId=${session.sessionId}" target="_blank">→ Click to test authentication</a></p>
            </div>
            
            <div class="endpoint">
              <h3>📊 Get Session Status</h3>
              <div class="code">GET /auth/session/${session.sessionId}</div>
              <p><a href="/auth/session/${session.sessionId}" target="_blank">→ View session details</a></p>
            </div>
            
            <div class="endpoint">
              <h3>🛠️ List Available MCP Tools</h3>
              <p><strong>Endpoint:</strong> <span class="highlight">POST /mcp?sessionId=${session.sessionId}</span></p>
              <div class="code"><pre>{
  <span class="key">"jsonrpc"</span>: <span class="string">"2.0"</span>,
  <span class="key">"method"</span>: <span class="string">"tools/list"</span>,
  <span class="key">"params"</span>: {},
  <span class="key">"id"</span>: <span class="number">1</span>
}</pre></div>
            </div>
            
            <div class="endpoint">
              <h3>🏥 Call Tool: List Patients</h3>
              <p><strong>Endpoint:</strong> <span class="highlight">POST /mcp?sessionId=${session.sessionId}</span></p>
              <div class="code"><pre>{
  <span class="key">"jsonrpc"</span>: <span class="string">"2.0"</span>,
  <span class="key">"method"</span>: <span class="string">"tools/call"</span>,
  <span class="key">"params"</span>: {
    <span class="key">"name"</span>: <span class="string">"list_patients"</span>,
    <span class="key">"arguments"</span>: {
      <span class="key">"limit"</span>: <span class="number">10</span>
    }
  },
  <span class="key">"id"</span>: <span class="number">1</span>
}</pre></div>
            </div>
            
            <div class="endpoint">
              <h3>👤 Call Tool: Get Patient Details</h3>
              <p><strong>Endpoint:</strong> <span class="highlight">POST /mcp?sessionId=${session.sessionId}</span></p>
              <div class="code"><pre>{
  <span class="key">"jsonrpc"</span>: <span class="string">"2.0"</span>,
  <span class="key">"method"</span>: <span class="string">"tools/call"</span>,
  <span class="key">"params"</span>: {
    <span class="key">"name"</span>: <span class="string">"get_patient"</span>,
    <span class="key">"arguments"</span>: {
      <span class="key">"patient_id"</span>: <span class="string">"PATIENT_UUID"</span>
    }
  },
  <span class="key">"id"</span>: <span class="number">1</span>
}</pre></div>
            </div>

            <div class="endpoint">
              <h3>💉 Available MCP Tools</h3>
              <ul>
                <li><strong>list_patients</strong> - List patients with filtering (limit, offset, search)</li>
                <li><strong>get_patient</strong> - Get specific patient details by patient_id</li>
                <li><strong>search_patients</strong> - Advanced patient search</li>
                <li><strong>create_patient</strong> - Create a new patient record</li>
                <li><strong>update_patient</strong> - Update existing patient</li>
                <li><strong>list_encounters</strong> - List patient encounters</li>
                <li><strong>list_appointments</strong> - List appointments with filters</li>
                <li><strong>list_observations</strong> - List observations/vitals</li>
                <li><strong>list_medications</strong> - List medications</li>
              </ul>
            </div>
            
            <h2>📡 Direct API Endpoints</h2>
            
            <div class="endpoint">
              <h3>🔍 List Patients (Direct API)</h3>
              <div class="code">GET /api/patients?sessionId=${session.sessionId}&limit=10</div>
              <p><a href="/api/patients?sessionId=${session.sessionId}&limit=10" target="_blank">→ Try it</a></p>
            </div>
            
            <div class="endpoint">
              <h3>🔧 cURL Examples</h3>
              <div class="code"><pre># List MCP tools
curl -X POST "http://localhost:${process.env.PORT || 8082}/mcp?sessionId=${session.sessionId}" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}'

# List patients via MCP
curl -X POST "http://localhost:${process.env.PORT || 8082}/mcp?sessionId=${session.sessionId}" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_patients","arguments":{"limit":10}},"id":1}'

# List patients via Direct API
curl "http://localhost:${process.env.PORT || 8082}/api/patients?sessionId=${session.sessionId}&limit=10"

# Using X-Session-Id header instead
curl -X POST "http://localhost:${process.env.PORT || 8082}/mcp" \\
  -H "Content-Type: application/json" \\
  -H "X-Session-Id: ${session.sessionId}" \\
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}'</pre></div>
            </div>
            
            <h2>🔌 Streamable HTTP (for Langflow/MCP Clients)</h2>
            
            <div class="endpoint">
              <h3>Streamable HTTP Endpoint (Recommended)</h3>
              <div class="code">POST /mcp?sessionId=${session.sessionId}</div>
              <p>Single endpoint for all MCP communication — initialize, tools/list, tools/call, and SSE streaming.</p>
              <p>In <strong>Langflow</strong>, set transport to <strong>Streamable HTTP</strong> and use this URL:</p>
              <div class="code">http://localhost:8082/mcp?sessionId=${session.sessionId}</div>
            </div>
          </div>
          
          <div class="info-box">
            <h3>🔒 Session Information</h3>
            <ul>
              <li><strong>✅ Safe to close this window</strong> - Your session persists on the server</li>
              <li><strong>Session stored in Redis</strong> - Survives server restarts</li>
              <li><strong>Session duration:</strong> 24 hours (extends on activity)</li>
              <li><strong>Token expires in:</strong> ${Math.floor((session.expiresAt - Date.now()) / 1000 / 60)} minutes (auto-refreshes)</li>
              <li><strong>No cookies required</strong> - Server-side session management</li>
            </ul>
          </div>
          
          <div class="warn-box">
            <h3>📝 Important Reminders</h3>
            <ul>
              <li><strong>Session ID Required:</strong> Include in ALL requests (no public access)</li>
              <li>All MCP requests must use <strong>JSON-RPC 2.0</strong> format</li>
              <li>Use <code>?sessionId=</code>, <code>X-Session-Id</code> header, or body <code>sessionId</code></li>
              <li>Direct API: <code>/api/patients?sessionId=${session.sessionId}</code></li>
              <li>MCP endpoint: <code>/mcp?sessionId=${session.sessionId}</code></li>
            </ul>
          </div>
        </div>
      </body>
      </html>
    `);

  } catch (err) {
    console.error('❌ Callback error:', err.message);
    res.status(500).send(`
      <html>
      <head>
        <title>Authentication Failed</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
          .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 600px; margin: 0 auto; }
          .error { color: #dc3545; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1 class="error">❌ Authentication Failed</h1>
          <p><strong>Error:</strong> ${err.message}</p>
          <p>Please check server logs for details and try again.</p>
          <p><a href="/oauth/direct">→ Try authenticating again</a></p>
        </div>
      </body>
      </html>
    `);
  }
});

// Callback endpoint (POST)
router.post('/callback', async (req, res) => {
  try {
    const { sessionId, code, state } = req.body;

    if (!sessionId || !code || !state) {
      return res.status(400).json({
        error: 'Missing required parameters',
        required: ['sessionId', 'code', 'state']
      });
    }

    const result = await oauthService.exchangeCodeForToken(code, state, sessionId);

    res.json({
      success: true,
      ...result,
      mcp_endpoints: {
        test: `/auth/test?sessionId=${result.sessionId}`,
        session: `/auth/session/${result.sessionId}`,
        mcp: `/mcp?sessionId=${result.sessionId}`
      }
    });

  } catch (err) {
    console.error('❌ Callback error:', err);
    res.status(500).json({ 
      error: 'Authentication failed',
      message: err.message 
    });
  }
});

// Token verification
router.post('/verify', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ 
        error: 'Token is required' 
      });
    }

    const validation = await oauthService.validateToken(token);
    
    res.json({
      success: validation.valid,
      verified: validation.valid,
      ...validation
    });
  } catch (error) {
    console.error('❌ Token verification error:', error.message);
    res.status(400).json({
      success: false,
      verified: false,
      error: error.message
    });
  }
});

// Token refresh
router.post('/refresh', authenticateRequest, async (req, res) => {
  try {
    const { refreshToken, force } = req.body;
    const session = req.session;

    if (!refreshToken && !session.refreshToken) {
      return res.status(400).json({
        error: 'Refresh token is required',
        note: 'Automatic refresh happens when token expires within 5 minutes on any authenticated request'
      });
    }

    // Check if manual refresh is needed
    const timeUntilExpiry = session.expiresAt - Date.now();
    const minutesRemaining = Math.floor(timeUntilExpiry / 60000);
    
    if (!force && timeUntilExpiry > 300000) {
      return res.json({
        success: true,
        refreshed: false,
        message: 'Token still valid, no refresh needed',
        expiresIn: Math.floor(timeUntilExpiry / 1000),
        minutesRemaining,
        autoRefreshInfo: {
          enabled: true,
          threshold: '5 minutes before expiry',
          willAutoRefreshAt: new Date(session.expiresAt - 300000).toISOString(),
          note: 'Token will be automatically refreshed on next request before expiry'
        }
      });
    }

    const tokenToRefresh = refreshToken || session.refreshToken;
    console.log(`🔄 Manual token refresh requested for session: ${session.sessionId}`);
    const result = await oauthService.refreshAccessToken(tokenToRefresh);

    // Update session if this was a session refresh
    if (!refreshToken && session.sessionId) {
      session.accessToken = result.accessToken;
      session.refreshToken = result.refreshToken;
      session.expiresAt = result.expiresAt;
      session.tokenInfo = result.tokenInfo;
      session.lastRefreshed = Date.now();
      await sessionStore.set(session.sessionId, session);
    }

    const newExpiryTime = Math.floor((result.expiresAt - Date.now()) / 60000);
    console.log(`✅ Manual token refresh successful. New token expires in: ${newExpiryTime} minutes`);

    res.json({
      success: true,
      refreshed: true,
      ...result,
      sessionUpdated: !refreshToken && !!session.sessionId,
      expiresInMinutes: newExpiryTime,
      autoRefreshInfo: {
        enabled: true,
        threshold: '5 minutes before expiry',
        willAutoRefreshAt: new Date(result.expiresAt - 300000).toISOString()
      }
    });
  } catch (error) {
    console.error('❌ Token refresh error:', error.message);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Auth test endpoints
router.get('/test', authenticateRequest, (req, res) => {
  const session = req.session;
  
  res.json({
    success: true,
    message: "Authentication successful! ✅",
    session: {
      id: session.sessionId,
      clientId: session.tokenInfo?.clientId,
      scopes: session.tokenInfo?.scopes?.length || 0,
      scopesList: session.tokenInfo?.scopes?.slice(0, 10) || [],
      expiresAt: session.expiresAt ? new Date(session.expiresAt).toISOString() : null,
      expiresIn: session.expiresAt ? Math.floor((session.expiresAt - Date.now()) / 1000) : null,
      isBearerToken: session.isBearerToken || false
    },
    mcp_usage: {
      endpoint: `/mcp?sessionId=${session.sessionId}`,
      format: "JSON-RPC 2.0",
      example_list_tools: {
        jsonrpc: "2.0",
        method: "tools/list",
        params: {},
        id: 1
      },
      example_call_tool: {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "list_patients",
          arguments: { limit: 10 }
        },
        id: 1
      }
    }
  });
});

router.get('/status', authenticateRequest, (req, res) => {
  const session = req.session;
  
  res.json({
    authenticated: true,
    tokenVerified: !!session.tokenInfo,
    clientId: session.tokenInfo?.clientId || 'unknown',
    scopes: session.tokenInfo?.scopes || [],
    expiresIn: session.expiresAt ? Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)) : null,
    expiresAt: session.expiresAt ? new Date(session.expiresAt).toISOString() : null,
    isBearerToken: session.isBearerToken || false,
    sessionId: session.isBearerToken ? 'bearer-token' : session.sessionId
  });
});

// Session management

// Get internal session status
router.get('/session', async (req, res) => {
  try {
    const status = await internalSessionManager.getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get session status',
      message: error.message
    });
  }
});

router.get('/session/:sessionId', validateSessionId, async (req, res) => {
  const { sessionId } = req.params;
  const session = await sessionStore.get(sessionId);
  
  res.json({
    sessionId,
    exists: true,
    authenticated: !!session.accessToken,
    hasAccessToken: !!session.accessToken,
    hasRefreshToken: !!session.refreshToken,
    accessTokenPreview: session.accessToken ? `${session.accessToken.substring(0, 50)}...` : null,
    refreshTokenPreview: session.refreshToken ? `${session.refreshToken.substring(0, 20)}...` : null,
    expiresAt: session.expiresAt ? new Date(session.expiresAt).toISOString() : null,
    expiresIn: session.expiresAt ? Math.floor((session.expiresAt - Date.now()) / 1000) : null,
    clientId: session.tokenInfo?.clientId,
    scopes: session.tokenInfo?.scopes,
    scopesCount: session.tokenInfo?.scopes?.length || 0,
    step: session.step,
    createdAt: new Date(session.createdAt).toISOString(),
    lastAccessed: new Date(session.lastAccessed).toISOString(),
    mcp_ready: !!session.accessToken
  });
});

router.post('/logout', authenticateRequest, async (req, res) => {
  try {
    const sessionId = req.session.sessionId;
    const result = await oauthService.logoutSession(sessionId);
    
    res.json(result);
  } catch (error) {
    console.error('❌ Logout error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/logout/:sessionId', validateSessionId, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await oauthService.logoutSession(sessionId);
    
    res.json(result);
  } catch (error) {
    console.error('❌ Logout error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get OAuth configuration
router.get('/config', (req, res) => {
  const config = oauthService.getOAuthConfig();
  res.json(config);
});

// List all sessions (admin)
router.get('/sessions', (req, res) => {
  const sessions = sessionStore.getAllSessions();
  const summary = sessionStore.getSummary();
  
  res.json({
    summary,
    sessions,
    count: sessions.length
  });
});

export default router;