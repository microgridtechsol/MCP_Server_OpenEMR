/**
 * OpenEMR MCP Server – Orchestrator
 * 
 * Creates the MCP server instance and wires together:
 *   - Patient tools        (mcp.tools.patients.js)
 *   - Appointment tools    (mcp.tools.appointments.js)
 *   - Resource definitions (mcp.resources.js)
 *   - Helper utilities     (mcp.helpers.js)
 *
 * All clients (including Langflow) connect via Streamable HTTP transport.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPatientTools } from "./mcp.tools.patients.js";
import { registerAppointmentTools } from "./mcp.tools.appointments.js";
import { registerResources } from "./mcp.resources.js";
import { registerInsuranceTools } from './mcp.tools.insurance.js';
/**
 * Create and configure a new MCP server with all tools and resources.
 */
export function createMCPServer() {
  const server = new McpServer({
    name: "openemr-mcp-server",
    version: "1.0.0",
    capabilities: {
      tools: {},
      resources: {},
      logging: {}
    }
  });

  // Register tool groups
  registerPatientTools(server);
  registerAppointmentTools(server);
  registerInsuranceTools(server);   // ← Add this line

  // Register resources
  registerResources(server);

  return server;
}

// Singleton server instance
export const mcpServer = createMCPServer();
