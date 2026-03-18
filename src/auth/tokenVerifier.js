import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { OPENEMR_CONFIG } from '../config/openemr.js';

export class OpenEMRTokenVerifier {
  constructor() {
    this.jwksUri = OPENEMR_CONFIG.JWKS_URL;
    this.issuer = OPENEMR_CONFIG.JWT_ISSUER;
    this.audience = OPENEMR_CONFIG.JWT_AUDIENCE;
    this.algorithms = OPENEMR_CONFIG.JWT_ALGORITHMS;
    
    this.jwksClient = jwksClient({
      jwksUri: this.jwksUri,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 600000,
      rateLimit: true,
      jwksRequestsPerMinute: 10
    });
  }

  getKey(header, callback) {
    this.jwksClient.getSigningKey(header.kid, (err, key) => {
      if (err) {
        console.error('❌ Error getting signing key:', err.message);
        return callback(err);
      }
      
      try {
        const signingKey = key.getPublicKey();
        callback(null, signingKey);
      } catch (error) {
        console.error('❌ Error extracting public key:', error.message);
        callback(error);
      }
    });
  }

  async verifyToken(token) {
    return new Promise((resolve, reject) => {
      if (!token) {
        return reject(new Error('Token is required'));
      }

      // First, decode without verification to check structure
      const decodedWithoutVerify = jwt.decode(token, { complete: true });
      if (!decodedWithoutVerify) {
        return reject(new Error('Invalid token format'));
      }

      console.log(`🔍 Token header:`, decodedWithoutVerify.header);
      console.log(`🔍 Token payload preview:`, {
        iss: decodedWithoutVerify.payload.iss,
        aud: decodedWithoutVerify.payload.aud,
        exp: decodedWithoutVerify.payload.exp,
        iat: decodedWithoutVerify.payload.iat,
        sub: decodedWithoutVerify.payload.sub?.substring(0, 20) + '...'
      });

      jwt.verify(
        token,
        this.getKey.bind(this),
        {
          algorithms: this.algorithms,
          audience: this.audience,
          issuer: this.issuer,
          ignoreExpiration: false,
          ignoreNotBefore: false,
          clockTolerance: 30 // 30 seconds tolerance
        },
        (err, decoded) => {
          if (err) {
            console.error(`❌ JWT verification failed:`, {
              message: err.message,
              name: err.name,
              expiredAt: err.expiredAt,
              date: err.date
            });
            return reject(err);
          }
          
          // Extract scopes from various possible locations
          let scopes = [];
          if (decoded.scope) {
            scopes = typeof decoded.scope === 'string' 
              ? decoded.scope.split(' ') 
              : decoded.scope;
          } else if (decoded.permissions) {
            scopes = Array.isArray(decoded.permissions) 
              ? decoded.permissions 
              : [decoded.permissions];
          } else if (decoded.scp) {
            scopes = Array.isArray(decoded.scp) 
              ? decoded.scp 
              : [decoded.scp];
          } else if (decoded.scopes) {
            scopes = Array.isArray(decoded.scopes)
              ? decoded.scopes
              : decoded.scopes.split(' ');
          }

          // Get client ID from various possible locations
          const clientId = decoded.azp || 
                          decoded.client_id || 
                          decoded.cid || 
                          decoded.clientId || 
                          'unknown';

          const tokenInfo = {
            token,
            clientId,
            scopes,
            expiresAt: decoded.exp ? decoded.exp * 1000 : null,
            issuedAt: decoded.iat ? decoded.iat * 1000 : null,
            subject: decoded.sub,
            issuer: decoded.iss,
            audience: decoded.aud,
            resource: this.audience,
            rawPayload: decoded
          };

          console.log(`✅ Token verified successfully:`, {
            clientId: tokenInfo.clientId,
            scopesCount: tokenInfo.scopes.length,
            expiresAt: tokenInfo.expiresAt ? new Date(tokenInfo.expiresAt).toISOString() : 'N/A',
            subject: tokenInfo.subject?.substring(0, 20) + '...'
          });

          resolve(tokenInfo);
        }
      );
    });
  }

  async decodeToken(token) {
    try {
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded) {
        throw new Error('Invalid token format');
      }

      let scopes = [];
      if (decoded.payload.scope) {
        scopes = typeof decoded.payload.scope === 'string' 
          ? decoded.payload.scope.split(' ') 
          : decoded.payload.scope;
      } else if (decoded.payload.scp) {
        scopes = Array.isArray(decoded.payload.scp) 
          ? decoded.payload.scp 
          : [decoded.payload.scp];
      }

      return {
        header: decoded.header,
        payload: decoded.payload,
        clientId: decoded.payload.azp || decoded.payload.client_id || decoded.payload.cid || 'unknown',
        scopes,
        expiresAt: decoded.payload.exp ? decoded.payload.exp * 1000 : null,
        issuedAt: decoded.payload.iat ? decoded.payload.iat * 1000 : null,
        subject: decoded.payload.sub
      };
    } catch (error) {
      console.error('❌ Token decode error:', error.message);
      throw error;
    }
  }

  async validateToken(token) {
    try {
      const tokenInfo = await this.verifyToken(token);
      return {
        valid: true,
        tokenInfo
      };
    } catch (error) {
      console.warn('⚠️ Token validation failed:', error.message);
      
      // Try to decode anyway for debugging
      try {
        const decoded = await this.decodeToken(token);
        return {
          valid: false,
          error: error.message,
          decoded,
          warning: 'Token verification failed but decoded successfully'
        };
      } catch (decodeError) {
        return {
          valid: false,
          error: error.message,
          decoded: null
        };
      }
    }
  }

  hasScope(tokenInfo, requiredScope) {
    if (!tokenInfo || !tokenInfo.scopes) {
      return false;
    }
    return tokenInfo.scopes.includes(requiredScope);
  }

  hasAnyScope(tokenInfo, requiredScopes) {
    if (!tokenInfo || !tokenInfo.scopes) {
      return false;
    }
    return requiredScopes.some(scope => tokenInfo.scopes.includes(scope));
  }

  hasAllScopes(tokenInfo, requiredScopes) {
    if (!tokenInfo || !tokenInfo.scopes) {
      return false;
    }
    return requiredScopes.every(scope => tokenInfo.scopes.includes(scope));
  }

  getScopeErrorMessage(tokenInfo, requiredScopes, requireAll = false) {
    const available = tokenInfo?.scopes || [];
    const verb = requireAll ? 'all of' : 'one of';
    return `Insufficient scopes. Required: ${verb} [${requiredScopes.join(', ')}]. Available: [${available.join(', ')}] (${available.length} scopes)`;
  }

  isTokenExpired(tokenInfo) {
    if (!tokenInfo?.expiresAt) {
      return false;
    }
    const now = Date.now();
    const buffer = 30000; // 30 seconds buffer
    return now >= (tokenInfo.expiresAt - buffer);
  }

  getTokenLifetime(tokenInfo) {
    if (!tokenInfo?.expiresAt || !tokenInfo?.issuedAt) {
      return null;
    }
    return {
      issuedAt: new Date(tokenInfo.issuedAt).toISOString(),
      expiresAt: new Date(tokenInfo.expiresAt).toISOString(),
      expiresIn: Math.floor((tokenInfo.expiresAt - Date.now()) / 1000),
      lifetime: Math.floor((tokenInfo.expiresAt - tokenInfo.issuedAt) / 1000)
    };
  }
}

// Singleton instance
export const tokenVerifier = new OpenEMRTokenVerifier();