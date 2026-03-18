import axios from 'axios';
import { OPENEMR_CONFIG } from '../../config/openemr.js';

export class OpenEMRClientBase {
  constructor(accessToken, tokenInfo = null) {
    this.accessToken = accessToken;
    this.tokenInfo = tokenInfo;
    this.baseURL = OPENEMR_CONFIG.BASE_URL;
    this.apiPrefix = OPENEMR_CONFIG.API_PREFIX;
  }

  async request(method, endpoint, data = null, params = null) {
    try {
      const url = `${this.baseURL}${endpoint}`;
      const config = {
        method,
        url,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        timeout: 30000,
        validateStatus: status => status >= 200 && status < 500
      };

      if (params) {
        config.params = params;
        config.paramsSerializer = this.serializeParams;
      }

      if (data && ['POST', 'PUT', 'PATCH'].includes(method)) {
        config.data = data;
      }

      this.logRequest(method, url, params);

      const response = await axios(config);
      this.logResponse(response);

      if (response.status >= 400) {
        throw this.createApiError(response);
      }

      return response.data;
    } catch (error) {
      this.handleRequestError(error, method, endpoint);
      throw error;
    }
  }

  serializeParams(params) {
    return Object.entries(params)
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          return value.map(v => `${key}=${encodeURIComponent(v)}`).join('&');
        }
        return `${key}=${encodeURIComponent(value)}`;
      })
      .join('&');
  }

  logRequest(method, url, params) {
    console.log(`🌐 OpenEMR API: ${method} ${url}`);
    if (params) {
      console.log(
        '   Query params:',
        Object.keys(params)
          .map(key => `${key}=${params[key]}`)
          .join(', ')
      );
    }
  }

  logResponse(response) {
    console.log(`✅ OpenEMR API Response: ${response.status} ${response.statusText}`);
  }

  createApiError(response) {
    console.error('🔥 OpenEMR Validation Error:');
    console.error(JSON.stringify(response.data, null, 2));

    const error = new Error(`OpenEMR API error: ${response.status}`);
    error.status = response.status;
    error.data = response.data;
    return error;
  }

  handleRequestError(error, method, endpoint) {
    console.error(`❌ OpenEMR API Error: ${method} ${this.baseURL}${endpoint}`);

    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error('   Data:', error.response.data);
      console.error('   Headers:', error.response.headers);
    } else if (error.request) {
      console.error('   No response received:', error.message);
    } else {
      console.error('   Request setup error:', error.message);
    }
  }

  hasScope(requiredScope) {
    return this.tokenInfo?.scopes?.includes(requiredScope) || false;
  }

  hasAnyScope(requiredScopes) {
    return requiredScopes.some(scope => this.hasScope(scope));
  }

  hasAllScopes(requiredScopes) {
    return requiredScopes.every(scope => this.hasScope(scope));
  }

  validateScopes(requiredScopes, options = { requireAll: false }) {
    const hasRequiredScopes = options.requireAll
      ? this.hasAllScopes(requiredScopes)
      : this.hasAnyScope(requiredScopes);

    if (!hasRequiredScopes) {
      throw new Error(this.getScopeErrorMessage(requiredScopes, options.requireAll));
    }
  }

  getScopeErrorMessage(requiredScopes, requireAll = false) {
    const available = this.tokenInfo?.scopes || [];
    const verb = requireAll ? 'all of' : 'one of';
    return `Insufficient scopes. Required: ${verb} [${requiredScopes.join(', ')}]. Available: [${available.join(', ')}] (${available.length} scopes)`;
  }

  getTokenInfo() {
    return {
      clientId: this.tokenInfo?.clientId || 'unknown',
      scopes: this.tokenInfo?.scopes || [],
      expiresAt: this.tokenInfo?.expiresAt || null,
      issuedAt: this.tokenInfo?.issuedAt || null,
      subject: this.tokenInfo?.subject || null,
      issuer: this.tokenInfo?.issuer || null
    };
  }

  getExpirationTime() {
    return this.tokenInfo?.expiresAt || null;
  }

  isExpired() {
    const expiresAt = this.getExpirationTime();
    return expiresAt ? Date.now() >= expiresAt : false;
  }

  willExpireSoon(bufferSeconds = 300) {
    const expiresAt = this.getExpirationTime();
    return expiresAt ? Date.now() >= expiresAt - bufferSeconds * 1000 : false;
  }

  validateRequiredParam(param, paramName) {
    if (!param) {
      throw new Error(`${paramName} is required`);
    }
  }

  validatePatientData(data, requiredFields = []) {
    if (!data) {
      throw new Error('Patient data is required');
    }

    const missingFields = requiredFields.filter(
      field => !data[field] && !data[field.toUpperCase()]
    );

    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }
  }

  minutesToTime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }

  timeToMinutes(time) {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + (minutes || 0);
  }

  validateAppointmentData(data, requiredFields = []) {
    if (!data) {
      throw new Error('Appointment data is required');
    }

    const missingFields = requiredFields.filter(field => !data[field]);

    if (missingFields.length > 0) {
      throw new Error(`Missing required appointment fields: ${missingFields.join(', ')}`);
    }

    if (data.pc_eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(data.pc_eventDate)) {
      throw new Error('pc_eventDate must be in YYYY-MM-DD format');
    }

    if (data.pc_startTime && !/^\d{2}:\d{2}(:\d{2})?$/.test(data.pc_startTime)) {
      throw new Error('pc_startTime must be in HH:MM or HH:MM:SS format');
    }

    if (data.pc_duration && isNaN(Number(data.pc_duration))) {
      throw new Error('pc_duration must be a number (seconds)');
    }
  }

  normalizeAppointmentData(data) {
    const cleaned = { ...data };

    if (cleaned.pc_duration) {
      cleaned.pc_duration = String(cleaned.pc_duration);
    }

    if (cleaned.pc_catid) {
      cleaned.pc_catid = String(cleaned.pc_catid);
    }
    if (cleaned.pc_facility) {
      cleaned.pc_facility = String(cleaned.pc_facility);
    }
    if (cleaned.pc_billing_location) {
      cleaned.pc_billing_location = String(cleaned.pc_billing_location);
    }
    if (cleaned.pc_aid) {
      cleaned.pc_aid = String(cleaned.pc_aid);
    }

    Object.keys(cleaned).forEach(key => {
      if (cleaned[key] === null || cleaned[key] === undefined || cleaned[key] === '') {
        delete cleaned[key];
      }
    });

    return cleaned;
  }
}
