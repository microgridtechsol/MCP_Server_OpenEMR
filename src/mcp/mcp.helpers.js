/**
 * MCP Helper / Utility Functions
 * 
 * Session management, normalization, scoring, and identifier resolution
 * helpers shared across MCP tool registrations and direct executors.
 */

import { sessionStore } from "../core/sessionStore.js";
import { internalSessionManager } from "../core/internalSessionManager.js";
import { createOpenEMRClient } from "../services/openemr.client.js";

// ========================================
// SESSION HELPERS
// ========================================

/**
 * Execute a tool callback with an authenticated OpenEMR session.
 * Obtains the active internal session, creates a client, and runs `executor`.
 */
export async function executeToolWithSession(toolName, args, executor) {
  try {
    let authSession = await internalSessionManager.getActiveSession();

    if (!authSession?.accessToken) {
      return {
        content: [{
          type: "text",
          text: "Error: No authenticated session available. Please authenticate at /oauth/direct"
        }],
        isError: true
      };
    }

    const client = await createOpenEMRClient(authSession.sessionId, sessionStore);
    const result = await executor(client);

    return {
      content: [{
        type: "text",
        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      }],
      isError: false
    };

  } catch (error) {
    console.error(`❌ Tool execution error (${toolName}):`, error.message);
    const errorDetails = error?.data ? `\nDetails: ${JSON.stringify(error.data, null, 2)}` : "";

    return {
      content: [{
        type: "text",
        text: `Error executing ${toolName}: ${error.message}${errorDetails}`
      }],
      isError: true
    };
  }
}

/**
 * Retrieve the last-used patient ID from the session store (fallback context).
 */
export async function getRememberedPatientId() {
  try {
    const activeSession = await internalSessionManager.getActiveSession();
    if (!activeSession?.sessionId) return null;

    const session = await sessionStore.get(activeSession.sessionId);
    const remembered = session?.last_patient_id || session?.lastPatientId || null;
    return remembered ? String(remembered) : null;
  } catch (error) {
    return null;
  }
}

/**
 * Persist a patient ID in the session store for future fallback lookups.
 */
export async function rememberPatientId(patientId) {
  try {
    if (patientId === undefined || patientId === null || String(patientId).trim() === '') {
      return;
    }

    const activeSession = await internalSessionManager.getActiveSession();
    if (!activeSession?.sessionId) return;

    const session = await sessionStore.get(activeSession.sessionId);
    if (!session) return;

    const normalizedPatientId = String(patientId);
    session.last_patient_id = normalizedPatientId;
    session.lastPatientId = normalizedPatientId;
    await sessionStore.set(activeSession.sessionId, session);
  } catch (error) {
    // no-op – cache failure should not block tool execution
  }
}

// ========================================
// RESPONSE SUMMARIZATION
// ========================================

/**
 * Summarize a patient list response to only essential fields,
 * preventing LLM context overflow on large result sets.
 */
export function summarizePatientList(rawResult, limit, offset) {
  const records = Array.isArray(rawResult?.data)
    ? rawResult.data
    : Array.isArray(rawResult)
      ? rawResult
      : rawResult ? [rawResult] : [];

  const summary = records.map(p => ({
    uuid: p.uuid || p.id || undefined,
    pid: p.pid || undefined,
    fname: p.fname || undefined,
    mname: p.mname || undefined,
    lname: p.lname || undefined,
    dob: p.DOB || p.dob || undefined,
    sex: p.sex || undefined,
    phone_cell: p.phone_cell || p.phone_contact || undefined,
    email: p.email || undefined,
  }));

  return {
    total_returned: summary.length,
    limit,
    offset,
    hint: summary.length === limit
      ? `There may be more results. Use offset=${offset + limit} to fetch the next page.`
      : undefined,
    patients: summary
  };
}

// ========================================
// STRING / KEY NORMALIZATION
// ========================================

export function normalizeString(value) {
  return String(value || '').trim();
}

export function normalizeKey(value) {
  return normalizeString(value).toLowerCase();
}

export function looksLikeDirectId(value) {
  const v = normalizeString(value);
  if (!v) return false;
  if (/^\d+$/.test(v)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) return true;
  return false;
}

// ========================================
// ARRAY / RECORD EXTRACTION
// ========================================

export function extractArray(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.value)) return result.value;
  if (Array.isArray(result?.entry)) {
    return result.entry.map((e) => e?.resource).filter(Boolean);
  }
  return [];
}

export function pickIdentifier(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value);
    }
  }
  return null;
}

export function scoreMatch(candidates, queryNorm) {
  if (!queryNorm) return 0;
  let score = 0;
  for (const candidate of candidates) {
    const c = normalizeKey(candidate);
    if (!c) continue;
    if (c === queryNorm) score = Math.max(score, 100);
    else if (c.includes(queryNorm)) score = Math.max(score, 70);
    else if (queryNorm.includes(c)) score = Math.max(score, 60);
  }
  return score;
}

