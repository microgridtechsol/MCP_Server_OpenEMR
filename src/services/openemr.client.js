import { OpenEMRClientBase } from './openemr/base.client.js';
import { patientClientMethods } from './openemr/patients.client.js';
import { appointmentClientMethods } from './openemr/appointments.client.js';
import { systemClientMethods } from './openemr/system.client.js';

export class OpenEMRClient extends OpenEMRClientBase {}

Object.assign(
  OpenEMRClient.prototype,
  patientClientMethods,
  appointmentClientMethods,
  systemClientMethods
);

export async function createOpenEMRClient(sessionId, sessionStore) {
  if (!sessionId) {
    throw new Error('Session ID is required');
  }

  const session = await sessionStore.get(sessionId);
  if (!session || !session.accessToken) {
    throw new Error('No authenticated session found');
  }

  return new OpenEMRClient(session.accessToken, session.tokenInfo);
}
