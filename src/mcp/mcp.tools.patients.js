/**
 * MCP Patient Tool Registrations
 * 
 * Registers patient-related tools on the MCP server instance:
 *   list_patients, get_patient, search_patients, create_patient, update_patient
 */

import { z } from "zod";
import {
  executeToolWithSession,
  normalizeIncomingPatientArgs,
  stripPatientIdentifierAliases,
  rememberPatientId,
  summarizePatientList,
  extractArray,
  pickIdentifier
} from "./mcp.helpers.js";

/**
 * Register all patient tools on the given MCP server.
 */
export function registerPatientTools(server) {

  // ----------------------------------------
  // List Patients
  // ----------------------------------------
  server.tool(
    "list_patients",
    "List patients from OpenEMR with filtering options",
    {
      limit: z.number().nullable().optional().describe("Maximum number of patients to return (default: 20, max: 100)"),
      offset: z.number().nullable().optional().describe("Offset for pagination (default: 0)"),
      search: z.string().nullable().optional().describe("Search term for patient name, ID, or other fields"),
      sex: z.string().nullable().optional().describe("Filter by sex"),
      active: z.boolean().nullable().optional().describe("Filter by active status (default: true)")
    },
    async (args, extra) => {
      const limit = Math.min(args.limit || 20, 100);
      const offset = args.offset || 0;
      return await executeToolWithSession("list_patients", args, async (client) => {
        const result = await client.getPatients({
          limit,
          offset,
          search: args.search,
          sex: args.sex,
          active: args.active
        });
        return summarizePatientList(result, limit, offset);
      });
    }
  );

  // ----------------------------------------
  // Get Patient
  // ----------------------------------------
  server.tool(
    "get_patient",
    "Get detailed information about a specific patient by UUID",
    {
      puuid: z.string().min(1).describe("Patient UUID (required)")
    },
    async (args, extra) => {
      const patientIdentifier = String(args?.puuid || "").trim();
      if (!patientIdentifier) {
        return {
          content: [{ type: "text", text: "Error: puuid is required" }],
          isError: true
        };
      }
      return await executeToolWithSession("get_patient", { puuid: patientIdentifier }, async (client) => {
        return await client.getPatient(patientIdentifier);
      });
    }
  );

  // ----------------------------------------
  // Search Patients
  // ----------------------------------------
  server.tool(
    "search_patients",
    "Advanced patient search with multiple filters and parameters",
    {
      fname: z.string().nullable().optional().describe("First name"),
      lname: z.string().nullable().optional().describe("Last name"),
      dob: z.string().nullable().optional().describe("Date of birth (YYYY-MM-DD)"),
      sex: z.string().nullable().optional().describe("Sex filter (male, female, other, unknown)"),
      phone: z.string().nullable().optional().describe("Phone number"),
      email: z.string().nullable().optional().describe("Email address"),
      street: z.string().nullable().optional().describe("Street address"),
      city: z.string().nullable().optional().describe("City filter"),
      state: z.string().nullable().optional().describe("State filter"),
      postal_code: z.string().nullable().optional().describe("Postal code filter"),
      country_code: z.string().nullable().optional().describe("Country code (e.g., 'USA')"),
      ss: z.string().nullable().optional().describe("Social security number"),
      limit: z.number().nullable().optional().describe("Maximum results (default: 50, max: 500)"),
      offset: z.number().nullable().optional().describe("Offset for pagination (default: 0)")
    },
    async (args, extra) => {
      const limit = Math.min(args.limit || 20, 100);
      const offset = args.offset || 0;
      return await executeToolWithSession("search_patients", args, async (client) => {
        const result = await client.searchPatients(args);
        const records = extractArray(result);

        console.log(`🔍 search_patients: ${records.length} raw records, filtering with args:`, JSON.stringify({ fname: args.fname, lname: args.lname, phone: args.phone, dob: args.dob }));

        // Client-side filtering: OpenEMR may return all patients when no match exists.
        // Filter results to only include records that actually match the search criteria.
        const filtered = records.filter(p => {
          const normalize = (s) => (s || '').toString().trim().toLowerCase();

          if (args.fname && !normalize(p.fname).includes(normalize(args.fname))) return false;
          if (args.lname && !normalize(p.lname).includes(normalize(args.lname))) return false;
          if (args.dob && normalize(p.DOB || p.dob) !== normalize(args.dob)) return false;
          if (args.phone) {
            const phoneDigits = args.phone.replace(/\D/g, '');
            const pPhone = (p.phone_cell || p.phone_contact || p.phone_home || '').replace(/\D/g, '');
            if (!pPhone || pPhone.length < 7 || !phoneDigits || phoneDigits.length < 7) return false;
            // Strict match: last 10 digits must match (handles country code differences)
            const pLast10 = pPhone.slice(-10);
            const searchLast10 = phoneDigits.slice(-10);
            if (pLast10 !== searchLast10) return false;
          }
          if (args.email && normalize(p.email) !== normalize(args.email)) return false;
          return true;
        });

        console.log(`🔍 search_patients: ${filtered.length} records after filtering`);

        // Remember patient if exactly one match
        if (filtered.length === 1) {
          const patientId = pickIdentifier(filtered[0], ["pid", "id", "uuid", "puuid"]);
          if (patientId) await rememberPatientId(patientId);
        }

        return summarizePatientList({ data: filtered }, limit, offset);
      });
    }
  );

  // ----------------------------------------
  // Create Patient
  // ----------------------------------------
  server.tool(
    "create_patient",
    "Create a new patient record in OpenEMR",
    {
      fname: z.string().describe("First name (required)"),
      lname: z.string().describe("Last name (required)"),
      title: z.string().describe("Title (required)"),
      dob: z.string().nullable().optional().describe("Date of birth in YYYY-MM-DD format (required, accepts dob or DOB)"),
      DOB: z.string().nullable().optional().describe("DOB alias in YYYY-MM-DD format"),
      sex: z.string().describe("Sex/gender (required): Male/Female/Other/Unknown"),
      mname: z.string().nullable().optional().describe("Middle name"),
      phone_home: z.string().nullable().optional().describe("Home phone number"),
      phone_cell: z.string().nullable().optional().describe("Cell phone number"),
      phone_contact: z.string().nullable().optional().describe("Primary contact phone"),
      email: z.string().nullable().optional().describe("Email address"),
      street: z.string().nullable().optional().describe("Street address"),
      city: z.string().nullable().optional().describe("City"),
      state: z.string().nullable().optional().describe("State"),
      postal_code: z.string().nullable().optional().describe("Postal/ZIP code"),
      country_code: z.string().nullable().optional().describe("Country code (e.g., 'USA')"),
      ss: z.string().nullable().optional().describe("Social security number"),
      race: z.string().nullable().optional().describe("Race"),
      ethnicity: z.string().nullable().optional().describe("Ethnicity")
    },
    async (args, extra) => {
      const normalizedArgs = normalizeIncomingPatientArgs(args);
      if (!normalizedArgs.fname || !normalizedArgs.lname || !normalizedArgs.title || !normalizedArgs.dob || !normalizedArgs.sex) {
        return {
          content: [{ type: "text", text: "Error: fname, lname, title, dob, and sex are required fields" }],
          isError: true
        };
      }
      return await executeToolWithSession("create_patient", normalizedArgs, async (client) => {
        return await client.createPatient(normalizedArgs);
      });
    }
  );

  // ----------------------------------------
  // Update Patient
  // ----------------------------------------
  server.tool(
    "update_patient",
    "Update an existing patient record",
    {
      puuid: z.string().nullable().optional().describe("Patient UUID alias"),
      fname: z.string().nullable().optional().describe("First name (required)"),
      lname: z.string().nullable().optional().describe("Last name (required)"),
      mname: z.string().nullable().optional().describe("Middle name"),
      dob: z.string().nullable().optional().describe("Date of birth in YYYY-MM-DD format (required, accepts dob or DOB)"),
      DOB: z.string().nullable().optional().describe("DOB alias in YYYY-MM-DD format"),
      sex: z.string().nullable().optional().describe("Sex/gender (required): Male/Female/Other/Unknown"),
      phone_contact: z.string().nullable().optional().describe("Primary contact phone"),
      phone_home: z.string().nullable().optional().describe("Home phone number"),
      phone_cell: z.string().nullable().optional().describe("Cell phone number"),
      email: z.string().nullable().optional().describe("Email address"),
      street: z.string().nullable().optional().describe("Street address"),
      city: z.string().nullable().optional().describe("City"),
      state: z.string().nullable().optional().describe("State"),
      postal_code: z.string().nullable().optional().describe("Postal/ZIP code"),
      country_code: z.string().nullable().optional().describe("Country code (e.g., 'USA')"),
      ss: z.string().nullable().optional().describe("Social security number"),
      race: z.string().nullable().optional().describe("Race"),
      ethnicity: z.string().nullable().optional().describe("Ethnicity")
    },
    async (args, extra) => {
      const normalizedArgs = normalizeIncomingPatientArgs(args);
      if (!normalizedArgs.patient_id) {
        return {
          content: [{ type: "text", text: "Error: patient_id is required" }],
          isError: true
        };
      }
      if (!normalizedArgs.fname || !normalizedArgs.lname || !normalizedArgs.dob || !normalizedArgs.sex) {
        return {
          content: [{ type: "text", text: "Error: fname, lname, dob, and sex are required fields for update_patient" }],
          isError: true
        };
      }
      return await executeToolWithSession("update_patient", normalizedArgs, async (client) => {
        const { patient_id, ...rawUpdateData } = normalizedArgs;
        const updateData = stripPatientIdentifierAliases(rawUpdateData);
        return await client.updatePatient(patient_id, updateData);
      });
    }
  );
}
