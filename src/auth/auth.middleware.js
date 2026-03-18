import { oauthService } from './oauth.service.js';
import { tokenVerifier } from './tokenVerifier.js';
import { sessionStore } from '../core/sessionStore.js';

export async function authenticateRequest(req, res, next) {
  try {
    // Check for Bearer token first (standard API auth)
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      try {
        const tokenInfo = await tokenVerifier.verifyToken(token);
        
        req.session = {
          accessToken: token,
          tokenInfo,
          isBearerToken: true,
          sessionId: `bearer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        };
        
        return next();
      } catch (error) {
        console.error('❌ Bearer token verification failed:', error.message);
        return res.status(401).json({ 
          error: 'Invalid bearer token',
          message: error.message 
        });
      }
    }

    // Check for session ID (for OAuth flow)
    const sessionId = req.query.sessionId || 
                     req.headers['x-session-id'] || 
                     req.headers['session-id'] ||
                     req.body?.sessionId;

    if (!sessionId) {
      return res.status(401).json({ 
        error: 'Authentication required',
        instructions: [
          'Option 1: Use Authorization: Bearer <token> header',
          'Option 2: Complete OAuth flow:',
          '  a) GET /oauth/authorize',
          '  b) Open authUrl in browser',
          '  c) GET /oauth/callback?code=...&state=...',
          '  d) Use returned sessionId in X-Session-Id header or query param'
        ],
        endpoints: {
          authorize: '/oauth/authorize',
          callback: '/oauth/callback',
          verify: '/oauth/verify'
        }
      });
    }

    const session = await sessionStore.get(sessionId);
    if (!session) {
      return res.status(401).json({ 
        error: 'Invalid or expired session',
        hint: 'Complete OAuth flow first at /oauth/authorize',
        availableSessions: await sessionStore.size(),
        sessionEndpoint: '/sessions'
      });
    }

    if (!session.accessToken) {
      return res.status(401).json({ 
        error: 'Session not authenticated',
        next_step: 'GET /oauth/callback?code=<code>&state=<state>',
        sessionState: session.step || 'unknown'
      });
    }

    try {
      // Verify and refresh token if needed
      const updatedSession = await oauthService.verifyAndRefreshSession(session);
      
      req.session = {
        ...updatedSession,
        sessionId: sessionId,
        isBearerToken: false
      };
      
      next();
    } catch (error) {
      console.error(`❌ Session verification failed for ${sessionId}:`, error.message);
      
      return res.status(401).json({ 
        error: 'Token verification failed',
        message: error.message,
        requiresReauthentication: true,
        reauthEndpoint: '/oauth/authorize'
      });
    }
  } catch (error) {
    console.error('❌ Authentication middleware error:', error);
    return res.status(500).json({ 
      error: 'Authentication system error',
      message: error.message 
    });
  }
}

export function requireScopes(requiredScopes, requireAll = false) {
  return (req, res, next) => {
    if (!req.session || !req.session.tokenInfo) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'No valid session or token info'
      });
    }

    const tokenInfo = req.session.tokenInfo;
    const hasRequiredScopes = requireAll
      ? tokenVerifier.hasAllScopes(tokenInfo, requiredScopes)
      : tokenVerifier.hasAnyScope(tokenInfo, requiredScopes);

    if (!hasRequiredScopes) {
      const verb = requireAll ? 'all of' : 'one of';
      const errorMessage = tokenVerifier.getScopeErrorMessage(
        tokenInfo, 
        requiredScopes, 
        requireAll
      );
      
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: errorMessage,
        required: requiredScopes,
        available: tokenInfo.scopes || [],
        requireAll
      });
    }

    next();
  };
}

export function requireClientId(allowedClientIds) {
  return (req, res, next) => {
    if (!req.session || !req.session.tokenInfo) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }

    const clientId = req.session.tokenInfo.clientId;
    if (!allowedClientIds.includes(clientId)) {
      return res.status(403).json({
        error: 'Client not authorized',
        message: `Client ID ${clientId} is not authorized for this operation`,
        authorizedClients: allowedClientIds
      });
    }

    next();
  };
}

export async function validateSessionId(req, res, next) {
  const sessionId = req.params.sessionId || req.query.sessionId;
  
  if (!sessionId) {
    return res.status(400).json({
      error: 'Session ID is required'
    });
  }

  if (!(await sessionStore.has(sessionId))) {
    return res.status(404).json({
      error: 'Session not found',
      sessionId
    });
  }

  next();
}

export function rateLimitMiddleware(requestsPerMinute = 60) {
  const requests = new Map();
  
  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowStart = now - 60000; // 1 minute
    
    // Clean up old entries
    for (const [ip, timestamps] of requests.entries()) {
      const validTimestamps = timestamps.filter(time => time > windowStart);
      if (validTimestamps.length === 0) {
        requests.delete(ip);
      } else {
        requests.set(ip, validTimestamps);
      }
    }
    
    // Check rate limit
    const userRequests = requests.get(key) || [];
    if (userRequests.length >= requestsPerMinute) {
      return res.status(429).json({
        error: 'Too many requests',
        message: `Rate limit exceeded. Please try again in a minute.`,
        limit: requestsPerMinute,
        remaining: 0
      });
    }
    
    // Add current request
    userRequests.push(now);
    requests.set(key, userRequests);
    
    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', requestsPerMinute);
    res.setHeader('X-RateLimit-Remaining', requestsPerMinute - userRequests.length);
    res.setHeader('X-RateLimit-Reset', Math.ceil((now + 60000) / 1000));
    
    next();
  };
}

export function corsMiddleware(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-Session-Id, Authorization, session-id, X-Requested-With");
  
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  
  next();
}

export function requestLogger(req, res, next) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`📄 ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
  });
  
  next();
}