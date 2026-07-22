import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BitrixClient } from './bitrixClient.js';
import { registerCrmTools } from './tools/crm.js';
import { registerCatalogTools } from './tools/catalog.js';
import { registerTaskTools } from './tools/tasks.js';
import { registerAnalyticsTools } from './tools/analytics.js';
import { registerBizprocTools } from './tools/bizproc.js';
import { registerEmployeeTools } from './tools/employees.js';

// Builds a fresh McpServer with every Bitrix24 tool registered. Called once
// per incoming request (see index.ts) since this server runs in stateless
// Streamable HTTP mode - there is no session to keep a server instance
// alive between requests.
export function buildMcpServer(bitrix: BitrixClient): McpServer {
    const server = new McpServer({
        name: 'novelsolar-bitrix24-mcp',
        version: '1.0.0'
    });

    registerCrmTools(server, bitrix);
    registerCatalogTools(server, bitrix);
    registerTaskTools(server, bitrix);
    registerAnalyticsTools(server, bitrix);
    registerBizprocTools(server, bitrix);
    registerEmployeeTools(server, bitrix);

    return server;
}
