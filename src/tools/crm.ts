import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BitrixClient } from '../bitrixClient.js';
import { jsonResult, clampLimit } from './shared.js';

export function registerCrmTools(server: McpServer, bitrix: BitrixClient): void {
    server.registerTool(
        'bitrix_list_deals',
        {
            description:
                'List CRM deals (crm.deal.list). Read-only. Supports filtering, field selection and sorting. ' +
                'Returns at most `limit` rows (default 50, max 200) - use bitrix_get_fields first if you are ' +
                'unsure of a field name.',
            inputSchema: {
                filter: z.record(z.string(), z.any()).optional().describe('Bitrix24 filter object, e.g. {"STAGE_ID":"NEW", ">OPPORTUNITY":1000}'),
                select: z
                    .array(z.string())
                    .optional()
                    .describe('Fields to return. Defaults to a compact common set if omitted.'),
                order: z.record(z.string(), z.enum(['ASC', 'DESC'])).optional().describe('e.g. {"DATE_CREATE":"DESC"}'),
                limit: z.number().int().min(1).max(200).optional().describe('Max rows to return (default 50, max 200).')
            }
        },
        async ({ filter, select, order, limit }) => {
            const { items, total } = await bitrix.list(
                'crm.deal.list',
                {
                    filter: filter ?? {},
                    select: select ?? ['ID', 'TITLE', 'STAGE_ID', 'OPPORTUNITY', 'CURRENCY_ID', 'ASSIGNED_BY_ID', 'DATE_CREATE'],
                    order: order ?? { ID: 'DESC' }
                },
                clampLimit(limit)
            );
            return jsonResult({ total, returned: items.length, deals: items });
        }
    );

    server.registerTool(
        'bitrix_get_deal',
        {
            description: 'Get a single CRM deal by ID (crm.deal.get). Read-only.',
            inputSchema: { id: z.number().int().describe('Deal ID') }
        },
        async ({ id }) => jsonResult(await bitrix.call('crm.deal.get', { id }))
    );

    server.registerTool(
        'bitrix_add_deal',
        {
            description:
                'WRITE ACTION: creates a new CRM deal (crm.deal.add). This adds a real record to your live ' +
                'Bitrix24 CRM - it is not a draft or a dry run. Requires confirm:true, or the call is rejected.',
            inputSchema: {
                fields: z.record(z.string(), z.any()).describe('Deal field values, e.g. {"TITLE":"...","STAGE_ID":"NEW","OPPORTUNITY":50000}'),
                confirm: z.literal(true).describe('Must be exactly true. Confirms you intend to create a real deal in Bitrix24.')
            }
        },
        async ({ fields }) => jsonResult({ created: true, id: await bitrix.call('crm.deal.add', { fields }) })
    );

    server.registerTool(
        'bitrix_update_deal',
        {
            description:
                'WRITE ACTION: updates an existing CRM deal (crm.deal.update). This overwrites real field values ' +
                'on a live deal with no undo. Requires confirm:true, or the call is rejected.',
            inputSchema: {
                id: z.number().int().describe('Deal ID to update'),
                fields: z.record(z.string(), z.any()).describe('Only the fields you want to change, e.g. {"STAGE_ID":"WON"}'),
                confirm: z.literal(true).describe('Must be exactly true. Confirms you intend to modify a real deal in Bitrix24.')
            }
        },
        async ({ id, fields }) => jsonResult({ updated: await bitrix.call('crm.deal.update', { id, fields }), id })
    );

    server.registerTool(
        'bitrix_list_items',
        {
            description:
                'List records of a CRM Smart Process Automation (SPA) entity - a custom object type such as ' +
                '"Projects" or "Equipment" (crm.item.list). Read-only. You need the numeric entityTypeId for the ' +
                'SPA you want (Bitrix24 CRM > Settings > Smart Process Automation lists these).',
            inputSchema: {
                entityTypeId: z.number().int().describe('The numeric SPA entity type ID.'),
                filter: z.record(z.string(), z.any()).optional(),
                select: z.array(z.string()).optional(),
                order: z.record(z.string(), z.enum(['ASC', 'DESC'])).optional(),
                limit: z.number().int().min(1).max(200).optional()
            }
        },
        async ({ entityTypeId, filter, select, order, limit }) => {
            const { items, total } = await bitrix.list(
                'crm.item.list',
                {
                    entityTypeId,
                    filter: filter ?? {},
                    select: select ?? ['*'],
                    order: order ?? { id: 'DESC' }
                },
                clampLimit(limit)
            );
            return jsonResult({ total, returned: items.length, items });
        }
    );

    server.registerTool(
        'bitrix_get_fields',
        {
            description:
                'List available field names/types for CRM deals or a CRM SPA entity type (crm.deal.fields / ' +
                'crm.item.fields). Read-only. Use this before filtering/selecting fields you are unsure of the exact name for.',
            inputSchema: {
                entity: z.enum(['deal', 'item']).describe('Which entity to describe.'),
                entityTypeId: z.number().int().optional().describe('Required when entity is "item" - the SPA entity type ID.')
            }
        },
        async ({ entity, entityTypeId }) => {
            if (entity === 'item') {
                if (entityTypeId === undefined) throw new Error('entityTypeId is required when entity is "item".');
                return jsonResult(await bitrix.call('crm.item.fields', { entityTypeId }));
            }
            return jsonResult(await bitrix.call('crm.deal.fields', {}));
        }
    );
}
