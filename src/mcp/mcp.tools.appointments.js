/**
 * MCP Appointment Tool Registrations
 * 
 * Registers appointment-related tools on the MCP server instance:
 *   create_appointment, get_patient_appointments, cancel_appointment,
 *   get_appointment_categories, get_appointment_statuses, get_providers,
 *   get_facilities, get_provider_availability, get_appointments_by_date,
 *   get_all_appointments, schedule_appointment_for_patient
 */

import { z } from "zod";
import {
  executeToolWithSession,
  normalizeIncomingPatientArgs,
  rememberPatientId,
  getRememberedPatientId,
  resolveAppointmentIdentifiers,
  resolveAllowedCategoryForPatient,
  resolvePatientId,
  extractArray,
  pickIdentifier
} from "./mcp.helpers.js";

/**
 * Register all appointment tools on the given MCP server.
 */
export function registerAppointmentTools(server) {

  // ----------------------------------------
  // Create Appointment
  // ----------------------------------------
  server.tool(
    "create_appointment",
    "Create a new appointment for a patient in OpenEMR. Accepts patient/provider/facility IDs and can also resolve common name inputs to IDs. Category is automatically enforced to Established Patient or New Patient based on patient appointment history. IMPORTANT: If a provider (pc_aid) is specified, this tool automatically checks provider availability and will reject the appointment if there is a scheduling conflict. Use get_provider_availability first to find open slots.",
    {
      patient_id: z.string().describe("Patient ID (required)"),
      pc_catid: z.string().describe("Appointment category ID (required)"),
      pc_title: z.string().describe("Appointment title (required)"),
      pc_duration: z.string().describe("Duration in seconds (required)"),
      pc_hometext: z.string().describe("Notes/comments (required)"),
      pc_apptstatus: z.string().describe("Status (required)"),
      pc_eventDate: z.string().describe("Date YYYY-MM-DD (required)"),
      pc_startTime: z.string().describe("Start time HH:MM (required)"),
      pc_facility: z.string().describe("Facility ID (required)"),
      pc_billing_location: z.string().describe("Billing location ID (required)"),
      pc_aid: z.string().nullable().optional().describe("Provider ID (optional but recommended - availability will be checked)"),
      skip_availability_check: z.boolean().nullable().optional().describe("Skip provider availability check (default: false)")
    },
    async (args, extra) => {
      console.log("CREATE_APPOINTMENT ARGS:", JSON.stringify(args, null, 2));

      return await executeToolWithSession("create_appointment", args, async (client) => {
        const { patient_id, skip_availability_check, ...appointmentDataRaw } = args;
        const resolvedIdentifiers = await resolveAppointmentIdentifiers(client, {
          patient_id,
          ...appointmentDataRaw
        });

        const { patient_id: resolvedPatientId, ...appointmentData } = resolvedIdentifiers;
        const categorySelection = await resolveAllowedCategoryForPatient(client, resolvedPatientId);
        appointmentData.pc_catid = categorySelection.pc_catid;

        // Check provider availability if provider is specified and check is not skipped
        if (appointmentData.pc_aid && !skip_availability_check) {
          console.log("🔍 Checking provider availability before creating appointment...");

          const durationMinutes = Math.ceil(parseInt(appointmentData.pc_duration || 1800) / 60);

          try {
            const availability = await client.checkProviderAvailability(
              appointmentData.pc_aid,
              appointmentData.pc_eventDate,
              appointmentData.pc_startTime,
              durationMinutes
            );

            if (availability.requestedSlot && !availability.requestedSlot.available) {
              const conflict = availability.requestedSlot.conflict;
              const conflictInfo = conflict
                ? `Conflicting appointment: ${conflict.title || 'Appointment'} at ${conflict.startTime}-${conflict.endTime}`
                : 'Time slot is not available';

              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    error: "PROVIDER_NOT_AVAILABLE",
                    message: `Provider is not available at the requested time. ${conflictInfo}`,
                    requestedSlot: {
                      date: appointmentData.pc_eventDate,
                      startTime: appointmentData.pc_startTime,
                      duration: `${durationMinutes} minutes`
                    },
                    suggestion: "Please use get_provider_availability tool to find available time slots.",
                    availableSlots: availability.availableSlots.slice(0, 5),
                    totalAvailableSlots: availability.totalAvailable
                  }, null, 2)
                }],
                isError: true
              };
            }

            console.log("✅ Provider is available at requested time");
          } catch (availError) {
            console.warn("⚠️ Could not verify provider availability:", availError.message);
          }
        }

        await rememberPatientId(resolvedPatientId);
        return await client.createAppointment(resolvedPatientId, appointmentData);
      });
    }
  );

  // ----------------------------------------
  // Get Patient Appointments
  // ----------------------------------------
  server.tool(
    "get_patient_appointments",
    "Get all appointments for a specific patient",
    {
      patient_id: z.string().nullable().optional().describe("Patient ID (required)")
    },
    async (args, extra) => {
      const normalizedArgs = normalizeIncomingPatientArgs(args);
      let patientId = normalizedArgs.patient_id;
      if (!patientId) {
        patientId = await getRememberedPatientId();
      }

      if (!patientId) {
        return {
          content: [{ type: "text", text: "Error: patient_id is required (Langflow sent empty arguments and no session fallback patient_id was found)" }],
          isError: true
        };
      }

      return await executeToolWithSession("get_patient_appointments", normalizedArgs, async (client) => {
        const resolvedId = await resolvePatientId(client, patientId);
        await rememberPatientId(resolvedId);
        return await client.getPatientAppointments(String(resolvedId));
      });
    }
  );

  // ----------------------------------------
  // Cancel Appointment
  // ----------------------------------------
  server.tool(
    "cancel_appointment",
    "Cancel (delete) an appointment for a specific patient",
    {
      patient_id: z.string().describe("Patient ID (pid) - required"),
      appointment_id: z.string().describe("Appointment event ID (eid) - required")
    },
    async (args, extra) => {
      if (!args.patient_id || !args.appointment_id) {
        return {
          content: [{ type: "text", text: "Error: patient_id and appointment_id are required" }],
          isError: true
        };
      }

      return await executeToolWithSession("cancel_appointment", args, async (client) => {
        const resolvedId = await resolvePatientId(client, args.patient_id);
        await rememberPatientId(resolvedId);
        return await client.cancelAppointment(resolvedId, args.appointment_id);
      });
    }
  );

  // ----------------------------------------
  // Get Appointment Categories
  // ----------------------------------------
  server.tool(
    "get_appointment_categories",
    "Get available appointment categories/types (returns pc_catid values for creating appointments). Categories include Office Visit, Established Patient, New Patient, etc.",
    {},
    async (args, extra) => {
      return await executeToolWithSession("get_appointment_categories", args, async (client) => {
        return await client.getAppointmentCategories();
      });
    }
  );

  // ----------------------------------------
  // Get Appointment Statuses
  // ----------------------------------------
  server.tool(
    "get_appointment_statuses",
    "Get available appointment status options (returns pc_apptstatus values). Common statuses include: '-' (scheduled), '@' (arrived), '~' (arrived late), etc.",
    {},
    async (args, extra) => {
      return await executeToolWithSession("get_appointment_statuses", args, async (client) => {
        return await client.getAppointmentStatuses();
      });
    }
  );

  // ----------------------------------------
  // Get Providers
  // ----------------------------------------
  server.tool(
    "get_providers",
    "Get list of providers/practitioners (returns pc_aid values for assigning appointments). Use this to find provider IDs when creating appointments.",
    {},
    async (args, extra) => {
      return await executeToolWithSession("get_providers", args, async (client) => {
        return await client.getProviders();
      });
    }
  );

  // ----------------------------------------
  // Get Facilities
  // ----------------------------------------
  server.tool(
    "get_facilities",
    "Get list of facilities (returns pc_facility and pc_billing_location values). Use this to find facility IDs when creating appointments.",
    {},
    async (args, extra) => {
      return await executeToolWithSession("get_facilities", args, async (client) => {
        return await client.getFacilities();
      });
    }
  );

  // ----------------------------------------
  // Get Nearby Facilities
  // ----------------------------------------
  server.tool(
    "get_nearby_facilities",
    "Search for facilities near a postal code within a given radius (default 10km). Uses geocoding to calculate distances. If the patient has a postal code on file, it can be used directly.",
    {
      postal_code: z.string().describe("Postal/ZIP code to search near (required)"),
      radius_km: z.number().nullable().optional().describe("Search radius in kilometers (default: 10)")
    },
    async (args, extra) => {
      if (!args.postal_code) {
        return {
          content: [{ type: "text", text: "Error: postal_code is required" }],
          isError: true
        };
      }

      return await executeToolWithSession("get_nearby_facilities", args, async (client) => {
        return await client.getNearbyFacilities(args.postal_code, args.radius_km || 10);
      });
    }
  );

  // ----------------------------------------
  // Get Provider Availability
  // ----------------------------------------
  server.tool(
    "get_provider_availability",
    "Check a provider's availability for a specific date. Returns booked appointments and available time slots. IMPORTANT: Always call this BEFORE creating an appointment to check for conflicts.",
    {
      provider_id: z.string().describe("Provider ID (pc_aid) - required. Use get_providers to find IDs."),
      date: z.string().describe("Date to check (YYYY-MM-DD format) - required"),
      start_time: z.string().nullable().optional().describe("Specific start time to check (HH:MM format) - optional"),
      duration: z.number().nullable().optional().describe("Appointment duration in minutes (default: 30)")
    },
    async (args, extra) => {
      if (!args.provider_id) {
        return {
          content: [{ type: "text", text: "Error: provider_id is required. Use get_providers tool to find provider IDs." }],
          isError: true
        };
      }
      if (!args.date) {
        return {
          content: [{ type: "text", text: "Error: date is required (YYYY-MM-DD format)" }],
          isError: true
        };
      }
      return await executeToolWithSession("get_provider_availability", args, async (client) => {
        return await client.checkProviderAvailability(
          args.provider_id,
          args.date,
          args.start_time || null,
          args.duration || 30
        );
      });
    }
  );

  // ----------------------------------------
  // Get Appointments by Date Range
  // ----------------------------------------
  server.tool(
    "get_appointments_by_date",
    "Get all appointments for a date range, optionally filtered by provider. Useful for checking scheduling conflicts.",
    {
      start_date: z.string().describe("Start date (YYYY-MM-DD) - required"),
      end_date: z.string().describe("End date (YYYY-MM-DD) - required"),
      provider_id: z.string().nullable().optional().describe("Filter by provider ID (pc_aid) - optional")
    },
    async (args, extra) => {
      if (!args.start_date || !args.end_date) {
        return {
          content: [{ type: "text", text: "Error: start_date and end_date are required (YYYY-MM-DD format)" }],
          isError: true
        };
      }
      return await executeToolWithSession("get_appointments_by_date", args, async (client) => {
        return await client.getAppointmentsByDateRange(
          args.start_date,
          args.end_date,
          args.provider_id || null
        );
      });
    }
  );

  // ----------------------------------------
  // Get All Appointments
  // ----------------------------------------
  server.tool(
    "get_all_appointments",
    "Get all appointments with optional pagination and filters for date range, provider, or patient.",
    {
      limit: z.number().nullable().optional().describe("Maximum results (default: 100, max: 1000)"),
      offset: z.number().nullable().optional().describe("Offset for pagination (default: 0)"),
      start_date: z.string().nullable().optional().describe("Start date filter (YYYY-MM-DD)"),
      end_date: z.string().nullable().optional().describe("End date filter (YYYY-MM-DD)"),
      provider_id: z.string().nullable().optional().describe("Filter by provider ID (pc_aid)"),
      patient_id: z.string().nullable().optional().describe("Filter by patient ID (pid)")
    },
    async (args, extra) => {
      return await executeToolWithSession("get_all_appointments", args, async (client) => {
        const resolvedArgs = { ...args };
        if (resolvedArgs.patient_id) {
          resolvedArgs.patient_id = await resolvePatientId(client, resolvedArgs.patient_id);
          await rememberPatientId(resolvedArgs.patient_id);
        }
        return await client.getAllAppointments(resolvedArgs);
      });
    }
  );

  // ----------------------------------------
  // Schedule Appointment for Patient (one-shot)
  // ----------------------------------------
  server.tool(
    "schedule_appointment_for_patient",
    "Schedule an appointment by patient name/date/time/duration. Automatically finds patient, picks first available provider, and creates appointment.",
    {
      patient_name: z.string().describe("Patient full name, e.g. 'S Dharan' (required)"),
      date: z.string().describe("Appointment date YYYY-MM-DD (required)"),
      start_time: z.string().describe("Appointment start time HH:MM (required)"),
      duration_minutes: z.number().nullable().optional().describe("Duration in minutes (default: 60)"),
      title: z.string().nullable().optional().describe("Appointment title (default: 'Office Visit')"),
      notes: z.string().nullable().optional().describe("Appointment notes/comments")
    },
    async (args, extra) => {
      if (!args.patient_name || !args.date || !args.start_time) {
        return {
          content: [{ type: "text", text: "Error: patient_name, date, and start_time are required" }],
          isError: true
        };
      }

      return await executeToolWithSession("schedule_appointment_for_patient", args, async (client) => {
        const durationMinutes = Number(args.duration_minutes || 60);
        const durationSeconds = String(durationMinutes * 60);
        const title = args.title || "Office Visit";
        const notes = args.notes || `Scheduled via MCP for ${args.patient_name}`;

        const patientSearch = await client.getPatients({ search: args.patient_name, limit: 10, offset: 0 });
        const patientList = patientSearch?.data || patientSearch?.value || patientSearch || [];
        if (!Array.isArray(patientList) || patientList.length === 0) {
          throw new Error(`No patient found for name: ${args.patient_name}`);
        }

        const normalizedName = args.patient_name.toLowerCase().trim();
        const exactMatch = patientList.find((p) => `${p.fname || ''} ${p.lname || ''}`.toLowerCase().trim() === normalizedName);
        const patient = exactMatch || patientList[0];
        const patientId = String(patient.id || patient.pid || patient.uuid);

        const providersResult = await client.getProviders();
        let providers = providersResult?.data || providersResult?.value || providersResult || [];
        if (!Array.isArray(providers)) {
          providers = providers?.entry?.map((e) => e.resource).filter(Boolean) || [];
        }

        if (!providers.length) {
          throw new Error("No providers found to schedule appointment");
        }

        let selectedProviderId = null;
        for (const provider of providers) {
          const providerId = String(provider.id || provider.pc_aid || provider.providerID || provider.practitioner_id || '');
          if (!providerId) continue;

          try {
            const availability = await client.checkProviderAvailability(
              providerId,
              args.date,
              args.start_time,
              durationMinutes
            );

            if (availability?.requestedSlot?.available) {
              selectedProviderId = providerId;
              break;
            }
          } catch (error) {
            // Continue trying next provider
          }
        }

        if (!selectedProviderId) {
          throw new Error("No available provider found for requested date/time");
        }

        const categorySelection = await resolveAllowedCategoryForPatient(client, patientId);
        const categoryId = categorySelection.pc_catid;

        const facilitiesResult = await client.getFacilities();
        const facilities = facilitiesResult?.data || facilitiesResult?.value || facilitiesResult || [];
        const selectedFacility = Array.isArray(facilities) && facilities.length ? facilities[0] : null;
        const facilityId = String(selectedFacility?.id || selectedFacility?.facility_id || '3');

        const createPayload = {
          pc_catid: categoryId,
          pc_title: title,
          pc_duration: durationSeconds,
          pc_hometext: notes,
          pc_apptstatus: '-',
          pc_eventDate: args.date,
          pc_startTime: args.start_time,
          pc_facility: facilityId,
          pc_billing_location: facilityId,
          pc_aid: selectedProviderId
        };

        const created = await client.createAppointment(patientId, createPayload);

        return {
          success: true,
          message: "Appointment scheduled successfully",
          patient: {
            id: patientId,
            name: `${patient.fname || ''} ${patient.lname || ''}`.trim()
          },
          providerId: selectedProviderId,
          appointment: created
        };
      });
    }
  );
}
