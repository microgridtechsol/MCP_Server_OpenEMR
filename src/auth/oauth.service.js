import axios from 'axios';
import qs from 'qs';
import { v4 as uuidv4 } from 'uuid';
import { OPENEMR_CONFIG, ALL_SCOPES } from '../config/openemr.js';
import { generateCodeVerifier, generateCodeChallenge, generatePKCEParameters } from '../utils/pkce.js';
import { tokenVerifier } from './tokenVerifier.js';
import { sessionStore } from '../core/sessionStore.js';

export class OAuthService {
  constructor() {
    this.config = OPENEMR_CONFIG;
  }

  checkOfflineAccessRequested() {
    return ALL_SCOPES.includes('offline_access');
  }

  async initiateOAuthFlow() {
    try {
      const { codeVerifier, codeChallenge, state } = generatePKCEParameters();
      const sessionId = uuidv4();

      const session = {
        sessionId,
        codeVerifier,
        state,
        createdAt: Date.now(),
        step: 'authorization_started',
        requestedOfflineAccess: this.checkOfflineAccessRequested(),
        scopesRequested: ALL_SCOPES.split('%20').length
      };

      await sessionStore.set(sessionId, session);

      const authUrl = `${this.config.AUTH_URL}?` +
        `response_type=code&` +
        `client_id=${this.config.CLIENT_ID}&` +
        `redirect_uri=${encodeURIComponent(this.config.REDIRECT_URI)}&` +
        `scope=${ALL_SCOPES}&` +
        `state=${state}&` +
        `code_challenge=${codeChallenge}&` +
        `code_challenge_method=S256`;

      console.log(`🔐 Starting PKCE OAuth flow for session: ${sessionId}`);
      console.log(`   Code verifier: ${codeVerifier.substring(0, 10)}...`);
      console.log(`   State: ${state}`);
      console.log(`   Requested offline_access: ${this.checkOfflineAccessRequested()}`);
      console.log(`   Scopes requested: ${ALL_SCOPES.split('%20').length} scopes`);

      return {
        sessionId,
        authUrl,
        redirectUri: this.config.REDIRECT_URI,
        state,
        scopesRequested: ALL_SCOPES.split('%20').length,
        offlineAccessRequested: this.checkOfflineAccessRequested(),
        instructions: [
          '1. Open the authUrl in your browser',
          '2. After authorization, copy the authorization code from the browser URL',
          '3. POST the code to /oauth/callback with your sessionId',
          `Or visit: ${authUrl.substring(0, 80)}...`
        ]
      };
    } catch (error) {
      console.error('❌ Error in initiateOAuthFlow:', error);
      throw new Error(`Failed to initiate OAuth flow: ${error.message}`);
    }
  }

  async exchangeCodeForToken(code, state, sessionId) {
    try {
      if (!code || !state) {
        throw new Error('Missing code or state');
      }

      const session = sessionId 
        ? await sessionStore.get(sessionId)
        : await sessionStore.findSessionByState(state);

      if (!session) {
        throw new Error('Invalid session or state');
      }

      if (session.state !== state) {
        throw new Error('State mismatch');
      }

      console.log(`🔄 Exchanging code for token...`);
      console.log(`   Code: ${code.substring(0, 20)}...`);
      console.log(`   State: ${state}`);
      console.log(`   Session ID: ${session.sessionId}`);
      console.log(`   Code verifier: ${session.codeVerifier.substring(0, 10)}...`);

      const tokens = await this.getAccessToken(code, session.codeVerifier);

      // Update session with tokens
      session.accessToken = tokens.accessToken;
      session.refreshToken = tokens.refreshToken;
      session.expiresAt = tokens.expiresAt;
      session.scope = tokens.scope;
      session.tokenInfo = tokens.tokenInfo;
      session.tokenType = tokens.tokenType;
      session.idToken = tokens.idToken;
      session.step = 'authenticated';
      session.authenticatedAt = Date.now();

      await sessionStore.set(session.sessionId, session);

      console.log(`✅ Authentication successful for session: ${session.sessionId}`);
      console.log(`   Client ID: ${tokens.tokenInfo?.clientId || 'unknown'}`);
      console.log(`   Scopes granted: ${tokens.tokenInfo?.scopes?.length || 0}`);
      console.log(`   Token expires: ${new Date(tokens.expiresAt).toLocaleString()}`);

      return {
        success: true,
        sessionId: session.sessionId,
        tokenInfo: tokens.tokenInfo,
        expiresAt: tokens.expiresAt,
        expiresIn: Math.floor((tokens.expiresAt - Date.now()) / 1000),
        scopes: tokens.tokenInfo?.scopes || [],
        clientId: tokens.tokenInfo?.clientId || 'unknown'
      };
    } catch (error) {
      console.error('❌ Error exchanging code for token:', error.message);
      throw error;
    }
  }

