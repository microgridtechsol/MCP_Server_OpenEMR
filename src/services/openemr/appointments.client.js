export const appointmentClientMethods = {
  async createAppointment(patientId, appointmentData) {
    const appointmentScopes = ['user/patient.crus', 'api:oemr', 'api:fhir'];

    this.validateScopes(appointmentScopes);
    this.validateRequiredParam(patientId, 'Patient ID');

    const requiredFields = [
      'pc_catid',
      'pc_title',
      'pc_duration',
      'pc_hometext',
      'pc_apptstatus',
      'pc_eventDate',
      'pc_startTime',
      'pc_facility',
      'pc_billing_location'
    ];

    this.validateAppointmentData(appointmentData, requiredFields);

    const cleanedData = this.normalizeAppointmentData(appointmentData);

    return this.request('POST', `${this.apiPrefix}/patient/${patientId}/appointment`, cleanedData);
  },

  async getPatientAppointments(patientId) {
    const appointmentScopes = ['user/patient.crus', 'api:oemr', 'api:fhir'];

    this.validateScopes(appointmentScopes);
    this.validateRequiredParam(patientId, 'Patient ID');

    try {
      return await this.request('GET', `${this.apiPrefix}/patient/${patientId}/appointment`);
    } catch (error) {
      if (error.status === 404) {
        console.log(`ℹ️ No appointments found for patient ${patientId} (404) — returning empty list`);
        return { data: [] };
      }
      throw error;
    }
  },

  async getAllAppointments(params = {}) {
    const appointmentScopes = ['user/patient.crus', 'api:oemr', 'api:fhir'];

    this.validateScopes(appointmentScopes);

    const queryParams = {
      limit: Math.min(params.limit || 100, 1000),
      offset: params.offset || 0
    };

    if (params.start_date) queryParams.pc_eventDate = `ge${params.start_date}`;
    if (params.end_date) queryParams['pc_eventDate:end'] = `le${params.end_date}`;
    if (params.provider_id) queryParams.pc_aid = params.provider_id;
    if (params.patient_id) queryParams.pid = params.patient_id;

    return this.request('GET', `${this.apiPrefix}/appointment`, null, queryParams);
  },

  async updateAppointment(patientId, appointmentId, appointmentData) {
    const appointmentScopes = ['user/patient.crus', 'api:oemr', 'api:fhir'];

    this.validateScopes(appointmentScopes);
    this.validateRequiredParam(patientId, 'Patient ID');
    this.validateRequiredParam(appointmentId, 'Appointment ID');

    if (!appointmentData || Object.keys(appointmentData).length === 0) {
      throw new Error('Appointment update data is required');
    }

    this.validateAppointmentData(appointmentData);

    const cleanedData = this.normalizeAppointmentData(appointmentData);

    return this.request(
      'PUT',
      `${this.apiPrefix}/patient/${patientId}/appointment/${appointmentId}`,
      cleanedData
    );
  },

  async cancelAppointment(patientId, appointmentId) {
    const appointmentScopes = ['user/patient.crus', 'api:oemr', 'api:fhir'];

    this.validateScopes(appointmentScopes);
    this.validateRequiredParam(patientId, 'Patient ID');
    this.validateRequiredParam(appointmentId, 'Appointment ID');

    const normalizeRecords = result => {
      if (Array.isArray(result)) return result;
      if (Array.isArray(result?.data)) return result.data;
      if (Array.isArray(result?.value)) return result.value;
      return [];
    };

    const targetId = String(appointmentId);
    const matchesAppointmentId = record => {
      const candidateIds = [record?.pc_eid, record?.id, record?.eid, record?.pc_uuid, record?.uuid]
        .filter(value => value !== undefined && value !== null)
        .map(value => String(value));

      return candidateIds.includes(targetId);
    };

    const before = await this.getPatientAppointments(patientId);
    const beforeRecords = normalizeRecords(before);
    const existedBeforeDelete = beforeRecords.some(matchesAppointmentId);

    if (!existedBeforeDelete) {
      const notFoundError = new Error(`Appointment ${appointmentId} not found for patient ${patientId}`);
      notFoundError.status = 404;
      notFoundError.code = 'APPOINTMENT_NOT_FOUND';
      throw notFoundError;
    }

    const deleteResult = await this.request('DELETE', `${this.apiPrefix}/patient/${patientId}/appointment/${appointmentId}`);

    const after = await this.getPatientAppointments(patientId);
    const afterRecords = normalizeRecords(after);
    const stillExistsAfterDelete = afterRecords.some(matchesAppointmentId);

    if (stillExistsAfterDelete) {
      const verificationError = new Error(
        `Delete reported success, but appointment ${appointmentId} still exists for patient ${patientId}`
      );
      verificationError.status = 409;
      verificationError.code = 'APPOINTMENT_DELETE_NOT_VERIFIED';
      throw verificationError;
    }

    return {
      success: true,
      message: 'Appointment deleted and verified',
      patient_id: String(patientId),
      appointment_id: targetId,
      delete_response: deleteResult
    };
  },

  async getAppointmentCategories() {
    const appointmentScopes = ['user/patient.crus', 'api:oemr', 'api:fhir'];

    this.validateScopes(appointmentScopes);

    const endpoints = [
      `${this.apiPrefix}/calendar/categories`,
      `${this.apiPrefix}/list/Calendar_Categories`,
      `${this.apiPrefix}/list/calendar_categories`
    ];

    for (const endpoint of endpoints) {
      try {
        console.log(`🔍 Trying appointment categories endpoint: ${endpoint}`);
        const result = await this.request('GET', endpoint);
        if (result) {
          console.log(`✅ Found categories at: ${endpoint}`);
          return result;
        }
      } catch (error) {
        console.log(`⏭️ Endpoint ${endpoint} failed: ${error.message}`);
      }
    }

    console.warn('⚠️ Could not fetch categories from API, returning defaults');
    return {
      data: [
        { pc_catid: '1', pc_catname: 'No Show', pc_catcolor: '#dee2e6', pc_catdesc: 'Reserved to define when an event did not occur as specified.', duration: 0 },
        { pc_catid: '2', pc_catname: 'In Office', pc_catcolor: '#cce5ff', pc_catdesc: 'Reserved to define when a provider may have available appointments after.', duration: 0 },
        { pc_catid: '3', pc_catname: 'Out Of Office', pc_catcolor: '#fdb172', pc_catdesc: 'Reserved to define when a provider may not have available appointments after.', duration: 0 },
        { pc_catid: '4', pc_catname: 'Vacation', pc_catcolor: '#e9ecef', pc_catdesc: 'Reserved for use to define Scheduled Vacation Time', duration: 0 },
        { pc_catid: '5', pc_catname: 'Office Visit', pc_catcolor: '#ffecb4', pc_catdesc: 'Normal Office Visit', duration: 900 },
        { pc_catid: '6', pc_catname: 'Holidays', pc_catcolor: '#8663ba', pc_catdesc: 'Clinic holiday', duration: 86400 },
        { pc_catid: '7', pc_catname: 'Closed', pc_catcolor: '#2374ab', pc_catdesc: 'Clinic closed', duration: 86400 },
        { pc_catid: '8', pc_catname: 'Lunch', pc_catcolor: '#ffd351', pc_catdesc: 'Lunch', duration: 3600 },
        { pc_catid: '9', pc_catname: 'Established Patient', pc_catcolor: '#93d3a2', pc_catdesc: 'Established patient visit', duration: 900 },
        { pc_catid: '10', pc_catname: 'New Patient', pc_catcolor: '#a2d9e2', pc_catdesc: 'New patient visit', duration: 1800 },
        { pc_catid: '11', pc_catname: 'Reserved', pc_catcolor: '#b02a37', pc_catdesc: 'Reserved', duration: 900 },
        { pc_catid: '12', pc_catname: 'Health and Behavioral Assessment', pc_catcolor: '#ced4da', pc_catdesc: 'Health and Behavioral Assessment', duration: 900 },
        { pc_catid: '13', pc_catname: 'Preventive Care Services', pc_catcolor: '#d3c6ec', pc_catdesc: 'Preventive Care Services', duration: 900 },
        { pc_catid: '14', pc_catname: 'Ophthalmological Services', pc_catcolor: '#febe89', pc_catdesc: 'Ophthalmological Services', duration: 900 },
        { pc_catid: '15', pc_catname: 'Group Therapy', pc_catcolor: '#adb5bd', pc_catdesc: 'Group Therapy', duration: 3600 }
      ],
      source: 'fallback_defaults',
      note: 'Fallback categories sourced from openemr_postcalendar_categories table.'
    };
  },

  async getAppointmentStatuses() {
    const appointmentScopes = ['user/patient.crus', 'api:oemr', 'api:fhir'];

    this.validateScopes(appointmentScopes);

    return this.request('GET', `${this.apiPrefix}/list/apptstat`);
  },

  async getProviders() {
    const appointmentScopes = ['user/patient.crus', 'api:oemr', 'api:fhir'];

    this.validateScopes(appointmentScopes);

    return this.request('GET', `${this.apiPrefix}/practitioner`);
  },

  async getFacilities() {
    const appointmentScopes = ['user/patient.crus', 'api:oemr', 'api:fhir'];

    this.validateScopes(appointmentScopes);

    return this.request('GET', `${this.apiPrefix}/facility`);
  },

  async getAppointmentsByDateRange(startDate, endDate, providerId = null) {
    const appointmentScopes = ['user/patient.crus', 'api:oemr', 'api:fhir'];

    this.validateScopes(appointmentScopes);

    const params = {};
    if (startDate) params.pc_eventDate = `ge${startDate}`;
    if (endDate) params['pc_eventDate:end'] = `le${endDate}`;
    if (providerId) params.pc_aid = providerId;

    return this.request('GET', `${this.apiPrefix}/appointment`, null, params);
  },

  async checkProviderAvailability(providerId, date, startTime = null, duration = 30) {
    const appointmentScopes = ['user/patient.crus', 'api:oemr', 'api:fhir'];

    this.validateScopes(appointmentScopes);
    this.validateRequiredParam(providerId, 'Provider ID');
    this.validateRequiredParam(date, 'Date');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error('Date must be in YYYY-MM-DD format');
    }

    // Normalize time strings to HH:MM (strip seconds if present)
    const normalizeTime = (t) => {
      if (!t) return t;
      const parts = t.split(':');
      return `${(parts[0] || '00').padStart(2, '0')}:${(parts[1] || '00').padStart(2, '0')}`;
    };

    // Category 2 = "In Office" — defines when the provider IS available
    const IN_OFFICE_CATEGORY = '2';
    // Categories that block the provider entirely
    const BLOCKING_CATEGORIES = new Set(['1', '3', '4', '6', '7', '8']);
    // 1=No Show, 3=Out Of Office, 4=Vacation, 6=Holidays, 7=Closed, 8=Lunch

    const existingAppointments = await this.getAppointmentsByDateRange(date, date, providerId);
    const appointments = existingAppointments?.data || existingAppointments || [];

    const inOfficeWindows = [];  // When the provider IS in office (category 2)
    const bookedSlots = [];      // Actual patient appointments
    const blockedRanges = [];    // Blocking events (lunch, vacation, etc.)
    let providerUnavailableAllDay = false;
    let unavailableReason = null;

    if (Array.isArray(appointments)) {
      appointments.forEach(appointment => {
        const rawStartTime = appointment.pc_startTime || appointment.startTime;
        const appointmentStartTime = normalizeTime(rawStartTime);
        const appointmentDuration = parseInt(appointment.pc_duration || appointment.duration || 1800, 10);
        const categoryId = String(appointment.pc_catid || '');
        const categoryName = appointment.pc_catname || appointment.pc_title || '';

        if (appointmentStartTime) {
          const startMinutes = this.timeToMinutes(appointmentStartTime);
          const endMinutes = startMinutes + Math.ceil(appointmentDuration / 60);

          if (categoryId === IN_OFFICE_CATEGORY) {
            // "In Office" = provider availability window
            inOfficeWindows.push({
              startMinutes,
              endMinutes,
              startTime: appointmentStartTime,
              endTime: this.minutesToTime(endMinutes)
            });
          } else if (BLOCKING_CATEGORIES.has(categoryId)) {
            if (appointmentDuration >= 28800) {
              providerUnavailableAllDay = true;
              unavailableReason = categoryName || 'Unavailable';
            }
            blockedRanges.push({
              startMinutes,
              endMinutes,
              reason: categoryName || 'Blocked',
              startTime: appointmentStartTime,
              endTime: this.minutesToTime(endMinutes)
            });
          } else {
            // Actual patient appointment — this is a booked slot
            bookedSlots.push({
              appointmentId: appointment.id || appointment.pc_eid,
              patientId: appointment.pid || appointment.pc_pid,
              startTime: appointmentStartTime,
              endTime: this.minutesToTime(endMinutes),
              duration: appointmentDuration,
              status: appointment.pc_apptstatus,
              title: appointment.pc_title,
              categoryId,
              categoryName
            });
          }
        } else if (BLOCKING_CATEGORIES.has(categoryId)) {
          providerUnavailableAllDay = true;
          unavailableReason = categoryName || 'Unavailable';
        }
      });
    }

    // If provider has blocking all-day events, they're unavailable
    if (providerUnavailableAllDay) {
      const result = {
        providerId,
        date,
        providerAvailable: false,
        unavailableReason,
        inOfficeWindows: [],
        bookedSlots: [],
        blockedRanges: blockedRanges.map(r => ({
          startTime: r.startTime,
          endTime: r.endTime,
          reason: r.reason
        })),
        availableSlots: [],
        totalBooked: 0,
        totalAvailable: 0,
        requestedSlot: null
      };

      if (startTime) {
        result.requestedSlot = {
          startTime: normalizeTime(startTime),
          endTime: this.minutesToTime(this.timeToMinutes(normalizeTime(startTime)) + duration),
          available: false,
          conflict: { reason: unavailableReason, allDay: true }
        };
      }

      return result;
    }

    // If NO "In Office" entries exist, the provider is NOT available that day
    if (inOfficeWindows.length === 0) {
      const result = {
        providerId,
        date,
        providerAvailable: false,
        unavailableReason: 'Provider has no "In Office" schedule for this date',
        inOfficeWindows: [],
        bookedSlots,
        blockedRanges: blockedRanges.map(r => ({
          startTime: r.startTime,
          endTime: r.endTime,
          reason: r.reason
        })),
        availableSlots: [],
        totalBooked: bookedSlots.length,
        totalAvailable: 0,
        requestedSlot: null
      };

      if (startTime) {
        result.requestedSlot = {
          startTime: normalizeTime(startTime),
          endTime: this.minutesToTime(this.timeToMinutes(normalizeTime(startTime)) + duration),
          available: false,
          conflict: { reason: 'Provider is not in office on this date' }
        };
      }

      return result;
    }

    // "In Office" entries confirm the provider IS working this day.
    // Use standard working hours (08:00-17:00) for slot generation,
    // since "In Office" entries are typically short presence markers,
    // not full schedule blocks.
    const workingHoursStart = 8 * 60;   // 08:00
    const workingHoursEnd = 17 * 60;    // 17:00

    bookedSlots.sort((a, b) => a.startTime.localeCompare(b.startTime));

    const slotDuration = duration;

    // Check if a given time range overlaps any blocking event
    const isTimeBlocked = (slotStartMin, slotEndMin) => {
      return blockedRanges.some(range =>
        slotStartMin < range.endMinutes && slotEndMin > range.startMinutes
      );
    };

    // Check if a given time range overlaps any booked appointment
    const isTimeBooked = (slotStartMin, slotEndMin) => {
      return bookedSlots.some(booked => {
        const bStart = this.timeToMinutes(booked.startTime);
        const bEnd = this.timeToMinutes(booked.endTime);
        return slotStartMin < bEnd && slotEndMin > bStart;
      });
    };

    // Generate available slots within working hours
    const availableSlots = [];
    let currentTime = workingHoursStart;
    while (currentTime + slotDuration <= workingHoursEnd) {
      const slotEndMin = currentTime + slotDuration;

      if (!isTimeBooked(currentTime, slotEndMin) && !isTimeBlocked(currentTime, slotEndMin)) {
        availableSlots.push({
          startTime: this.minutesToTime(currentTime),
          endTime: this.minutesToTime(slotEndMin),
          available: true
        });
      }

      currentTime += slotDuration;
    }

    // Check requested slot if provided
    let requestedSlotAvailable = null;
    if (startTime) {
      const normalizedStartTime = normalizeTime(startTime);
      const requestedStart = this.timeToMinutes(normalizedStartTime);
      const requestedEnd = requestedStart + duration;

      const withinWorkingHours = requestedStart >= workingHoursStart && requestedEnd <= workingHoursEnd;
      const hasBookingConflict = isTimeBooked(requestedStart, requestedEnd);
      const isBlocked = isTimeBlocked(requestedStart, requestedEnd);

      const isAvailable = withinWorkingHours && !hasBookingConflict && !isBlocked;

      let conflictInfo = null;
      if (!withinWorkingHours) {
        conflictInfo = { reason: 'Requested time is outside working hours (08:00-17:00)' };
      } else if (isBlocked) {
        const blockingRange = blockedRanges.find(range =>
          requestedStart < range.endMinutes && requestedEnd > range.startMinutes
        );
        conflictInfo = {
          reason: blockingRange?.reason || 'Blocked',
          startTime: blockingRange?.startTime,
          endTime: blockingRange?.endTime
        };
      } else if (hasBookingConflict) {
        const conflicting = bookedSlots.find(booked => {
          const bStart = this.timeToMinutes(booked.startTime);
          const bEnd = this.timeToMinutes(booked.endTime);
          return requestedStart < bEnd && requestedEnd > bStart;
        });
        conflictInfo = conflicting;
      }

      requestedSlotAvailable = {
        startTime: normalizedStartTime,
        endTime: this.minutesToTime(requestedEnd),
        available: isAvailable,
        conflict: conflictInfo
      };
    }

    return {
      providerId,
      date,
      providerAvailable: true,
      inOfficeWindows: inOfficeWindows.map(w => ({
        startTime: w.startTime,
        endTime: w.endTime
      })),
      workingHours: {
        start: '08:00',
        end: '17:00'
      },
      bookedSlots,
      blockedRanges: blockedRanges.map(r => ({
        startTime: r.startTime,
        endTime: r.endTime,
        reason: r.reason
      })),
      availableSlots,
      totalBooked: bookedSlots.length,
      totalAvailable: availableSlots.length,
      requestedSlot: requestedSlotAvailable
    };
  },

  /**
   * Get nearby facilities based on postal code proximity.
   * Fetches all facilities, geocodes the input postal code and each facility's postal code,
   * then filters to those within the given radius (default 10km).
   */
  async getNearbyFacilities(postalCode, radiusKm = 10) {
    const allFacilities = await this.getFacilities();
    const facilities = Array.isArray(allFacilities?.data) ? allFacilities.data : (Array.isArray(allFacilities) ? allFacilities : []);

    if (!facilities.length) {
      return { data: [], message: 'No facilities found in the system' };
    }

    // Geocode using Nominatim (OpenStreetMap) — free, no API key needed
    const geocodePostalCode = async (code) => {
      try {
        const { default: axios } = await import('axios');
        const response = await axios.get('https://nominatim.openstreetmap.org/search', {
          params: { postalcode: code, format: 'json', limit: 1 },
          headers: { 'User-Agent': 'ScheduleAI-OpenEMR/1.0' },
          timeout: 5000
        });
        if (response.data && response.data.length > 0) {
          return {
            lat: parseFloat(response.data[0].lat),
            lon: parseFloat(response.data[0].lon)
          };
        }
        return null;
      } catch (error) {
        console.warn(`⚠️ Geocoding failed for postal code ${code}:`, error.message);
        return null;
      }
    };

    // Haversine distance formula (km)
    const haversineDistance = (lat1, lon1, lat2, lon2) => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    console.log(`📍 Geocoding patient postal code: ${postalCode}`);
    const patientCoords = await geocodePostalCode(postalCode);

    if (!patientCoords) {
      return {
        data: facilities,
        message: `Could not geocode postal code "${postalCode}". Showing all facilities instead.`,
        geocodeSuccess: false
      };
    }

    console.log(`📍 Patient location: ${patientCoords.lat}, ${patientCoords.lon}`);

    const nearbyFacilities = [];

    for (const facility of facilities) {
      const facilityPostalCode = facility.postal_code || facility.zip;
      if (!facilityPostalCode) {
        continue;
      }

      const facilityCoords = await geocodePostalCode(facilityPostalCode);
      if (!facilityCoords) {
        continue;
      }

      const distance = haversineDistance(
        patientCoords.lat, patientCoords.lon,
        facilityCoords.lat, facilityCoords.lon
      );

      if (distance <= radiusKm) {
        const roundedDist = Math.round(distance * 10) / 10;
        nearbyFacilities.push({
          ...facility,
          distance_km: roundedDist < 1 ? '< 1' : roundedDist
        });
      }
    }

    nearbyFacilities.sort((a, b) => a.distance_km - b.distance_km);

    return {
      data: nearbyFacilities,
      searchPostalCode: postalCode,
      searchRadiusKm: radiusKm,
      patientCoordinates: patientCoords,
      totalFound: nearbyFacilities.length,
      totalFacilities: facilities.length,
      geocodeSuccess: true
    };
  }
};
