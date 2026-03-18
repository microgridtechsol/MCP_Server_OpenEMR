/**
 * MCP Resource Definitions
 * 
 * Registers MCP resources (patients, appointments) that describe
 * available tool categories to MCP clients.
 */

/**
 * Register all MCP resources on the given server.
 */
export function registerResources(server) {

  // ----------------------------------------
  // Patients Resource
  // ----------------------------------------
  server.resource(
    "patients",
    "openemr://patients",
    {
      description: "Access patient records",
      mimeType: "application/json"
    },
    async (uri) => {
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({
            message: "Patient list resource - use list_patients or search_patients tools to get actual data",
            available_tools: ["list_patients", "get_patient", "search_patients", "create_patient", "update_patient"]
          }, null, 2)
        }]
      };
    }
  );

  // ----------------------------------------
  // Appointments Resource
  // ----------------------------------------
  server.resource(
    "appointments",
    "openemr://appointments",
    {
      description: "Access appointment schedules",
      mimeType: "application/json"
    },
    async (uri) => {
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({
            message: "Appointments resource - use appointment tools to manage appointments",
            available_tools: [
              "create_appointment",
              "get_all_appointments",
              "schedule_appointment_for_patient",
              "get_patient_appointments",
              "modify_appointment",
              "cancel_appointment",
              "get_appointment_categories",
              "get_appointment_statuses",
              "get_providers",
              "get_facilities"
            ]
          }, null, 2)
        }]
      };
    }
  );
}
