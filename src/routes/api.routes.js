import { Router } from 'express';
import { sessionStore } from '../core/sessionStore.js';
import { OpenEMRClient } from '../services/openemr.client.js';
import { oauthService } from '../auth/oauth.service.js';

const router = Router();

/**
 * ========================================
 * Direct API Routes
 * ========================================
 * 
 * These routes provide direct access to OpenEMR resources
 * without MCP wrapping - returns raw OpenEMR FHIR responses.
 * 
 * Authentication:
 * - ALL ROUTES REQUIRE SESSION ID
 * - Provide sessionId via query param, X-Session-Id header, or body
 * - Authenticate at /oauth/direct to get a session ID
 * - Tokens auto-refresh when expired (if refresh token available)
 * 
 * Base Path: /api
 * 
 * Available Endpoints:
 * - GET    /patients              List/search patients
 * - GET    /patients/search       Advanced patient search
 * - GET    /patients/:id          Get specific patient
 * - POST   /patients              Create new patient
 * - PUT    /patients/:id          Update patient
 * - POST   /patients/:id/appointments               Create appointment
 * - GET    /patients/:id/appointments               List patient appointments
 * - GET    /appointments                            List all appointments
 * - PUT    /patients/:id/appointments/:appointmentId Modify appointment
 * - DELETE /patients/:id/appointments/:appointmentId Cancel appointment
 * - GET    /test                  Test connection
 * - GET    /capabilities          Get server capabilities
 */

// ==================== Session Authentication Middleware ====================

/**
 * Require session ID for all API routes
 * Validates session, auto-refreshes tokens, and attaches authenticated client to request
 */
async function requireSessionAuth(req, res, next) {
  let sessionId = req.query.sessionId || 
                   req.headers['x-session-id'] || 
                   req.headers['session-id'] ||
                   req.body?.sessionId;

  // Sanitize session ID
  if (sessionId) {
    sessionId = sessionId.trim();
    const uuidMatch = sessionId.match(/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    if (uuidMatch) {
      sessionId = uuidMatch[1];
    }
  }

  if (!sessionId) {
    return res.status(401).json({
      error: 'Authentication required: Session ID missing',
      hint: 'Provide sessionId via query param (?sessionId=...), X-Session-Id header, or request body',
      authenticate_at: '/oauth/direct'
    });
  }

  let session = await sessionStore.get(sessionId);
  if (!session) {
    return res.status(401).json({
      error: 'Invalid or expired session ID',
      hint: 'Complete OAuth flow at /oauth/direct first',
      authenticate_at: '/oauth/direct'
    });
  }

  if (!session.accessToken) {
    return res.status(401).json({
      error: 'Session not authenticated',
      hint: 'Session exists but OAuth flow not completed',
      authenticate_at: '/oauth/direct'
    });
  }

  // Auto-refresh token if expired or expiring soon
  const now = Date.now();
  const TOKEN_REFRESH_THRESHOLD = parseInt(process.env.TOKEN_REFRESH_THRESHOLD || '300000', 10);
  const timeUntilExpiry = session.expiresAt ? session.expiresAt - now : Infinity;

  if (timeUntilExpiry <= TOKEN_REFRESH_THRESHOLD) {
    if (session.refreshToken) {
      console.log(`🔄 API: Token expiring/expired - attempting refresh...`);
      try {
        await oauthService.verifyAndRefreshSession(session);
        session = await sessionStore.get(sessionId);
        console.log(`✅ API: Token refreshed. New expiry: ${Math.floor((session.expiresAt - Date.now()) / 60000)} minutes`);
      } catch (refreshError) {
        console.error(`❌ API: Token refresh failed: ${refreshError.message}`);
        return res.status(401).json({
          error: 'Token expired and refresh failed',
          hint: refreshError.message,
          authenticate_at: '/oauth/direct'
        });
      }
    } else {
      return res.status(401).json({
        error: 'Token expired - no refresh token available',
        hint: 'Re-authenticate at /oauth/direct',
        authenticate_at: '/oauth/direct'
      });
    }
  }

  // Update last accessed time
  session.lastAccessed = now;
  await sessionStore.set(sessionId, session);

  // Attach session and client to request
  req.authenticatedSession = session;
  req.sessionId = sessionId;
  
  try {
    req.openemrClient = new OpenEMRClient(session.accessToken, session.tokenInfo);
    next();
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to create OpenEMR client',
      message: error.message
    });
  }
}

// Apply session auth to all routes
router.use(requireSessionAuth);

// ==================== Helper Functions ====================

/**
 * Standard error handler for API routes
 * @param {Error} error - The error object
 * @param {Response} res - Express response object
 */
