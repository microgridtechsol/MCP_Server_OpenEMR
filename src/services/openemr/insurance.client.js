import { OpenEMRBaseClient } from './base.client.js';

export class InsuranceClient extends OpenEMRBaseClient {

  // ─── Insurance Company Methods ───

  /**
   * List all insurance companies
   */
  async getInsuranceCompanies() {
    return this.request('GET', '/api/insurance_company');
  }

  /**
   * Get a specific insurance company by ID
   * @param {string} iid - Insurance company ID
   */
  async getInsuranceCompany(iid) {
    return this.request('GET', `/api/insurance_company/${iid}`);
  }

  /**
   * Create a new insurance company
   * Required field: name
   * @param {object} data - Insurance company data
   */
  async createInsuranceCompany(data) {
    return this.request('POST', '/api/insurance_company', data);
  }

  /**
   * Update an existing insurance company
   * @param {string} iid - Insurance company ID
   * @param {object} data - Updated insurance company data
   */
  async updateInsuranceCompany(iid, data) {
    return this.request('PUT', `/api/insurance_company/${iid}`, data);
  }

  // ─── Insurance Type Methods ───

  /**
   * List all insurance types
   */
  async getInsuranceTypes() {
    return this.request('GET', '/api/insurance_type');
  }

  // ─── Patient Insurance Methods ───

  /**
   * List all insurance policies for a patient
   * @param {string} puuid - Patient UUID
   */
  async getPatientInsurances(puuid) {
    return this.request('GET', `/api/patient/${puuid}/insurance`);
  }

  /**
   * Get a specific insurance policy for a patient
   * @param {string} puuid - Patient UUID
   * @param {string} insuranceUuid - Insurance policy UUID
   */
  async getPatientInsurance(puuid, insuranceUuid) {
    return this.request('GET', `/api/patient/${puuid}/insurance/${insuranceUuid}`);
  }

  /**
   * Create a new insurance policy for a patient
   * Required fields: provider, policy_number, subscriber_fname, subscriber_lname,
   *   subscriber_relationship, subscriber_ss, subscriber_DOB, subscriber_street,
   *   subscriber_postal_code, subscriber_city, subscriber_state, subscriber_sex,
   *   accept_assignment
   * @param {string} puuid - Patient UUID
   * @param {object} data - Insurance policy data
   */
  async createPatientInsurance(puuid, data) {
    return this.request('POST', `/api/patient/${puuid}/insurance`, data);
  }

  /**
   * Update an existing insurance policy for a patient
   * @param {string} puuid - Patient UUID
   * @param {string} insuranceUuid - Insurance policy UUID
   * @param {object} data - Updated insurance policy data
   */
  async updatePatientInsurance(puuid, insuranceUuid, data) {
    return this.request('PUT', `/api/patient/${puuid}/insurance/${insuranceUuid}`, data);
  }

  /**
   * Swap insurance type for a patient
   * @param {string} puuid - Patient UUID
   * @param {string} type - Target insurance type: 'primary', 'secondary', or 'tertiary'
   * @param {string} insuranceUuid - The insurance UUID to swap
   */
  async swapPatientInsurance(puuid, type, insuranceUuid) {
    return this.request('GET', `/api/patient/${puuid}/insurance/$swap-insurance`, null, {
      params: { type, uuid: insuranceUuid }
    });
  }
}