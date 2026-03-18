import crypto from 'crypto';

export function generateCodeVerifier() {
  const randomBytes = crypto.randomBytes(32);
  return randomBytes.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export function generateCodeChallenge(codeVerifier) {
  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  return hash.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export function validateCodeVerifier(codeVerifier) {
  if (!codeVerifier || codeVerifier.length < 43 || codeVerifier.length > 128) {
    return false;
  }
  
  // Check if it's a valid base64url string
  const base64urlRegex = /^[A-Za-z0-9_-]+$/;
  return base64urlRegex.test(codeVerifier);
}

export function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

// Helper to generate complete PKCE parameters
export function generatePKCEParameters() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();
  
  return {
    codeVerifier,
    codeChallenge,
    state
  };
}

// Validate state (for CSRF protection)
export function validateState(receivedState, expectedState) {
  if (!receivedState || !expectedState) {
    return false;
  }
  
  // Use constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(receivedState),
    Buffer.from(expectedState)
  );
}