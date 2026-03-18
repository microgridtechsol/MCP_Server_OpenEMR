import { z } from 'zod';
import { executeToolWithSession } from './mcp.helpers.js';

export function registerInsuranceTools(server) {

  // ─── Insurance Company Tools ───

  server.tool(
    "list_insurance_companies",
    "List all insurance companies in the system",
    {},
    async (args, extra) => {
      return await executeToolWithSession("list_insurance_companies", args, async (client) => {
        const result = await client.getInsuranceCompanies();
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: false
        };
      });
    }
  );

  server.tool(
    "get_insurance_company",
    "Get details of a specific insurance company by its ID",
    {
      insurance_company_id: z.string().describe("The insurance company ID")
    },
    async (args, extra) => {
      return await executeToolWithSession("get_insurance_company", args, async (client) => {
        const result = await client.getInsuranceCompany(args.insurance_company_id);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: false
        };
      });
    }
  );

  server.tool(
    "create_insurance_company",
    "Create a new insurance company. Required: name.",
    {
      name: z.string().describe("The name of the insurance company (required)"),
      attn: z.string().optional().describe("Attention field"),
      cms_id: z.string().optional().describe("CMS ID"),
      ins_type_code: z.string().optional().describe("Insurance type code (query /api/insurance_type for valid values)"),
      x12_receiver_id: z.string().optional().describe("X12 receiver ID"),
      x12_default_partner_id: z.string().optional().describe("X12 default partner ID"),
      alt_cms_id: z.string().optional().describe("Alternate CMS ID"),
      line1: z.string().optional().describe("Address line 1"),
      line2: z.string().optional().describe("Address line 2"),
      city: z.string().optional().describe("City"),
      state: z.string().optional().describe("State"),
      zip: z.string().optional().describe("ZIP code"),
      country: z.string().optional().describe("Country")
    },
    async (args, extra) => {
      return await executeToolWithSession("create_insurance_company", args, async (client) => {
        const result = await client.createInsuranceCompany(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: false
        };
      });
    }
  );

  server.tool(
    "update_insurance_company",
    "Update an existing insurance company",
    {
      insurance_company_id: z.string().describe("The insurance company ID to update"),
      name: z.string().optional().describe("The name of the insurance company"),
      attn: z.string().optional().describe("Attention field"),
      cms_id: z.string().optional().describe("CMS ID"),
      ins_type_code: z.string().optional().describe("Insurance type code"),
      x12_receiver_id: z.string().optional().describe("X12 receiver ID"),
      x12_default_partner_id: z.string().optional().describe("X12 default partner ID"),
      alt_cms_id: z.string().optional().describe("Alternate CMS ID"),
      line1: z.string().optional().describe("Address line 1"),
      line2: z.string().optional().describe("Address line 2"),
      city: z.string().optional().describe("City"),
      state: z.string().optional().describe("State"),
      zip: z.string().optional().describe("ZIP code"),
      country: z.string().optional().describe("Country")
    },
    async (args, extra) => {
      return await executeToolWithSession("update_insurance_company", args, async (client) => {
        const { insurance_company_id, ...data } = args;
        const result = await client.updateInsuranceCompany(insurance_company_id, data);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: false
        };
      });
    }
  );

  // ─── Insurance Type Tool ───

  server.tool(
    "list_insurance_types",
    "List all available insurance types in the system",
    {},
    async (args, extra) => {
      return await executeToolWithSession("list_insurance_types", args, async (client) => {
        const result = await client.getInsuranceTypes();
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: false
        };
      });
    }
  );

  // ─── Patient Insurance Tools ───

  server.tool(
    "get_patient_insurances",
    "List all insurance policies for a specific patient",
    {
      patient_id: z.string().describe("The patient UUID (puuid)")
    },
    async (args, extra) => {
      return await executeToolWithSession("get_patient_insurances", args, async (client) => {
        const result = await client.getPatientInsurances(args.patient_id);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: false
        };
      });
    }
  );

  server.tool(
    "get_patient_insurance",
    "Get a specific insurance policy for a patient",
    {
      patient_id: z.string().describe("The patient UUID (puuid)"),
      insurance_uuid: z.string().describe("The insurance policy UUID")
    },
    async (args, extra) => {
      return await executeToolWithSession("get_patient_insurance", args, async (client) => {
        const result = await client.getPatientInsurance(args.patient_id, args.insurance_uuid);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: false
        };
      });
    }
  );

  server.tool(
    "create_patient_insurance",
    "Create a new insurance policy for a patient. Required fields: provider, policy_number, subscriber_fname, subscriber_lname, subscriber_relationship, subscriber_ss, subscriber_DOB, subscriber_street, subscriber_postal_code, subscriber_city, subscriber_state, subscriber_sex, accept_assignment.",
    {
      patient_id: z.string().describe("The patient UUID (puuid)"),
      provider: z.string().describe("The insurance company ID (required)"),
      policy_number: z.string().describe("The policy number (required, 2-255 chars)"),
      subscriber_fname: z.string().describe("Subscriber first name (required)"),
      subscriber_lname: z.string().describe("Subscriber last name (required, 2-255 chars)"),
      subscriber_relationship: z.string().describe("Subscriber relationship to patient, e.g. 'self', 'spouse', 'child', 'other' (required). Query resource=/api/list/subscriber_relationship for valid values."),
      subscriber_ss: z.string().describe("Subscriber social security number (required). If relationship is 'self', must match patient SSN. If not 'self', must NOT be patient's SSN."),
      subscriber_DOB: z.string().describe("Subscriber date of birth in YYYY-MM-DD format (required)"),
      subscriber_street: z.string().describe("Subscriber street address (required)"),
      subscriber_postal_code: z.string().describe("Subscriber postal code (required)"),
      subscriber_city: z.string().describe("Subscriber city (required)"),
      subscriber_state: z.string().describe("Subscriber state (required). Query resource=/api/list/state for valid values."),
      subscriber_sex: z.string().describe("Subscriber sex (required)"),
      accept_assignment: z.string().describe("Accept assignment, 'TRUE' or 'FALSE' (required)"),
      plan_name: z.string().optional().describe("Plan name (2-255 chars)"),
      group_number: z.string().optional().describe("Group number (2-255 chars)"),
      subscriber_mname: z.string().optional().describe("Subscriber middle name"),
      subscriber_country: z.string().optional().describe("Subscriber country"),
      subscriber_phone: z.string().optional().describe("Subscriber phone"),
      subscriber_employer: z.string().optional().describe("Subscriber employer"),
      subscriber_employer_street: z.string().optional().describe("Subscriber employer street"),
      subscriber_employer_postal_code: z.string().optional().describe("Subscriber employer postal code"),
      subscriber_employer_state: z.string().optional().describe("Subscriber employer state"),
      subscriber_employer_country: z.string().optional().describe("Subscriber employer country"),
      subscriber_employer_city: z.string().optional().describe("Subscriber employer city"),
      copay: z.string().optional().describe("Copay amount"),
      date: z.string().optional().describe("Policy effective date in YYYY-MM-DD format. Cannot be after date_end. Must be unique per insurance type per patient."),
      date_end: z.string().optional().describe("Policy end date in YYYY-MM-DD format. If null, this is the current policy for this type. Only one current policy per type allowed."),
      policy_type: z.string().optional().describe("837p policy type code"),
      type: z.string().optional().describe("Insurance category: 'primary', 'secondary', or 'tertiary'. Defaults to 'primary' if omitted.")
    },
    async (args, extra) => {
      return await executeToolWithSession("create_patient_insurance", args, async (client) => {
        const { patient_id, ...data } = args;
        const result = await client.createPatientInsurance(patient_id, data);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: false
        };
      });
    }
  );

  server.tool(
    "update_patient_insurance",
    "Update an existing insurance policy for a patient",
    {
      patient_id: z.string().describe("The patient UUID (puuid)"),
      insurance_uuid: z.string().describe("The insurance policy UUID to update"),
      provider: z.string().optional().describe("The insurance company ID"),
      policy_number: z.string().optional().describe("The policy number"),
      subscriber_fname: z.string().optional().describe("Subscriber first name"),
      subscriber_lname: z.string().optional().describe("Subscriber last name"),
      subscriber_relationship: z.string().optional().describe("Subscriber relationship"),
      subscriber_ss: z.string().optional().describe("Subscriber SSN"),
      subscriber_DOB: z.string().optional().describe("Subscriber DOB (YYYY-MM-DD)"),
      subscriber_street: z.string().optional().describe("Subscriber street"),
      subscriber_postal_code: z.string().optional().describe("Subscriber postal code"),
      subscriber_city: z.string().optional().describe("Subscriber city"),
      subscriber_state: z.string().optional().describe("Subscriber state"),
      subscriber_sex: z.string().optional().describe("Subscriber sex"),
      accept_assignment: z.string().optional().describe("Accept assignment"),
      plan_name: z.string().optional().describe("Plan name"),
      group_number: z.string().optional().describe("Group number"),
      subscriber_mname: z.string().optional().describe("Subscriber middle name"),
      subscriber_country: z.string().optional().describe("Subscriber country"),
      subscriber_phone: z.string().optional().describe("Subscriber phone"),
      subscriber_employer: z.string().optional().describe("Subscriber employer"),
      subscriber_employer_street: z.string().optional().describe("Employer street"),
      subscriber_employer_postal_code: z.string().optional().describe("Employer postal code"),
      subscriber_employer_state: z.string().optional().describe("Employer state"),
      subscriber_employer_country: z.string().optional().describe("Employer country"),
      subscriber_employer_city: z.string().optional().describe("Employer city"),
      copay: z.string().optional().describe("Copay amount"),
      date: z.string().optional().describe("Policy effective date (YYYY-MM-DD)"),
      date_end: z.string().optional().describe("Policy end date (YYYY-MM-DD)"),
      policy_type: z.string().optional().describe("837p policy type"),
      type: z.string().optional().describe("'primary', 'secondary', or 'tertiary'")
    },
    async (args, extra) => {
      return await executeToolWithSession("update_patient_insurance", args, async (client) => {
        const { patient_id, insurance_uuid, ...data } = args;
        const result = await client.updatePatientInsurance(patient_id, insurance_uuid, data);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: false
        };
      });
    }
  );

  server.tool(
    "swap_patient_insurance",
    "Swap an insurance policy to a different type (primary/secondary/tertiary) for a patient. The current policy of the target type will swap to the source type.",
    {
      patient_id: z.string().describe("The patient UUID (puuid)"),
      type: z.string().describe("Target insurance type: 'primary', 'secondary', or 'tertiary'"),
      insurance_uuid: z.string().describe("The insurance UUID to swap into the target type")
    },
    async (args, extra) => {
      return await executeToolWithSession("swap_patient_insurance", args, async (client) => {
        const result = await client.swapPatientInsurance(args.patient_id, args.type, args.insurance_uuid);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: false
        };
      });
    }
  );
}