import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BitrixClient } from '../bitrixClient.js';
import { jsonResult, clampSinglePageLimit } from './shared.js';

export function registerTaskTools(server: McpServer, bitrix: BitrixClient): void {
    server.registerTool(
        'bitrix_list_tasks',
        {
            description:
                'List tasks (tasks.task.list). Read-only. Returns a single Bitrix24 page - at most `limit` rows ' +
                '(default 50, max 50, which is Bitrix24\'s own page size for this method).',
            inputSchema: {
                filter: z.record(z.string(), z.any()).optional().describe('e.g. {"RESPONSIBLE_ID":5,"STATUS":2}'),
                select: z.array(z.string()).optional(),
                order: z.record(z.string(), z.enum(['asc', 'desc'])).optional(),
                limit: z.number().int().min(1).max(50).optional()
            }
        },
        async ({ filter, select, order, limit }) => {
            const capped = clampSinglePageLimit(limit);
            const result = await bitrix.call<{ tasks?: unknown[] } | unknown[]>('tasks.task.list', {
                filter: filter ?? {},
                select: select ?? ['ID', 'TITLE', 'STATUS', 'RESPONSIBLE_ID', 'DEADLINE'],
                order: order ?? { ID: 'desc' },
                start: 0
            });
            const list = Array.isArray(result) ? result : (result?.tasks ?? []);
            return jsonResult({ returned: Math.min(list.length, capped), tasks: list.slice(0, capped) });
        }
    );
}
