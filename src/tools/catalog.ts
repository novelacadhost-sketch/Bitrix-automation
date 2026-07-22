import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BitrixClient } from '../bitrixClient.js';
import { jsonResult, clampLimit } from './shared.js';

export function registerCatalogTools(server: McpServer, bitrix: BitrixClient): void {
    server.registerTool(
        'bitrix_list_catalogs',
        {
            description:
                'List the product catalogs (infoblocks) that exist on this portal, with their numeric ' +
                'iblockId (catalog.catalog.list). Read-only. Many Bitrix24 portals have more than one catalog ' +
                '(e.g. separate price lists) - call this first to find the right iblockId before using ' +
                'bitrix_list_products.',
            inputSchema: {}
        },
        async () => {
            const result = await bitrix.call<{ catalogs?: unknown[] }>('catalog.catalog.list', {});
            return jsonResult({ catalogs: result?.catalogs ?? [] });
        }
    );

    server.registerTool(
        'bitrix_list_products',
        {
            description:
                'List products from a Bitrix24 product catalog (catalog.product.list). Read-only. Requires ' +
                'iblockId - Bitrix24 rejects this call without one on portals that have more than one catalog, ' +
                'which is common. Use bitrix_list_catalogs first if you do not already know it. Returns at most ' +
                '`limit` rows (default 50, max 200).',
            inputSchema: {
                iblockId: z.number().int().describe('The catalog/infoblock ID to list from - see bitrix_list_catalogs.'),
                filter: z.record(z.string(), z.any()).optional(),
                select: z.array(z.string()).optional(),
                limit: z.number().int().min(1).max(200).optional()
            }
        },
        async ({ iblockId, filter, select, limit }) => {
            const effectiveSelect = select ?? ['id', 'iblockId', 'name', 'code', 'price', 'currencyId', 'quantity', 'active'];
            // This portal (and apparently others) rejects the call unless "iblockId" is present in
            // *both* filter and select, regardless of what the caller asked to select - confirmed
            // empirically against a live portal, not documented behaviour we can rely on being
            // absent, so we always include it defensively.
            if (!effectiveSelect.includes('iblockId')) effectiveSelect.push('iblockId');

            const { items, total } = await bitrix.list(
                'catalog.product.list',
                { filter: { iblockId, ...(filter ?? {}) }, select: effectiveSelect },
                clampLimit(limit),
                'products'
            );
            return jsonResult({ total, returned: items.length, products: items });
        }
    );
}