function handleError(error, res) {
  console.error('❌ API Error:', error.message);
  
  const statusCode = error.status || error.response?.status || 500;
  const response = {
    error: error.message,
    status: statusCode
  };
  
  // Add authentication hint for 401/403 errors
  if (statusCode === 401 || statusCode === 403 || error.message.includes('session')) {
    response.authenticate_at = '/oauth/direct';
    response.message = 'Authentication required or token expired';
  }
  
  // Add data if available (for OpenEMR API errors)
  if (error.data) {
    response.details = error.data;
  }
  
  res.status(statusCode).json(response);
}

// ==================== Patient Endpoints ====================

/**
 * GET /api/patients
 * 
 * List and search patients from OpenEMR
 * REQUIRES: sessionId in query param, X-Session-Id header, or body
 * 
 * Query Parameters:
 * - sessionId (required): Your authenticated session ID
 * - limit (number): Max results to return (default: 50, max: 1000)
 * - offset (number): Pagination offset (default: 0)
 * - search (string): Smart search - "firstname lastname" or single term
 *                    Example: "s dharan" → searches fname=s&lname=dharan
 * - fname (string): Filter by first name (overrides search)
 * - lname (string): Filter by last name (overrides search)
 * - dob (string): Filter by date of birth (YYYY-MM-DD)
 * - gender (string): Filter by gender
 * - email (string): Filter by email
 * - phone (string): Filter by phone number
 * 
 * Examples:
 * - /api/patients?sessionId=abc-123&limit=10
 * - /api/patients?sessionId=abc-123&search=john%20doe
 * - /api/patients?sessionId=abc-123&fname=John&lname=Doe
 */
