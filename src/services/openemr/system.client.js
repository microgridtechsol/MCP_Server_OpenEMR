export const systemClientMethods = {
  async testConnection() {
    try {
      const response = await this.request('GET', `${this.apiPrefix}/metadata`);
      return {
        success: true,
        data: response,
        message: 'OpenEMR connection successful'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'OpenEMR connection failed'
      };
    }
  },

  async getCapabilities() {
    try {
      const metadata = await this.request('GET', `${this.apiPrefix}/metadata`);

      const resources = metadata.rest?.[0]?.resource || [];
      const availableResources = resources.map(resource => ({
        type: resource.type,
        interactions: resource.interaction?.map(interaction => interaction.code) || []
      }));

      return {
        success: true,
        fhirVersion: metadata.fhirVersion,
        availableResources,
        totalResources: availableResources.length
      };
    } catch (error) {
      console.warn('⚠️ Could not fetch capabilities:', error.message);
      return {
        success: false,
        error: error.message,
        availableResources: []
      };
    }
  },

  async batchRequest(requests) {
    const batchScopes = ['api:fhir', 'api:oemr'];

    this.validateScopes(batchScopes);

    if (!Array.isArray(requests) || requests.length === 0) {
      throw new Error('Batch requests array is required');
    }

    if (requests.length > 100) {
      throw new Error('Batch request limit exceeded (max 100 requests)');
    }

    const batch = {
      resourceType: 'Bundle',
      type: 'batch',
      entry: requests.map(request => ({
        request: {
          method: request.method || 'GET',
          url: request.url
        },
        resource: request.resource || null
      }))
    };

    return this.request('POST', `${this.apiPrefix}`, batch);
  }
};