  async getAccessToken(code = null, codeVerifier = null, refreshToken = null) {
    try {
      const tokenUrl = this.config.TOKEN_URL;

      let data = {
        client_id: this.config.CLIENT_ID,
        client_secret: this.config.CLIENT_SECRET,
      };

      if (code) {
        data.grant_type = 'authorization_code';
        data.code = code;
        data.redirect_uri = this.config.REDIRECT_URI;
        if (codeVerifier) {
          data.code_verifier = codeVerifier;
        }
      } else if (refreshToken) {
        data.grant_type = 'refresh_token';
        data.refresh_token = refreshToken;
      } else {
        data.grant_type = 'client_credentials';
      }

      console.log('📤 Token request:', { 
        grant_type: data.grant_type,
        client_id: data.client_id.substring(0, 10) + '...',
        has_code: !!code,
        has_refresh_token: !!refreshToken,
        has_code_verifier: !!codeVerifier
      });

      const response = await axios.post(tokenUrl, qs.stringify(data), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      });

      console.log('📥 Token response received, status:', response.status);

      const { 
        access_token, 
        refresh_token, 
        expires_in, 
        scope, 
        id_token,
        token_type 
      } = response.data;
      
      const expiresAt = Date.now() + (expires_in * 1000);

      // Extract refresh token from various possible field names
      let refreshTokenValue = refresh_token;
      if (!refreshTokenValue) {
        const altNames = ['refreshToken', 'refresh_token', 'refresh-token', 'refresh'];
        for (const name of altNames) {
          if (response.data[name]) {
            refreshTokenValue = response.data[name];
            console.log(`🔄 Found refresh token in field: ${name}`);
            break;
          }
        }
      }

      let tokenInfo = null;
      let scopesFromResponse = scope ? scope.split(' ') : [];
      
      // Verify the token if it's a JWT
      if (access_token && access_token.includes('.')) {
        try {
          tokenInfo = await tokenVerifier.verifyToken(access_token);
          console.log('✅ Token verified successfully');
        } catch (verifyError) {
          console.warn('⚠️ Token verification failed:', verifyError.message);
          
          // Try to decode for debugging
          try {
            const decoded = await tokenVerifier.decodeToken(access_token);
            
            // Create token info from decoded data
            tokenInfo = {
              clientId: decoded.clientId,
              scopes: decoded.scopes.length > 0 ? decoded.scopes : scopesFromResponse,
              expiresAt: decoded.expiresAt || expiresAt,
              issuedAt: decoded.issuedAt || Date.now(),
              subject: decoded.subject,
              resource: this.config.CLIENT_ID,
              rawPayload: decoded.payload
            };
            console.log(`ℹ️ TokenInfo created from decode with ${tokenInfo.scopes.length} scopes`);
          } catch (decodeError) {
            console.warn('⚠️ Could not decode token:', decodeError.message);
          }
        }
      }
      
      // Fallback if no tokenInfo
      if (!tokenInfo) {
        console.log('⚠️ Creating tokenInfo from OAuth response');
        tokenInfo = {
          clientId: this.config.CLIENT_ID,
          scopes: scopesFromResponse,
          expiresAt: expiresAt,
          issuedAt: Date.now(),
          subject: 'unknown',
          resource: this.config.CLIENT_ID,
          rawPayload: { scope: scope }
        };
      }

      return {
        accessToken: access_token,
        refreshToken: refreshTokenValue,
        expiresAt,
        scope,
        idToken: id_token,
        tokenType: token_type,
        tokenInfo
      };
    } catch (error) {
      console.error('❌ OAuth Token Error:', error.message);
      if (error.response) {
        console.error('❌ Response status:', error.response.status);
        console.error('❌ Response data:', error.response.data);
        console.error('❌ Response headers:', error.response.headers);
      }
      throw new Error(`OAuth token request failed: ${error.message}`);
    }
  }

  async refreshAccessToken(refreshToken) {
    try {
      if (!refreshToken) {
        throw new Error('Refresh token is required');
      }

      console.log('🔄 Refreshing access token...');
      const tokens = await this.getAccessToken(null, null, refreshToken);
      
      return {
        success: true,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || refreshToken,
        expiresAt: tokens.expiresAt,
        tokenInfo: tokens.tokenInfo
      };
    } catch (error) {
      console.error('❌ Refresh token error:', error.message);
      
      // Detect permanently invalid refresh tokens (revoked, expired, etc.)
      const isRevoked = error.message && (
        error.message.includes('401') ||
        error.message.includes('revoked') ||
        error.message.includes('invalid')
      );
      
      if (isRevoked) {
        const err = new Error(`Failed to refresh token: ${error.message}`);
        err.tokenRevoked = true;
        throw err;
      }
      
      throw new Error(`Failed to refresh token: ${error.message}`);
    }
  }

  async verifyAndRefreshSession(session) {
    if (!session || !session.accessToken) {
      throw new Error('No access token available');
    }

    // Check if token is expired or expiring soon
    // Use configurable threshold (default: 5 minutes)
    const refreshThreshold = this.config.TOKEN_REFRESH_THRESHOLD || 300000;
    const timeUntilExpiry = session.expiresAt - Date.now();
    const isExpiredOrExpiring = session.expiresAt && (timeUntilExpiry <= refreshThreshold);

    // Skip refresh if we already know it failed (prevents retry spam)
    if (session.refreshFailed) {
      console.log(`🚫 Session ${session.sessionId} has a failed refresh — re-authentication required`);
      throw new Error('Session requires re-authentication. Refresh token was revoked. Please re-authenticate at /oauth/authorize');
    }

    if (isExpiredOrExpiring && session.refreshToken) {
      const minutesRemaining = Math.floor(timeUntilExpiry / 60000);
      const secondsRemaining = Math.floor((timeUntilExpiry % 60000) / 1000);
      
      console.log(`🔄 Token expiring in ${minutesRemaining}m ${secondsRemaining}s (threshold: ${Math.floor(refreshThreshold/60000)}m)`);
      console.log(`   Session: ${session.sessionId}`);
      console.log(`   Auto-refreshing token...`);
      
      try {
        const newTokens = await this.refreshAccessToken(session.refreshToken);
        
        // Update session with new tokens
        session.accessToken = newTokens.accessToken;
        session.refreshToken = newTokens.refreshToken || session.refreshToken;
        session.expiresAt = newTokens.expiresAt;
        session.tokenInfo = newTokens.tokenInfo;
        session.lastRefreshed = Date.now();
        session.refreshFailed = false;
        
        await sessionStore.set(session.sessionId, session);
        
        const newExpiryTime = Math.floor((newTokens.expiresAt - Date.now()) / 60000);
        console.log(`✅ Token auto-refreshed successfully for session ${session.sessionId}`);
        console.log(`   New token expires in: ${newExpiryTime} minutes`);
      } catch (refreshError) {
        console.error('❌ Automatic token refresh failed:', refreshError.message);
        
        // Mark session so we don't keep retrying with a revoked/invalid token
        session.refreshFailed = true;
        session.refreshFailedAt = Date.now();
        session.refreshToken = null;
        session.step = 'refresh_failed';
        await sessionStore.set(session.sessionId, session);
        
        console.log(`🚫 Session ${session.sessionId} marked as refresh_failed — re-authentication required`);
        throw new Error('Token refresh failed. Refresh token is invalid or revoked. Please re-authenticate at /oauth/authorize');
      }
    } else if (isExpiredOrExpiring && !session.refreshToken) {
      console.log(`⚠️ Token expiring soon but no refresh token available for session ${session.sessionId}`);
      throw new Error('Token expired. Please re-authenticate (no refresh token available).');
    } else if (session.expiresAt) {
      // Token is still valid, log remaining time
      const minutesRemaining = Math.floor((session.expiresAt - Date.now()) / 60000);
      if (minutesRemaining <= 10) {
        console.log(`ℹ️ Token valid for ${minutesRemaining} more minutes (session: ${session.sessionId})`);
      }
    }

    // Verify token if not already verified
    if (!session.tokenInfo && session.accessToken && session.accessToken.includes('.')) {
      try {
        session.tokenInfo = await tokenVerifier.verifyToken(session.accessToken);
        await sessionStore.set(session.sessionId, session);
        console.log(`✅ Token verified for session ${session.sessionId}`);
      } catch (verifyError) {
        console.warn(`⚠️ Token verification failed for session ${session.sessionId}:`, verifyError.message);
        
        // Try to decode anyway
        try {
          const decoded = await tokenVerifier.decodeToken(session.accessToken);
          session.tokenInfo = {
            clientId: decoded.clientId,
            scopes: decoded.scopes.length > 0 ? decoded.scopes : (session.scope ? session.scope.split(' ') : []),
            expiresAt: decoded.expiresAt || session.expiresAt,
            issuedAt: decoded.issuedAt || Date.now(),
            subject: decoded.subject,
            resource: this.config.CLIENT_ID,
            rawPayload: decoded.payload
          };
          await sessionStore.set(session.sessionId, session);
          console.log(`✅ TokenInfo created from decode for session ${session.sessionId}`);
        } catch (decodeError) {
          console.warn(`⚠️ Could not decode token for session ${session.sessionId}:`, decodeError.message);
          throw new Error('Token verification failed');
        }
      }
    }

    return session;
  }

  async validateToken(token) {
    try {
      const validation = await tokenVerifier.validateToken(token);
      return validation;
    } catch (error) {
      console.error('❌ Token validation error:', error.message);
      throw error;
    }
  }

  async revokeToken(token, tokenTypeHint = 'access_token') {
    try {
      // Note: OpenEMR may or may not support token revocation
      // This is a placeholder for future implementation
      console.log(`🗑️ Revoking ${tokenTypeHint} token...`);
      
      // Check if OpenEMR has a revocation endpoint
      const revocationUrl = `${this.config.BASE_URL}/oauth2/revoke`;
      
      try {
        const response = await axios.post(revocationUrl, qs.stringify({
          token,
          token_type_hint: tokenTypeHint,
          client_id: this.config.CLIENT_ID,
          client_secret: this.config.CLIENT_SECRET
        }), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });
        
        console.log(`✅ Token revoked: ${response.status}`);
        return { success: true, message: 'Token revoked successfully' };
      } catch (error) {
        console.warn('⚠️ Token revocation not supported or failed:', error.message);
        return { 
          success: false, 
          message: 'Token revocation not supported by server',
          error: error.message 
        };
      }
    } catch (error) {
      console.error('❌ Token revocation error:', error.message);
      throw error;
    }
  }

  async logoutSession(sessionId) {
    try {
      const session = await sessionStore.get(sessionId);
      if (!session) {
        return { success: false, message: 'Session not found' };
      }

      // Try to revoke tokens if available
      if (session.accessToken) {
        await this.revokeToken(session.accessToken, 'access_token');
      }
      
      if (session.refreshToken) {
        await this.revokeToken(session.refreshToken, 'refresh_token');
      }

      // Close SSE connection if exists
      if (session.res && typeof session.res.end === 'function') {
        try {
          session.res.end();
        } catch (err) {
          console.error(`Error closing SSE connection: ${err.message}`);
        }
      }

      // Remove session
      await sessionStore.delete(sessionId);
      
      console.log(`👋 Session ${sessionId} logged out`);
      return { success: true, message: 'Logged out successfully' };
    } catch (error) {
      console.error('❌ Logout error:', error.message);
      throw error;
    }
  }

  getOAuthConfig() {
    return {
      authorizationEndpoint: this.config.AUTH_URL,
      tokenEndpoint: this.config.TOKEN_URL,
      clientId: this.config.CLIENT_ID,
      redirectUri: this.config.REDIRECT_URI,
      scopes: ALL_SCOPES.split('%20'),
      responseType: 'code',
      codeChallengeMethod: 'S256'
    };
  }
}

// Singleton instance
export const oauthService = new OAuthService();