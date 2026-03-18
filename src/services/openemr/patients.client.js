export const patientClientMethods = {
  async getPatients(params = {}) {
    const patientScopes = ['patient/Patient.rs', 'user/patient.crus', 'api:oemr', 'api:fhir'];

    this.validateScopes(patientScopes);

    const queryParams = {
      limit: Math.min(params.limit || 50, 1000),
      offset: params.offset || 0
    };

    if (params.search) {
      const searchTerm = params.search.trim();

      if (searchTerm.includes(' ')) {
        const parts = searchTerm.split(/\s+/);
        queryParams.fname = parts[0];
        queryParams.lname = parts.slice(1).join(' ');
      } else {
        queryParams.fname = searchTerm;
      }
    }

    if (params.fname) queryParams.fname = params.fname;
    if (params.lname) queryParams.lname = params.lname;
    if (params.sex) queryParams.sex = params.sex;
    if (params.dob) queryParams.dob = params.dob;
    if (params.email) queryParams.email = params.email;
    if (params.phone) queryParams.phone = params.phone;

    return this.request('GET', `${this.apiPrefix}/patient`, null, queryParams);
  },

  async getPatient(patientId) {
    const patientScopes = ['patient/Patient.rs', 'user/patient.crus', 'api:oemr', 'api:fhir'];

    this.validateScopes(patientScopes);
    this.validateRequiredParam(patientId, 'puuid or patient_id');

    return this.request('GET', `${this.apiPrefix}/patient/${patientId}`);
  },

  async createPatient(patientData) {
    const patientScopes = ['user/patient.crus', 'api:oemr', 'api:fhir'];

    this.validateScopes(patientScopes);
    this.validatePatientData(patientData, ['fname', 'lname', 'title', 'dob', 'sex']);

    const cleanedData = this.normalizePatientData(patientData);

    if (!cleanedData.DOB) {
      throw new Error('DOB is required (YYYY-MM-DD)');
    }

    if (!cleanedData.title) {
      throw new Error('title is required');
    }

    return this.request('POST', `${this.apiPrefix}/patient`, cleanedData);
  },

  normalizePatientData(data) {
    const cleaned = { ...data };

    if (cleaned.dob) {
      cleaned.dob = this.normalizeDobValue(cleaned.dob);
    }

    if (cleaned.DOB) {
      cleaned.DOB = this.normalizeDobValue(cleaned.DOB);
    }

    if (cleaned.dob && !cleaned.DOB) {
      cleaned.DOB = cleaned.dob;
      delete cleaned.dob;
    }

    if (cleaned.sex) {
      const genderMap = {
        male: 'Male',
        female: 'Female',
        other: 'Other',
        unknown: 'Unknown'
      };

      cleaned.sex = genderMap[cleaned.sex.toLowerCase()] || cleaned.sex;
    }

    if (!cleaned.phone_contact) {
      if (cleaned.phone) cleaned.phone_contact = cleaned.phone;
      else if (cleaned.phone_cell) cleaned.phone_contact = cleaned.phone_cell;
      else if (cleaned.phone_home) cleaned.phone_contact = cleaned.phone_home;
    }

    if (cleaned.phone_contact && !cleaned.phone_cell) {
      cleaned.phone_cell = cleaned.phone_contact;
    }

    if (cleaned.phone) {
      delete cleaned.phone;
    }

    if (cleaned.country_code) {
      const countryMap = {
        india: 'IN',
        'india-91': 'IN',
        'in-91': 'IN'
      };

      const key = cleaned.country_code.toLowerCase();
      cleaned.country_code = countryMap[key] || cleaned.country_code.toUpperCase();
    }

    Object.keys(cleaned).forEach(key => {
      if (cleaned[key] === null || cleaned[key] === undefined || cleaned[key] === '') {
        delete cleaned[key];
      }
    });

    return cleaned;
  },

  normalizeDobValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return raw;

    const normalizedSeparators = raw.replace(/[./]/g, '-');

    if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedSeparators)) {
      return normalizedSeparators;
    }

    if (/^\d{2}-\d{2}-\d{4}$/.test(normalizedSeparators)) {
      const [day, month, year] = normalizedSeparators.split('-');
      return `${year}-${month}-${day}`;
    }

    return normalizedSeparators;
  },

  async updatePatient(puuid, patientData) {
    const patientScopes = ['user/patient.crus', 'api:oemr', 'api:fhir'];

    this.validateScopes(patientScopes);
    this.validateRequiredParam(puuid, 'Patient ID');

    const cleanedData = this.normalizePatientData(patientData);

    this.validatePatientData(cleanedData, ['fname', 'lname', 'DOB', 'sex']);

    if (/^\d+$/.test(puuid)) {
      const patientResponse = await this.getPatient(puuid);
      const patientRecord = Array.isArray(patientResponse?.data)
        ? patientResponse.data[0]
        : Array.isArray(patientResponse)
          ? patientResponse[0]
          : patientResponse;

      const resolvedUuid = patientRecord?.uuid || patientRecord?.id;
      if (!resolvedUuid) {
        throw new Error(`Could not resolve UUID for patient_id ${puuid}`);
      }

      puuid = resolvedUuid;
    }

    return this.request('PUT', `${this.apiPrefix}/patient/${puuid}`, cleanedData);
  },

  async searchPatients(searchParams = {}) {
    const patientScopes = ['patient/Patient.rs', 'user/patient.crus', 'api:oemr', 'api:fhir'];

    this.validateScopes(patientScopes);

    const cleanedParams = Object.fromEntries(
      Object.entries(searchParams).filter(
        ([, value]) =>
          value !== null &&
          value !== undefined &&
          value !== '' &&
          value !== 'null'
      )
    );

    if (cleanedParams.limit) {
      cleanedParams.limit = Math.min(cleanedParams.limit, 500);
    }

    delete cleanedParams._count;
    delete cleanedParams._offset;

    const response = await this.request('GET', `${this.apiPrefix}/patient`, null, cleanedParams);
    return response?.data || [];
  }
};
