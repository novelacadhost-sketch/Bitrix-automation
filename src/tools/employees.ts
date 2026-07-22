import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BitrixClient } from '../bitrixClient.js';
import { jsonResult, clampSinglePageLimit } from './shared.js';

export function registerEmployeeTools(server: McpServer, bitrix: BitrixClient): void {
    server.registerTool(
        'bitrix_list_employees',
        {
            description:
                'List company employees/users (user.get). Read-only. Returns a single Bitrix24 page - at most ' +
                '`limit` rows (default 50, max 50). ' +
                'NOTE: native "Absence Chart" / vacation data has no public Bitrix24 REST API and is not exposed here.',
            inputSchema: {
                filter: z.record(z.string(), z.any()).optional().describe('e.g. {"ACTIVE":true,"UF_DEPARTMENT":5}'),
                limit: z.number().int().min(1).max(50).optional()
            }
        },
        async ({ filter, limit }) => {
            const capped = clampSinglePageLimit(limit);
            const list = (await bitrix.call<unknown[]>('user.get', { filter: filter ?? {}, start: 0 })) ?? [];
            return jsonResult({ returned: Math.min(list.length, capped), employees: list.slice(0, capped) });
        }
    );

    server.registerTool(
        'bitrix_list_departments',
        {
            description:
                'List company departments/org structure (department.get). Read-only. Returns a single Bitrix24 ' +
                'page - at most `limit` rows (default 50, max 50).',
            inputSchema: {
                filter: z.record(z.string(), z.any()).optional(),
                limit: z.number().int().min(1).max(50).optional()
            }
        },
        async ({ filter, limit }) => {
            const capped = clampSinglePageLimit(limit);
            const list = (await bitrix.call<unknown[]>('department.get', { filter: filter ?? {}, start: 0 })) ?? [];
            return jsonResult({ returned: Math.min(list.length, capped), departments: list.slice(0, capped) });
        }
    );
}