// ========================================
// PATIENT ARG NORMALIZATION
// ========================================

export function normalizeDobValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return undefined;

  const normalizedSeparators = raw.replace(/[./]/g, '-');

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedSeparators)) {
    return normalizedSeparators;
  }

  if (/^\d{2}-\d{2}-\d{4}$/.test(normalizedSeparators)) {
    const [day, month, year] = normalizedSeparators.split('-');
    return `${year}-${month}-${day}`;
  }

  return normalizedSeparators;
}

export function normalizeIncomingPatientArgs(args = {}) {
  const normalized = { ...args };

  if (normalized.puuid !== undefined && normalized.puuid !== null && String(normalized.puuid).trim() !== '') {
    const canonicalPatientId = String(normalized.puuid).trim();
    normalized.puuid = canonicalPatientId;
    normalized.patient_id = canonicalPatientId;
  }

  if (!normalized.dob && normalized.DOB) {
    normalized.dob = normalized.DOB;
  }

  if (normalized.dob) {
    normalized.dob = normalizeDobValue(normalized.dob);
  }

  if (normalized.patient_id !== undefined && normalized.patient_id !== null) {
    normalized.patient_id = String(normalized.patient_id);
  }

  Object.keys(normalized).forEach((key) => {
    if (normalized[key] === null || normalized[key] === undefined || normalized[key] === 'null' || normalized[key] === '') {
      delete normalized[key];
    }
  });

  return normalized;
}

export function stripPatientIdentifierAliases(data = {}) {
  const cleaned = { ...data };
  delete cleaned.puuid;
  delete cleaned.pid;
  delete cleaned.uuid;
  delete cleaned.id;
  delete cleaned.patient_id;
  return cleaned;
}

// ========================================
// APPOINTMENT CATEGORY RESOLUTION
// ========================================

export function resolveCategoryIdByType(categories, type) {
  const desired = type === 'new' ? 'new patient' : 'established patient';
  const fallbackId = type === 'new' ? '10' : '9';

  const ranked = categories
    .map((category) => {
      const name = normalizeKey(category?.pc_catname || category?.name || category?.title || category?.category_name);
      if (!name) return { category, score: 0 };
      if (name === desired) return { category, score: 100 };
      if (name.includes(desired)) return { category, score: 90 };
      if (type === 'new' && name.includes('new')) return { category, score: 70 };
      if (type === 'established' && (name.includes('established') || name.includes('follow'))) return { category, score: 70 };
      return { category, score: 0 };
    })
    .sort((a, b) => b.score - a.score);

  const matched = ranked[0]?.score > 0 ? ranked[0]?.category : null;
  const matchedId = pickIdentifier(matched, ['pc_catid', 'id']);
  return matchedId || fallbackId;
}

export async function resolveAllowedCategoryForPatient(client, patientId) {
  let hasExistingAppointments = false;

  try {
    const appointmentsResult = await client.getPatientAppointments(patientId);
    const appointments = extractArray(appointmentsResult);
    hasExistingAppointments = appointments.length > 0;
  } catch (error) {
    hasExistingAppointments = false;
  }

  const categoryType = hasExistingAppointments ? 'established' : 'new';
  const fallbackId = categoryType === 'established' ? '9' : '10';

  try {
    const categoriesResult = await client.getAppointmentCategories();
    const categories = extractArray(categoriesResult);
    if (categories.length) {
      return {
        pc_catid: resolveCategoryIdByType(categories, categoryType),
        category_type: categoryType
      };
    }
  } catch (error) {
    // fallback below
  }

  return {
    pc_catid: fallbackId,
    category_type: categoryType
  };
}

// ========================================
// PATIENT ID RESOLUTION
// ========================================

/**
 * Resolve a patient_id that may be a name string into a numeric pid.
 * If the value already looks like a direct ID (numeric or UUID), returns it as-is.
 */
export async function resolvePatientId(client, patientIdInput) {
  const raw = normalizeString(patientIdInput);
  if (!raw) return null;
  if (looksLikeDirectId(raw)) return raw;

  const patientSearch = await client.getPatients({ search: raw, limit: 20, offset: 0 });
  const patients = extractArray(patientSearch);
  if (!patients.length) {
    throw new Error(`Patient not found for input: ${raw}`);
  }

  const queryNorm = normalizeKey(raw);
  const ranked = patients
    .map((patient) => {
      const fullName = `${patient?.fname || ''} ${patient?.lname || ''}`.trim();
      const identifiers = [
        fullName,
        patient?.fname,
        patient?.lname,
        patient?.pid,
        patient?.id,
        patient?.uuid
      ];
      return { patient, score: scoreMatch(identifiers, queryNorm) };
    })
    .sort((a, b) => b.score - a.score);

  const bestPatient = ranked[0]?.patient;
  const patientId = pickIdentifier(bestPatient, ["pid", "id", "uuid"]);
  if (!patientId) {
    throw new Error(`Could not resolve patient_id for input: ${raw}`);
  }
  return patientId;
}

