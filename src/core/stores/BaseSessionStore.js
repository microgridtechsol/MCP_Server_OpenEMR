/**
 * Base abstract class for session storage
 * Defines the interface that all session store implementations must follow
 */
class BaseSessionStore {
  constructor() {
    if (new.target === BaseSessionStore) {
      throw new Error('BaseSessionStore is abstract and cannot be instantiated directly');
    }
  }

  /**
   * Store a session
   * @param {string} sessionId - Unique session identifier
   * @param {Object} sessionData - Session data to store
   * @returns {Promise<Object>} Stored session data
   */
  async set(sessionId, sessionData) {
    throw new Error('Method set() must be implemented');
  }

  /**
   * Retrieve a session
   * @param {string} sessionId - Unique session identifier
   * @returns {Promise<Object|null>} Session data or null if not found
   */
  async get(sessionId) {
    throw new Error('Method get() must be implemented');
  }

  /**
   * Delete a session
   * @param {string} sessionId - Unique session identifier
   * @returns {Promise<boolean>} True if deleted, false otherwise
   */
  async delete(sessionId) {
    throw new Error('Method delete() must be implemented');
  }

  /**
   * Check if session exists
   * @param {string} sessionId - Unique session identifier
   * @returns {Promise<boolean>} True if exists, false otherwise
   */
  async has(sessionId) {
    throw new Error('Method has() must be implemented');
  }

  /**
   * Get total number of sessions
   * @returns {Promise<number>} Number of sessions
   */
  async size() {
    throw new Error('Method size() must be implemented');
  }

  /**
   * Clear all sessions
   * @returns {Promise<void>}
   */
  async clear() {
    throw new Error('Method clear() must be implemented');
  }

  /**
   * Get all authenticated sessions
   * @returns {Promise<Array>} Array of authenticated sessions
   */
  async getAuthenticatedSessions() {
    throw new Error('Method getAuthenticatedSessions() must be implemented');
  }

  /**
   * Get session by OAuth state
   * @param {string} state - OAuth state parameter
   * @returns {Promise<Object|null>} Session data or null if not found
   */
  async findByOAuthState(state) {
    throw new Error('Method findByOAuthState() must be implemented');
  }

  /**
   * Cleanup expired sessions
   * @returns {Promise<number>} Number of sessions cleaned up
   */
  async cleanupExpired() {
    throw new Error('Method cleanupExpired() must be implemented');
  }

  /**
   * Close/cleanup the store connection
   * @returns {Promise<void>}
   */
  async close() {
    // Optional method - default implementation does nothing
    return Promise.resolve();
  }
}

export default BaseSessionStore;
