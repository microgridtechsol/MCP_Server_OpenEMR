import RedisSessionStore from './stores/RedisSessionStore.js';
import MemorySessionStore from './stores/MemorySessionStore.js';

/**
 * Session Store Factory
 * Creates the appropriate session store based on configuration
 * Supports: Redis, Memory, and SQL (coming soon)
 */
class SessionStoreFactory {
  static create(type = null) {
    const storeType = type || process.env.SESSION_STORE || 'memory';
    
    console.log(`🏪 Initializing ${storeType.toUpperCase()} session store...`);

    switch (storeType.toLowerCase()) {
      case 'redis':
        return new RedisSessionStore({
          host: process.env.REDIS_HOST,
          port: process.env.REDIS_PORT,
          password: process.env.REDIS_PASSWORD,
          db: process.env.REDIS_DB,
          ttl: parseInt(process.env.SESSION_TTL || '3600', 10)
        });

      case 'memory':
      default:
        return new MemorySessionStore({
          ttl: parseInt(process.env.SESSION_TTL || '3600000', 10), // milliseconds for memory
          cleanupInterval: 5 * 60 * 1000 // 5 minutes
        });
    }
  }
}

/**
 * SessionStore Wrapper
 * Provides backward compatibility and additional utility methods
 */
class SessionStore {
  constructor(store) {
    this.store = store;
  }

  // Core methods (delegated to store)
  async set(sessionId, sessionData) {
    return await this.store.set(sessionId, sessionData);
  }

  async get(sessionId) {
    return await this.store.get(sessionId);
  }

  async delete(sessionId) {
    return await this.store.delete(sessionId);
  }

  async has(sessionId) {
    return await this.store.has(sessionId);
  }

  async size() {
    return await this.store.size();
  }

  async clear() {
    return await this.store.clear();
  }

  async getAuthenticatedSessions() {
    return await this.store.getAuthenticatedSessions();
  }

  async cleanupExpired() {
    return await this.store.cleanupExpired();
  }

  async close() {
    return await this.store.close();
  }

  // Utility methods with backward compatibility
  async findSessionByState(state) {
    return await this.store.findByOAuthState(state);
  }

  async getAllSessions() {
    const sessions = [];
    const authenticated = await this.getAuthenticatedSessions();
    
    for (const session of authenticated) {
      sessions.push({
        sessionId: session.sessionId,
        authenticated: !!session.accessToken,
        createdAt: session.createdAt,
        lastAccessed: session.lastAccessed,
        clientId: session.tokenInfo?.clientId || 'unknown',
        scopesCount: session.tokenInfo?.scopes?.length || 0,
        expiresAt: session.expiresAt
      });
    }
    
    return sessions;
  }

  async getSummary() {
    const total = await this.size();
    const authenticatedSessions = await this.getAuthenticatedSessions();
    const authenticated = authenticatedSessions.length;

    return {
      total,
      authenticated,
      anonymous: total - authenticated,
      storeType: this.getStoreType()
    };
  }

  getStoreType() {
    if (this.store instanceof RedisSessionStore) {
      return 'redis';
    } else if (this.store instanceof MemorySessionStore) {
      return 'memory';
    }
    return 'unknown';
  }

  // Backward compatibility methods
  values() {
    // For memory store compatibility
    if (this.store.values) {
      return this.store.values();
    }
    return [];
  }

  entries() {
    // For memory store compatibility
    if (this.store.entries) {
      return this.store.entries();
    }
    return [];
  }

  closeAllSSEConnections() {
    // SSE connections should be stored separately if needed
    console.warn('SSE connection management not implemented in new store');
  }
}

// Create singleton instance
const storeBackend = SessionStoreFactory.create();
export const sessionStore = new SessionStore(storeBackend);

// Export factory for testing or manual store creation
export { SessionStoreFactory };