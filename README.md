# OpenEMR MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A Model Context Protocol (MCP) server for secure integration with OpenEMR using OAuth 2.0 and PKCE.  
This server manages authentication, token lifecycle, and session storage with optional Redis support.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Project Structure](#project-structure)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Server](#running-the-server)
- [OAuth 2.0 & OpenID Connect Flow](#oauth-20--openid-connect-flow)
- [Token Management](#token-management)
- [Session Management](#session-management)
- [Redis Integration](#redis-integration)
- [Memory Store](#memory-store)
- [Session Data Format](#session-data-format)
- [Logout & Revocation](#logout--revocation)
- [Error Handling](#error-handling)
- [Notes](#notes)
- [License](#license)

---

## Overview

This project implements an MCP server that connects to OpenEMR using OAuth 2.0 with PKCE.

It provides:

- Secure authentication  
- Token validation and refresh  
- Pluggable session storage  
- MCP-compliant API endpoints  

The server is built using Node.js and Express.

---

## Features

- OAuth 2.0 Authorization Code Flow with PKCE  
- JWT access token verification  
- Automatic token refresh  
- Redis and in-memory session storage  
- Token revocation support  
- Health monitoring endpoint  
- Graceful shutdown handling  

---

## Project Structure


```
OpenEMR
├─ package.json
├─ README.md
├─ LICENSE
├─ CONTRIBUTING.md
├─ CODE_OF_CONDUCT.md
├─ server.js
├─ .env.example
└─ src
   ├─ app.js
   ├─ auth
   │  ├─ auth.middleware.js
   │  ├─ oauth.service.js
   │  └─ tokenVerifier.js
   ├─ config
   │  └─ openemr.js
   ├─ core
   │  ├─ internalSessionManager.js
   │  ├─ sessionStore.js
   │  └─ stores
   │     ├─ BaseSessionStore.js
   │     ├─ MemorySessionStore.js
   │     └─ RedisSessionStore.js
   ├─ mcp
   │  ├─ mcp.helpers.js
   │  ├─ mcp.resources.js
   │  ├─ mcp.routes.js
   │  ├─ mcp.server.js
   │  ├─ mcp.tools.appointments.js
   │  ├─ mcp.tools.insurance.js
   │  └─ mcp.tools.patients.js
   ├─ routes
   │  ├─ api.routes.js
   │  ├─ auth.routes.js
   │  ├─ log.routes.js
   │  └─ status.routes.js
   ├─ services
   │  ├─ openemr.client.js
   │  └─ openemr
   │     ├─ appointments.client.js
   │     ├─ base.client.js
   │     ├─ insurance.client.js
   │     ├─ patients.client.js
   │     └─ system.client.js
   └─ utils
      └─ pkce.js
```



---

## Installation

Clone the repository and install dependencies:

```bash
git clone <repository-url>
cd OpenEMR
npm install
```

---

## Configuration

Create a `.env` file in the root directory.

### Required Variables

```env
PORT=8082

OPENEMR_CLIENT_ID=
OPENEMR_CLIENT_SECRET=
OPENEMR_AUTH_URL=
OPENEMR_TOKEN_URL=
OPENEMR_REDIRECT_URI=
OPENEMR_SCOPES=

SESSION_STORE=memory
SESSION_TTL=3600
```

---

### Redis (Optional)

If using Redis:

```env
SESSION_STORE=redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
```

---

## Running the Server

Start the server:

```bash
npm start
```

Or:

```bash
node server.js
```

Default port: **8082**

---

## API Endpoints

| Method | Endpoint           | Description               |
|--------|--------------------|---------------------------|
| GET    | /health            | Health check              |
| GET    | /oauth/authorize   | Start OAuth login         |
| POST   | /oauth/callback    | OAuth token exchange      |
| POST   | /mcp/*             | MCP endpoints (protected) |

---

## OAuth 2.0 & OpenID Connect Flow

### Authorization Flow (PKCE)

1. Client calls `/oauth/authorize`
2. Server generates:
   - `code_verifier`
   - `code_challenge`
   - `state`
   - `sessionId`
3. User authenticates with OpenEMR
4. OpenEMR redirects to `/oauth/callback`
5. Server exchanges authorization code for tokens
6. Tokens are stored in the session store

---

### Supported Grants

- Authorization Code (PKCE)  
- Refresh Token  
- Client Credentials (fallback)  

---

## Token Management

Each authenticated session stores:

- Access token  
- Refresh token (if available)  
- Expiration time  
- Token type  
- ID token (optional)  
- Decoded token metadata  

---

### Automatic Refresh

**How it works:**
- Tokens are **automatically refreshed** on every authenticated request when expiring soon
- Default threshold: **5 minutes** before expiration (configurable)
- Refresh token is used if available  
- Session is updated automatically with new tokens
- If refresh fails, re-authentication is required  

**Configuration:**

Set the refresh threshold in milliseconds using environment variable:

```bash
# Refresh when token has 1 minute left
TOKEN_REFRESH_THRESHOLD=60000

# Refresh when token has 2 minutes left
TOKEN_REFRESH_THRESHOLD=120000

# Refresh when token has 5 minutes left (default)
TOKEN_REFRESH_THRESHOLD=300000

# Refresh when token has 10 minutes left
TOKEN_REFRESH_THRESHOLD=600000
```

**Logging:**

The server logs automatic refresh activities:
```
🔄 Token expiring in 4m 30s (threshold: 5m)
   Session: abc-123-def
   Auto-refreshing token...
✅ Token auto-refreshed successfully for session abc-123-def
   New token expires in: 60 minutes
```

**Manual Refresh:**

You can also manually refresh tokens via API:

```bash
POST /auth/refresh
X-Session-Id: your-session-id
Content-Type: application/json

{
  "force": true  # Optional: force refresh even if not expiring soon
}
```  

---

## Session Management

Session handling is implemented through a unified interface in:

```
src/core/sessionStore.js
```

### Supported Backends

- Memory store  
- Redis store  

Store selection:

```env
SESSION_STORE=memory|redis
```

---

## Redis Integration

Redis support is implemented in:

```
src/core/stores/RedisSessionStore.js
```

### Features

- Uses ioredis  
- TTL-based expiration  
- Automatic cleanup  
- Key prefixing  
- Connection health monitoring  

---

### Redis Behavior

- Sessions stored as JSON  
- TTL refreshed on access  
- Expired sessions auto-deleted  

Supports:

- Session lookup  
- OAuth state lookup  
- Active session listing  
- Full cleanup  

---

## Memory Store

Implemented in:

```
src/core/stores/MemorySessionStore.js
```

### Characteristics

- In-process storage  
- TTL-based expiration  
- Periodic cleanup  
- Not suitable for production clusters  
- Intended for development  

---

## Session Data Format

Example session object:

```json
{
  "sessionId": "uuid",
  "state": "oauth_state",
  "codeVerifier": "pkce_verifier",
  "createdAt": 1700000000000,
  "lastAccessed": 1700000001000,
  "step": "authenticated",
  "accessToken": "...",
  "refreshToken": "...",
  "expiresAt": 1700003600000,
  "tokenInfo": {
    "clientId": "...",
    "scopes": [],
    "expiresAt": "...",
    "issuedAt": "..."
  }
}
```

---

## Logout & Revocation

On logout:

- Session is deleted  
- Access token is revoked (if supported)  
- Refresh token is revoked (if supported)  

Revocation is best-effort and depends on OpenEMR support.

---

## Error Handling

- Centralized Express error handler  
- OAuth failures are logged with:
  - HTTP status  
  - Response body  
  - Headers (if available)  
- JWT verification failures fall back to decoding  

---

## Notes

- Redis handles expiration using TTL  
- SQL-based session store is not implemented  
- SSE cleanup is partially implemented  
- Token revocation depends on OpenEMR configuration  

---

## License

This project is licensed under the [MIT License](LICENSE).


## Why Redis Is Used

Redis is used to store OAuth sessions and access/refresh tokens outside the server’s memory.  
It prevents session loss when the server restarts or crashes.  
It allows multiple server instances to share the same authentication data.  
It automatically expires old sessions using TTL for better reliability.