router.get('/patients', async (req, res) => {
  try {
    const client = req.openemrClient;
    
    // Parse query parameters
    const params = {
      limit: parseInt(req.query.limit) || 50,
      offset: parseInt(req.query.offset) || 0
    };
    
    // Add search or specific field filters
    if (req.query.search) params.search = req.query.search;
    if (req.query.fname) params.fname = req.query.fname;
    if (req.query.lname) params.lname = req.query.lname;
    if (req.query.dob) params.dob = req.query.dob;
    if (req.query.gender) params.gender = req.query.gender;
    if (req.query.email) params.email = req.query.email;
    if (req.query.phone) params.phone = req.query.phone;
    
    const response = await client.getPatients(params);
    
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * GET /api/patients/search
 * 
 * Advanced patient search with multiple filters
 * 
 * Query Parameters:
 * - fname (string): First name
 * - lname (string): Last name
 * - dob (string): Date of birth (YYYY-MM-DD)
 * - gender (string): Gender filter
 * - phone (string): Phone number
 * - email (string): Email address
 * - street (string): Street address
 * - city (string): City
 * - state (string): State
 * - postal_code (string): Postal/ZIP code
 * - country_code (string): Country code
 * - ss (string): Social security number
 * - limit (number): Max results (default: 50, max: 500)
 * - offset (number): Pagination offset
 * 
 * Examples:
 * - /api/patients/search?fname=John&lname=Doe
 * - /api/patients/search?city=Boston&state=MA
 * - /api/patients/search?dob=1990-01-01&gender=male
 */
router.get('/patients/search', async (req, res) => {
  try {
    const client = req.openemrClient;
    
    // Pass all query parameters to searchPatients
    const searchParams = { ...req.query };
    
    // Ensure limit and offset are numbers
    if (searchParams.limit) searchParams.limit = parseInt(searchParams.limit);
    if (searchParams.offset) searchParams.offset = parseInt(searchParams.offset);
    
    const response = await client.searchPatients(searchParams);
    
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * GET /api/patients/:patientId
 * 
 * Get detailed information about a specific patient
 * 
 * Path Parameters:
 * - patientId (string): Patient UUID or ID
 * 
 * Example:
 * - /api/patients/a113b9ea-da80-40ab-bcd5-fc47ac8637cf
 */
router.get('/patients/:patientId', async (req, res) => {
  try {
    const client = req.openemrClient;
    const { patientId } = req.params;
    
    if (!patientId) {
      return res.status(400).json({ error: 'Patient ID is required' });
    }
    
    const response = await client.getPatient(patientId);
    
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * POST /api/patients
 * 
 * Create a new patient record
 * 
 * Required Body Fields:
 * - fname (string): First name
 * - lname (string): Last name
 * - dob (string): Date of birth (YYYY-MM-DD)
 * - sex (string): Gender - "Male", "Female", "Other", "Unknown"
 * 
 * Optional Body Fields:
 * - mname (string): Middle name
 * - phone_home (string): Home phone
 * - phone_cell (string): Cell phone
 * - email (string): Email address
 * - street (string): Street address
 * - city (string): City
 * - state (string): State
 * - postal_code (string): ZIP/Postal code
 * - country_code (string): Country code
 * - ss (string): Social security number
 * - race (string): Race
 * - ethnicity (string): Ethnicity
 * 
 * Example:
 * POST /api/patients
 * {
 *   "fname": "John",
 *   "lname": "Doe",
 *   "dob": "1990-01-01",
 *   "sex": "Male",
 *   "email": "john.doe@example.com",
 *   "phone_cell": "555-1234"
 * }
 */
router.post('/patients', async (req, res) => {
  try {
    const client = req.openemrClient;
    const patientData = req.body;
    
    // Validate required fields
    const requiredFields = ['fname', 'lname', 'dob', 'sex'];
    const missingFields = requiredFields.filter(field => !patientData[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: requiredFields,
        missing: missingFields
      });
    }
    
    const response = await client.createPatient(patientData);
    
    res.status(201).json(response);
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * PUT /api/patients/:patientId
 * 
 * Update an existing patient record
 * 
 * Path Parameters:
 * - patientId (string): Patient UUID or ID
 * 
 * Body Fields (all optional):
 * - fname, lname, mname, dob, sex
 * - phone_home, phone_cell, email
 * - street, city, state, postal_code, country_code
 * - ss, race, ethnicity
 * 
 * Example:
 * PUT /api/patients/a113b9ea-da80-40ab-bcd5-fc47ac8637cf
 * {
 *   "email": "newemail@example.com",
 *   "phone_cell": "555-9876"
 * }
 */
router.put('/patients/:patientId', async (req, res) => {
  try {
    const client = req.openemrClient;
    const { patientId } = req.params;
    const patientData = req.body;
    
    if (!patientId) {
      return res.status(400).json({ error: 'Patient ID is required' });
    }
    
    if (!patientData || Object.keys(patientData).length === 0) {
      return res.status(400).json({ error: 'Update data is required' });
    }
    
    const response = await client.updatePatient(patientId, patientData);
    
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// ==================== Appointment Endpoints ====================

/**
 * POST /api/patients/:patientId/appointments
 *
 * Create an appointment for a specific patient
 */
router.post('/patients/:patientId/appointments', async (req, res) => {
  try {
    const client = req.openemrClient;
    const { patientId } = req.params;
    const appointmentData = req.body;

    if (!patientId) {
      return res.status(400).json({ error: 'Patient ID is required' });
    }

    const response = await client.createAppointment(patientId, appointmentData);

    res.status(201).json(response);
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * GET /api/patients/:patientId/appointments
 *
 * List all appointments for a specific patient
 */
router.get('/patients/:patientId/appointments', async (req, res) => {
  try {
    const client = req.openemrClient;
    const { patientId } = req.params;

    if (!patientId) {
      return res.status(400).json({ error: 'Patient ID is required' });
    }

    const response = await client.getPatientAppointments(patientId);

    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * GET /api/appointments
 *
 * List all appointments, optionally filtered by date range and provider
 *
 * Query Parameters (optional):
 * - startDate: YYYY-MM-DD
 * - endDate: YYYY-MM-DD
 * - providerId: Provider/practitioner ID (pc_aid)
 */
router.get('/appointments', async (req, res) => {
  try {
    const client = req.openemrClient;
    const { startDate, endDate, providerId } = req.query;

    const response = await client.getAppointmentsByDateRange(
      startDate || null,
      endDate || null,
      providerId || null
    );

    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * PUT /api/patients/:patientId/appointments/:appointmentId
 *
 * Modify an existing appointment for a specific patient
 */
router.put('/patients/:patientId/appointments/:appointmentId', async (req, res) => {
  try {
    const client = req.openemrClient;
    const { patientId, appointmentId } = req.params;
    const appointmentData = req.body;

    if (!patientId || !appointmentId) {
      return res.status(400).json({ error: 'Patient ID and appointment ID are required' });
    }

    if (!appointmentData || Object.keys(appointmentData).length === 0) {
      return res.status(400).json({ error: 'Appointment update data is required' });
    }

    const response = await client.updateAppointment(patientId, appointmentId, appointmentData);

    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * DELETE /api/patients/:patientId/appointments/:appointmentId
 *
 * Cancel (delete) an appointment for a specific patient
 */
router.delete('/patients/:patientId/appointments/:appointmentId', async (req, res) => {
  try {
    const client = req.openemrClient;
    const { patientId, appointmentId } = req.params;

    if (!patientId || !appointmentId) {
      return res.status(400).json({ error: 'Patient ID and appointment ID are required' });
    }

    const response = await client.cancelAppointment(patientId, appointmentId);
    res.json({
      success: true,
      message: `Appointment ${appointmentId} deleted and verified for patient ${patientId}`,
      patientId,
      appointmentId,
      result: response
    });
  } catch (error) {
    handleError(error, res);
  }
});

// ==================== System Endpoints ====================

/**
 * GET /api/test
 * 
 * Test connection to OpenEMR server
 * 
 * Returns:
 * - success (boolean): Connection status
 * - message (string): Status message
 * - data (object): Server metadata if successful
 */
router.get('/test', async (req, res) => {
  try {
    const client = req.openemrClient;
    const result = await client.testConnection();
    
    res.json(result);
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * GET /api/capabilities
 * 
 * Get OpenEMR server capabilities and available resources
 * 
 * Returns:
 * - success (boolean): Request status
 * - fhirVersion (string): FHIR version
 * - availableResources (array): List of available resource types
 * - totalResources (number): Count of resource types
 */
router.get('/capabilities', async (req, res) => {
  try {
    const client = req.openemrClient;
    const result = await client.getCapabilities();
    
    res.json(result);
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * GET /api
 * 
 * API documentation and available endpoints
 * NOTE: This endpoint also requires session ID authentication
 */
router.get('/', (req, res) => {
  res.json({
    name: 'OpenEMR Direct API',
    description: 'Direct access to OpenEMR resources without MCP wrapping',
    version: '1.0.0',
    current_session: req.sessionId,
    authentication: {
      method: 'Session ID required on ALL requests',
      authenticate_at: '/oauth/direct',
      provide_session_via: [
        'Query param: ?sessionId=<your-session-id>',
        'Header: X-Session-Id: <your-session-id>',
        'Body: { "sessionId": "<your-session-id>" }'
      ],
      note: 'No public access - all endpoints require valid session ID'
    },
    endpoints: {
      patients: {
        list: 'GET /api/patients?sessionId=<id>',
        search: 'GET /api/patients/search?sessionId=<id>',
        get: 'GET /api/patients/:patientId?sessionId=<id>',
        create: 'POST /api/patients?sessionId=<id>',
        update: 'PUT /api/patients/:patientId?sessionId=<id>'
      },
      appointments: {
        all: 'GET /api/appointments?sessionId=<id>',
        create: 'POST /api/patients/:patientId/appointments?sessionId=<id>',
        list: 'GET /api/patients/:patientId/appointments?sessionId=<id>',
        modify: 'PUT /api/patients/:patientId/appointments/:appointmentId?sessionId=<id>',
        cancel: 'DELETE /api/patients/:patientId/appointments/:appointmentId?sessionId=<id>'
      },
      system: {
        test: 'GET /api/test?sessionId=<id>',
        capabilities: 'GET /api/capabilities?sessionId=<id>'
      }
    },
    examples: {
      list_patients: `GET /api/patients?sessionId=${req.sessionId}&limit=10`,
      search_by_name: `GET /api/patients?sessionId=${req.sessionId}&search=john%20doe`,
      search_advanced: `GET /api/patients/search?sessionId=${req.sessionId}&fname=John&lname=Doe`,
      get_patient: `GET /api/patients/a113b9ea-da80-40ab-bcd5-fc47ac8637cf?sessionId=${req.sessionId}`,
      create_patient: `POST /api/patients?sessionId=${req.sessionId} (with JSON body)`,
      update_patient: `PUT /api/patients/:id?sessionId=${req.sessionId} (with JSON body)`,
      list_all_appointments: `GET /api/appointments?sessionId=${req.sessionId}&startDate=2026-02-01&endDate=2026-02-28`,
      create_appointment: `POST /api/patients/:patientId/appointments?sessionId=${req.sessionId} (with JSON body)`,
      list_appointments: `GET /api/patients/:patientId/appointments?sessionId=${req.sessionId}`,
      modify_appointment: `PUT /api/patients/:patientId/appointments/:appointmentId?sessionId=${req.sessionId} (with JSON body)`,
      cancel_appointment: `DELETE /api/patients/:patientId/appointments/:appointmentId?sessionId=${req.sessionId}`
    },
    notes: [
      'ALL ROUTES REQUIRE SESSION ID - No public access',
      'All endpoints return raw OpenEMR FHIR responses',
      'Search parameter intelligently splits "firstname lastname" format',
      'Use specific fields (fname, lname) for exact matching',
      'Date format: YYYY-MM-DD',
      'Limit ranges: list (1-1000), search (1-500)'
    ]
  });
});

export default router;
