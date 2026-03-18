import { sessionStore } from './sessionStore.js';
import { oauthService } from '../auth/oauth.service.js';

/**
 * Internal Session Manager
 * Maintains a single active session internally without requiring sessionId in URLs
 * Automatically refreshes tokens when needed
 */
class InternalSessionManager {
  constructor() {
    this.activeSessionId = null;
    this.lastChecked = null;
  }

  /**
   * Get the current active session
   * Returns null if no authenticated session exists
   */
  async getActiveSession() {
    try {
      // If we have an active session ID, try to get it
      if (this.activeSessionId) {
        const session = await sessionStore.get(this.activeSessionId);
        
        if (session && session.accessToken && !session.refreshFailed) {
          // Check token expiry and refresh if needed
          await this.checkAndRefreshToken(session);
          
          // Session accessed - TTL automatically extended by Redis
          console.log(`✅ Using active session: ${this.activeSessionId} (TTL extended)`);
          return session;
      } else if (session && session.refreshFailed) {
          console.log(`🚫 Active session ${this.activeSessionId} has a revoked token — clearing`);
          this.activeSessionId = null;
        } else {
          console.log(`⚠️ Active session ${this.activeSessionId} is invalid or not authenticated`);
          this.activeSessionId = null;
        }
      }

      // Try to find any authenticated session
      const sessions = await sessionStore.getAuthenticatedSessions();
      
      if (sessions.length > 0) {
        // Use the most recently accessed session
        const mostRecent = sessions.reduce((latest, current) => {
          return (current.lastAccessed > latest.lastAccessed) ? current : latest;
        });

        this.activeSessionId = mostRecent.sessionId;
        console.log(`✅ Using existing authenticated session: ${this.activeSessionId}`);
        console.log(`   Session has ${Math.floor((mostRecent.expiresAt - Date.now()) / 60000)} minutes remaining`);
        
        // Check token expiry and refresh if needed
        await this.checkAndRefreshToken(mostRecent);
        return mostRecent;
      }

      console.log(`❌ No authenticated sessions found. Please authenticate at /auth/direct`);
      return null;

    } catch (error) {
      console.error('❌ Error getting active session:', error.message);
      return null;
    }
  }

  /**
   * Check token expiry and refresh if needed
   */
  async checkAndRefreshToken(session) {
    if (!session.expiresAt) {
      return session;
    }

    const now = Date.now();
    const timeUntilExpiry = session.expiresAt - now;
    const minutesRemaining = Math.floor(timeUntilExpiry / 60000);
    const secondsRemaining = Math.floor((timeUntilExpiry % 60000) / 1000);

    // Log if token is expiring soon (within 10 minutes)
    if (timeUntilExpiry <= 600000 && timeUntilExpiry > 0) {
      console.log(`⏰ Token expires in ${minutesRemaining}m ${secondsRemaining}s`);
    }

    // Token expired
    if (timeUntilExpiry <= 0) {
      console.error(`❌ Token expired ${Math.abs(minutesRemaining)} minutes ago`);
      
      if (session.refreshFailed) {
        this.activeSessionId = null;
        throw new Error('Token expired and refresh token was revoked. Please re-authenticate at /oauth/authorize');
      }
      
      if (session.refreshToken) {
        console.log(`🔄 Attempting to refresh expired token...`);
        try {
          await oauthService.verifyAndRefreshSession(session);
          console.log(`✅ Expired token successfully refreshed`);
        } catch (error) {
          console.error(`❌ Failed to refresh expired token: ${error.message}`);
          this.activeSessionId = null;
          throw new Error('Token expired and refresh failed. Please re-authenticate at /oauth/authorize');
        }
      } else {
        this.activeSessionId = null;
        throw new Error('Token expired and no refresh token available. Please re-authenticate at /oauth/authorize');
      }
    }

    return session;
  }

  /**
   * Set the active session (called after OAuth callback)
   */
  async setActiveSession(sessionId) {
    this.activeSessionId = sessionId;
    console.log(`✅ Active session set to: ${sessionId}`);
  }

  /**
   * Clear the active session
   */
  clearActiveSession() {
    const oldSessionId = this.activeSessionId;
    this.activeSessionId = null;
    console.log(`🔄 Active session cleared: ${oldSessionId}`);
  }

  /**
   * Get session status
   */
  async getStatus() {
    const session = await this.getActiveSession();
    
    if (!session) {
      return {
        authenticated: false,
        message: 'No active session. Please authenticate via /oauth/direct'
      };
    }

    const timeUntilExpiry = session.expiresAt - Date.now();
    const minutesRemaining = Math.floor(timeUntilExpiry / 60000);

    return {
      authenticated: true,
      sessionId: session.sessionId,
      expiresIn: Math.floor(timeUntilExpiry / 1000),
      minutesRemaining,
      expiresAt: new Date(session.expiresAt).toISOString(),
      scopes: session.tokenInfo?.scopes?.length || 0,
      clientId: session.tokenInfo?.clientId || 'unknown'
    };
  }
}

// Export singleton instance
export const internalSessionManager = new InternalSessionManager();
