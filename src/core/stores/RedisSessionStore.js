import Redis from 'ioredis';
import BaseSessionStore from './BaseSessionStore.js';

/**
 * Redis-based session storage implementation
 * Fast, scalable, with built-in TTL support
 */
class RedisSessionStore extends BaseSessionStore {
  constructor(options = {}) {
    super();
    
    this.options = {
      host: options.host || process.env.REDIS_HOST || '127.0.0.1',
      port: options.port || process.env.REDIS_PORT || 6379,
      password: options.password || process.env.REDIS_PASSWORD || undefined,
      db: options.db || process.env.REDIS_DB || 0,
      keyPrefix: options.keyPrefix || 'session:',
      ttl: options.ttl || 3600, // 1 hour default
      retryStrategy: options.retryStrategy || ((times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      })
    };

    this.redis = new Redis({
      host: this.options.host,
      port: this.options.port,
      password: this.options.password,
      db: this.options.db,
      keyPrefix: this.options.keyPrefix,
      retryStrategy: this.options.retryStrategy,
      lazyConnect: false,
      maxRetriesPerRequest: 3
    });

    this.redis.on('connect', () => {
      console.log('✅ Redis connected successfully');
    });

    this.redis.on('error', (err) => {
      console.error('❌ Redis connection error:', err.message);
    });

    this.redis.on('ready', () => {
      console.log('🚀 Redis ready for operations');
    });

    this.redis.on('close', () => {
      console.log('🔌 Redis connection closed');
    });
  }

  stripKeyPrefix(key) {
    if (!key) {
      return key;
    }

    const prefix = this.options.keyPrefix || '';
    if (prefix && key.startsWith(prefix)) {
      return key.slice(prefix.length);
    }

    return key;
  }

  /**
   * Store a session with TTL
   */
  async set(sessionId, sessionData) {
    try {
      const data = {
        ...sessionData,
        lastAccessed: Date.now()
      };
      
      await this.redis.setex(
        sessionId,
        this.options.ttl,
        JSON.stringify(data)
      );
      
      return data;
    } catch (error) {
      console.error('Redis set error:', error);
      throw new Error(`Failed to store session: ${error.message}`);
    }
  }

  /**
   * Retrieve a session and update TTL
   */
  async get(sessionId) {
    try {
      const data = await this.redis.get(sessionId);
      
      if (!data) {
        return null;
      }

      const session = JSON.parse(data);
      session.lastAccessed = Date.now();
      
      // Update TTL and lastAccessed
      await this.redis.setex(
        sessionId,
        this.options.ttl,
        JSON.stringify(session)
      );
      
      return session;
    } catch (error) {
      console.error('Redis get error:', error);
      throw new Error(`Failed to retrieve session: ${error.message}`);
    }
  }

  /**
   * Delete a session
   */
  async delete(sessionId) {
    try {
      const result = await this.redis.del(sessionId);
      return result === 1;
    } catch (error) {
      console.error('Redis delete error:', error);
      throw new Error(`Failed to delete session: ${error.message}`);
    }
  }

  /**
   * Check if session exists
   */
  async has(sessionId) {
    try {
      const exists = await this.redis.exists(sessionId);
      return exists === 1;
    } catch (error) {
      console.error('Redis has error:', error);
      throw new Error(`Failed to check session existence: ${error.message}`);
    }
  }

  /**
   * Get total number of sessions
   */
  async size() {
    try {
      // Count keys with our prefix
      const keys = await this.redis.keys('*');
      return keys.length;
    } catch (error) {
      console.error('Redis size error:', error);
      return 0;
    }
  }

  /**
   * Clear all sessions
   */
  async clear() {
    try {
      const keys = await this.redis.keys('*');
      if (keys.length > 0) {
        const normalizedKeys = keys.map((key) => this.stripKeyPrefix(key));
        await this.redis.del(...normalizedKeys);
      }
      console.log(`🗑️  Cleared ${keys.length} sessions from Redis`);
    } catch (error) {
      console.error('Redis clear error:', error);
      throw new Error(`Failed to clear sessions: ${error.message}`);
    }
  }

  /**
   * Get all authenticated sessions (sessions with accessToken)
   */
  async getAuthenticatedSessions() {
    try {
      const keys = await this.redis.keys('*');
      const authenticated = [];

      for (const key of keys) {
        const sessionId = this.stripKeyPrefix(key);
        const data = await this.redis.get(sessionId);
        if (data) {
          const session = JSON.parse(data);
          if (session.accessToken) {
            authenticated.push({
              sessionId,
              ...session
            });
          }
        }
      }

      return authenticated;
    } catch (error) {
      console.error('Redis getAuthenticatedSessions error:', error);
      return [];
    }
  }

  /**
   * Find session by OAuth state parameter
   */
  async findByOAuthState(state) {
    try {
      const keys = await this.redis.keys('*');

      for (const key of keys) {
        const sessionId = this.stripKeyPrefix(key);
        const data = await this.redis.get(sessionId);
        if (data) {
          const session = JSON.parse(data);
          if (session.state === state || session.oauthState === state) {
            return {
              sessionId,
              ...session
            };
          }
        }
      }

      return null;
    } catch (error) {
      console.error('Redis findByOAuthState error:', error);
      return null;
    }
  }

  /**
   * Cleanup expired sessions (handled automatically by Redis TTL)
   */
  async cleanupExpired() {
    // Redis handles expiration automatically via TTL
    // This method exists for interface compatibility
    return 0;
  }

  /**
   * Close Redis connection
   */
  async close() {
    try {
      await this.redis.quit();
      console.log('🔌 Redis connection closed gracefully');
    } catch (error) {
      console.error('Error closing Redis connection:', error);
      this.redis.disconnect();
    }
  }

  /**
   * Check Redis connection health
   */
  async ping() {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch (error) {
      return false;
    }
  }

  /**
   * Get Redis connection info
   */
  getConnectionInfo() {
    return {
      host: this.options.host,
      port: this.options.port,
      db: this.options.db,
      keyPrefix: this.options.keyPrefix,
      ttl: this.options.ttl,
      status: this.redis.status
    };
  }
}

export default RedisSessionStore;
