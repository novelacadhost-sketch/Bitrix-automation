import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BitrixClient } from '../bitrixClient.js';
import { jsonResult, clampLimit } from './shared.js';

// Read access to Bitrix24 Lists (infoblock) elements.
//
// Why this exists: a CRM custom field of type `iblock_element` stores an
// element ID from some infoblock, not a string. The Legacy Deals BRANCH
// field is bound to IBLOCK_ID 28 that way, so an importer that only knows
// branch *names* cannot populate it - it needs the name-to-element-ID map,
// and none of the catalog.* tools can see anything outside iblocks 14/16.

export function registerListTools(server: McpServer, bitrix: BitrixClient): void {
    server.registerTool(
        'bitrix_list_iblock_elements',
        {
            description:
                'List the elements of a Bitrix24 List / infoblock (lists.element.get). Read-only. Use this to ' +
                'resolve a CRM `iblock_element` custom field to real values: the field stores element IDs, so an ' +
                'import that has only the display names needs this mapping first. iblockTypeId is "lists" for ' +
                'ordinary Lists; a field bound to an infoblock created by another module may need a different ' +
                'type id, and passing the wrong one returns an empty result rather than an error.',
            inputSchema: {
                iblockId: z.number().int().describe('The infoblock ID, e.g. 28 for the Legacy Deals BRANCH field.'),
                iblockTypeId: z.string().optional().describe('Infoblock type. Defaults to "lists".'),
                filter: z.record(z.string(), z.any()).optional().describe('Optional Bitrix24 filter, e.g. {"NAME":"Bodija"}'),
                limit: z.number().int().min(1).max(200).optional()
            }
        },
        async ({ iblockId, iblockTypeId, filter, limit }) => {
            const { items, total } = await bitrix.list(
                'lists.element.get',
                {
                    IBLOCK_TYPE_ID: iblockTypeId ?? 'lists',
                    IBLOCK_ID: iblockId,
                    FILTER: filter ?? {}
                },
                clampLimit(limit)
            );
            return jsonResult({ total, returned: items.length, elements: items });
        }
    );
}