// ========================================
// APPOINTMENT IDENTIFIER RESOLUTION
// ========================================

export async function resolveAppointmentIdentifiers(client, args) {
  const resolved = { ...args };

  const requestedPatient = normalizeString(args.patient_id);
  if (!requestedPatient) {
    throw new Error("patient_id is required");
  }

  if (!looksLikeDirectId(requestedPatient)) {
    const patientSearch = await client.getPatients({ search: requestedPatient, limit: 20, offset: 0 });
    const patients = extractArray(patientSearch);
    if (!patients.length) {
      throw new Error(`Patient not found for input: ${requestedPatient}`);
    }

    const queryNorm = normalizeKey(requestedPatient);
    const ranked = patients
      .map((patient) => {
        const fullName = `${patient?.fname || ''} ${patient?.lname || ''}`.trim();
        const identifiers = [
          fullName,
          patient?.fname,
          patient?.lname,
          patient?.pid,
          patient?.id,
          patient?.uuid
        ];
        return {
          patient,
          score: scoreMatch(identifiers, queryNorm)
        };
      })
      .sort((a, b) => b.score - a.score);

    const bestPatient = ranked[0]?.patient;
    const patientId = pickIdentifier(bestPatient, ["pid", "id", "uuid"]);
    if (!patientId) {
      throw new Error(`Could not resolve patient_id for input: ${requestedPatient}`);
    }
    resolved.patient_id = patientId;
  }

  const requestedProvider = normalizeString(args.pc_aid);
  if (requestedProvider && !looksLikeDirectId(requestedProvider)) {
    const providersResult = await client.getProviders();
    const providers = extractArray(providersResult);
    if (providers.length) {
      const queryNorm = normalizeKey(requestedProvider);
      const ranked = providers
        .map((provider) => {
          const fullName = `${provider?.fname || provider?.given_name || ''} ${provider?.lname || provider?.family_name || ''}`.trim();
          const candidates = [
            provider?.id,
            provider?.pc_aid,
            provider?.providerID,
            provider?.practitioner_id,
            provider?.uuid,
            provider?.username,
            provider?.user_name,
            provider?.name,
            fullName
          ];
          return { provider, score: scoreMatch(candidates, queryNorm) };
        })
        .sort((a, b) => b.score - a.score);

      const bestProvider = ranked[0]?.provider;
      const providerId = pickIdentifier(bestProvider, ["id", "pc_aid", "providerID", "practitioner_id", "uuid"]);
      if (providerId) {
        resolved.pc_aid = providerId;
      } else {
        throw new Error(`Could not resolve provider ID for input: ${requestedProvider}`);
      }
    }
  }

  const requestedFacility = normalizeString(args.pc_facility);
  if (requestedFacility && !looksLikeDirectId(requestedFacility)) {
    const facilitiesResult = await client.getFacilities();
    const facilities = extractArray(facilitiesResult);
    if (facilities.length) {
      const queryNorm = normalizeKey(requestedFacility);
      const ranked = facilities
        .map((facility) => {
          const candidates = [
            facility?.id,
            facility?.facility_id,
            facility?.name,
            facility?.facility,
            facility?.title
          ];
          return { facility, score: scoreMatch(candidates, queryNorm) };
        })
        .sort((a, b) => b.score - a.score);

      const bestFacility = ranked[0]?.facility;
      const facilityId = pickIdentifier(bestFacility, ["id", "facility_id"]);
      if (facilityId) {
        resolved.pc_facility = facilityId;
        if (!normalizeString(args.pc_billing_location) || normalizeKey(args.pc_billing_location) === queryNorm) {
          resolved.pc_billing_location = facilityId;
        }
      }
    }
  }

  const requestedBilling = normalizeString(args.pc_billing_location);
  if (requestedBilling && !looksLikeDirectId(requestedBilling)) {
    const facilitiesResult = await client.getFacilities();
    const facilities = extractArray(facilitiesResult);
    if (facilities.length) {
      const queryNorm = normalizeKey(requestedBilling);
      const ranked = facilities
        .map((facility) => {
          const candidates = [
            facility?.id,
            facility?.facility_id,
            facility?.name,
            facility?.facility,
            facility?.title
          ];
          return { facility, score: scoreMatch(candidates, queryNorm) };
        })
        .sort((a, b) => b.score - a.score);

      const bestFacility = ranked[0]?.facility;
      const billingId = pickIdentifier(bestFacility, ["id", "facility_id"]);
      if (billingId) {
        resolved.pc_billing_location = billingId;
      }
    }
  }

  return resolved;
}
