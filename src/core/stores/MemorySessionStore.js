import BaseSessionStore from './BaseSessionStore.js';

/**
 * In-memory session storage implementation
 * Fast but not suitable for production with multiple server instances
 * Good for development and testing
 */
class MemorySessionStore extends BaseSessionStore {
  constructor(options = {}) {
    super();
    
    this.sessions = new Map();
    this.options = {
      cleanupInterval: options.cleanupInterval || 5 * 60 * 1000, // 5 minutes
      ttl: null // No expiration, sessions are permanent
    };
    
    // Start periodic cleanup
    this.cleanupTimer = setInterval(
      () => this.cleanupExpired(),
      this.options.cleanupInterval
    );
    
    console.log('💾 Memory session store initialized');
  }

  /**
   * Store a session
   */
  async set(sessionId, sessionData) {
    const data = {
      ...sessionData,
      lastAccessed: Date.now()
      // No expiresAt field, session is permanent
    };
    this.sessions.set(sessionId, data);
    return data;
  }

  /**
   * Retrieve a session
   */
  async get(sessionId) {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return null;
    }

    // Check if expired
    if (session.expiresAt && Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }

    // Update last accessed time and expiration
    session.lastAccessed = Date.now();
    session.expiresAt = Date.now() + this.options.ttl;
    
    return session;
  }

  /**
   * Delete a session
   */
  async delete(sessionId) {
    return this.sessions.delete(sessionId);
  }

  /**
   * Check if session exists
   */
  async has(sessionId) {
    if (!this.sessions.has(sessionId)) {
      return false;
    }

    const session = this.sessions.get(sessionId);
    
    // Check if expired
    if (session.expiresAt && Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return false;
    }

    return true;
  }

  /**
   * Get total number of sessions
   */
  async size() {
    // Clean up expired before counting
    await this.cleanupExpired();
    return this.sessions.size;
  }

  /**
   * Clear all sessions
   */
  async clear() {
    this.sessions.clear();
    console.log('🗑️  Cleared all sessions from memory');
  }

  /**
   * Get all authenticated sessions
   */
  async getAuthenticatedSessions() {
    const authenticated = [];
    const now = Date.now();

    for (const [sessionId, session] of this.sessions.entries()) {
      // Skip expired sessions
      if (session.expiresAt && now > session.expiresAt) {
        continue;
      }

      if (session.accessToken) {
        authenticated.push({
          sessionId,
          ...session
        });
      }
    }

    return authenticated;
  }

  /**
   * Find session by OAuth state
   */
  async findByOAuthState(state) {
    const now = Date.now();

    for (const [sessionId, session] of this.sessions.entries()) {
      // Skip expired sessions
      if (session.expiresAt && now > session.expiresAt) {
        continue;
      }

      if (session.state === state || session.oauthState === state) {
        return {
          sessionId,
          ...session
        };
      }
    }

    return null;
  }

  /**
   * Cleanup expired sessions
   */
  async cleanupExpired() {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt && now > session.expiresAt) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} expired sessions`);
    }

    return cleaned;
  }

  /**
   * Get all session entries (for debugging)
   */
  entries() {
    return this.sessions.entries();
  }

  /**
   * Get all session values (for debugging)
   */
  values() {
    return this.sessions.values();
  }

  /**
   * Close and cleanup
   */
  async close() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sessions.clear();
    console.log('🔌 Memory session store closed');
  }

  /**
   * Get store info
   */
  getStoreInfo() {
    return {
      type: 'memory',
      size: this.sessions.size,
      ttl: this.options.ttl,
      cleanupInterval: this.options.cleanupInterval
    };
  }

  /**
   * Store access token to sessionId mapping
   */
  async setTokenMapping(accessToken, sessionId) {
    this.tokenMappings.set(accessToken, {
      sessionId,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.options.ttl
    });
    console.log(`🔑 Token mapping stored for session: ${sessionId}`);
  }

  /**
   * Get sessionId from access token
   */
  async getSessionIdByToken(accessToken) {
    const mapping = this.tokenMappings.get(accessToken);
    if (!mapping) {
      return null;
    }

    // Check if expired
    if (mapping.expiresAt && Date.now() > mapping.expiresAt) {
      this.tokenMappings.delete(accessToken);
      return null;
    }

    return mapping.sessionId;
  }

  /**
   * Remove token mapping
   */
  async deleteTokenMapping(accessToken) {
    this.tokenMappings.delete(accessToken);
  }

  /**
   * Update token mapping when token is refreshed
   */
  async updateTokenMapping(oldAccessToken, newAccessToken, sessionId) {
    // Remove old token mapping
    if (oldAccessToken) {
      await this.deleteTokenMapping(oldAccessToken);
    }
    // Store new token mapping
    await this.setTokenMapping(newAccessToken, sessionId);
    console.log(`🔄 Token mapping updated for session: ${sessionId}`);
  }
}

export default MemorySessionStore;
