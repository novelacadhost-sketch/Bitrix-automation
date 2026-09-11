import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BitrixClient } from '../bitrixClient.js';
import { jsonResult, clampLimit } from './shared.js';

// Tools for building and populating CRM Smart Process Automation (SPA)
// entities - Bitrix24's custom object types (crm.type.* / crm.item.*).
//
// A note on why these are split from crm.ts: the tools here fall into two
// very different risk tiers. crm.item.add/update write *records*, which is
// ordinary data entry. crm.type.add and crm.status.add write *schema* - they
// change the shape of the CRM itself for every user on the portal, and
// Bitrix24 offers no REST method to delete an entity type once created
// (removal is UI-only). They are marked accordingly.
//
// A note on ID formats, which are positional and easy to get subtly wrong:
// a dynamic type's stage ENTITY_ID looks like
// `DYNAMIC_<entityTypeId>_STAGE_<categoryId>` and its STATUS_ID like
// `DT<entityTypeId>_<categoryId>:<CODE>`. Rather than trusting that pattern
// blindly, create the type first, then read the stages Bitrix24
// auto-generates with bitrix_list_stages and mirror the exact format back.

export function registerSpaTools(server: McpServer, bitrix: BitrixClient): void {
    server.registerTool(
        'bitrix_list_spa_types',
        {
            description:
                'List the Smart Process Automation (SPA) entity types defined on this portal, with their numeric ' +
                'entityTypeId (crm.type.list). Read-only. Call this before any other SPA tool - every one of them ' +
                'needs an entityTypeId, and guessing it produces a misleading "Smart Process Automation was not ' +
                'found" error that reads like a permissions problem but is not.',
            inputSchema: {
                filter: z.record(z.string(), z.any()).optional(),
                order: z.record(z.string(), z.enum(['ASC', 'DESC'])).optional(),
                limit: z.number().int().min(1).max(200).optional()
            }
        },
        async ({ filter, order, limit }) => {
            const { items, total } = await bitrix.list(
                'crm.type.list',
                { filter: filter ?? {}, order: order ?? { id: 'ASC' } },
                clampLimit(limit),
                'types'
            );
            return jsonResult({ total, returned: items.length, types: items });
        }
    );

    server.registerTool(
        'bitrix_get_spa_type',
        {
            description:
                'Get one SPA entity type by entityTypeId, including which optional features are switched on - ' +
                'client binding, product rows, stages, automation (crm.type.get). Read-only. Worth checking that ' +
                'isClientEnabled / isLinkWithProductsEnabled are actually set before building anything that relies on them.',
            inputSchema: { entityTypeId: z.number().int().describe('The SPA entity type ID.') }
        },
        async ({ entityTypeId }) => jsonResult(await bitrix.call('crm.type.get', { id: entityTypeId }))
    );

    server.registerTool(
        'bitrix_add_spa_type',
        {
            description:
                'WRITE ACTION - SCHEMA CHANGE, EFFECTIVELY PERMANENT: creates a brand-new Smart Process ' +
                'Automation entity type (crm.type.add). This is not a record - it adds a new object type to the ' +
                'CRM that every user on the portal will see, and Bitrix24 exposes no REST method to delete one ' +
                'again (removal is UI-only). Switch on the features you need at creation time via isClientEnabled ' +
                '(Contact/Company binding), isLinkWithProductsEnabled (product rows), isStagesEnabled and ' +
                'isAutomationEnabled - enabling some of these later does not backfill existing records. Requires confirm:true.',
            inputSchema: {
                fields: z
                    .record(z.string(), z.any())
                    .describe(
                        'Type definition, e.g. {"title":"Legacy Installations","isClientEnabled":"Y",' +
                            '"isLinkWithProductsEnabled":"Y","isStagesEnabled":"Y","isAutomationEnabled":"Y"}. ' +
                            'The Y/N flags are strings, not booleans. entityTypeId is assigned by Bitrix24 - omit it.'
                    ),
                confirm: z
                    .literal(true)
                    .describe('Must be exactly true. Confirms you intend to create a real, non-deletable CRM entity type.')
            }
        },
        async ({ fields }) => jsonResult({ created: true, type: await bitrix.call('crm.type.add', { fields }) })
    );

    server.registerTool(
        'bitrix_list_categories',
        {
            description:
                'List the categories (pipelines/funnels) of one SPA entity type (crm.category.list). Read-only. ' +
                'Every SPA gets a default category on creation, and you need its id to address that pipeline stages.',
            inputSchema: {
                entityTypeId: z.number().int().describe('The SPA entity type ID.'),
                limit: z.number().int().min(1).max(200).optional()
            }
        },
        async ({ entityTypeId, limit }) => {
            const { items, total } = await bitrix.list(
                'crm.category.list',
                { entityTypeId },
                clampLimit(limit),
                'categories'
            );
            return jsonResult({ total, returned: items.length, categories: items });
        }
    );

    server.registerTool(
        'bitrix_list_stages',
        {
            description:
                'List the stages of a CRM pipeline (crm.status.list). Read-only. For an SPA pass entityId as ' +
                '`DYNAMIC_<entityTypeId>_STAGE_<categoryId>`. Call this on a freshly created SPA to see the exact ' +
                'STATUS_ID format Bitrix24 generated for its default stages, then mirror that format when adding ' +
                'your own - the format is positional, and a hand-built STATUS_ID that looks right can still be rejected.',
            inputSchema: {
                entityId: z
                    .string()
                    .describe('Status entity id, e.g. "DYNAMIC_1036_STAGE_5" for an SPA, or "DEAL_STAGE_30" for a deal pipeline.'),
                limit: z.number().int().min(1).max(200).optional()
            }
        },
        async ({ entityId, limit }) => {
            const { items, total } = await bitrix.list(
                'crm.status.list',
                { filter: { ENTITY_ID: entityId }, order: { SORT: 'ASC' } },
                clampLimit(limit)
            );
            return jsonResult({ total, returned: items.length, stages: items });
        }
    );

    server.registerTool(
        'bitrix_add_stage',
        {
            description:
                'WRITE ACTION - SCHEMA CHANGE: adds a stage to a CRM pipeline (crm.status.add). Affects every ' +
                'record in that pipeline, not only new ones. SEMANTICS controls what the stage means to ' +
                'Bitrix24 reporting: "S" = success, "F" = failure, omitted = still in progress. A pipeline may ' +
                'have only one success stage but any number of failure stages, so model distinct dead ends ' +
                '(unreachable / declined / not needed) as separate F stages - they become indistinguishable if ' +
                'collapsed into one. Requires confirm:true.',
            inputSchema: {
                fields: z
                    .record(z.string(), z.any())
                    .describe(
                        'Stage definition, e.g. {"ENTITY_ID":"DYNAMIC_1036_STAGE_5","STATUS_ID":"DT1036_5:CALLLATER",' +
                            '"NAME":"Call Later","SORT":30,"SEMANTICS":"F"}. Omit SEMANTICS for an in-progress stage.'
                    ),
                confirm: z.literal(true).describe('Must be exactly true. Confirms you intend to change a live pipeline.')
            }
        },
        async ({ fields }) => jsonResult({ created: true, id: await bitrix.call('crm.status.add', { fields }) })
    );

    server.registerTool(
        'bitrix_add_userfield',
        {
            description:
                'WRITE ACTION - SCHEMA CHANGE: adds a custom field to an SPA entity type (userfieldconfig.add). ' +
                'For an SPA the entityId is `CRM_<entityTypeId>`. Field names must start with UF_. Note that ' +
                'userfieldconfig can sit outside the `crm` webhook scope on some portals - if this returns an ' +
                'access error while the crm.* tools work fine, that is a missing scope on the webhook, not a bug. ' +
                'Requires confirm:true.',
            inputSchema: {
                field: z
                    .record(z.string(), z.any())
                    .describe(
                        'Field definition, e.g. {"entityId":"CRM_1036","fieldName":"UF_CRM_PURCHASE_DATE",' +
                            '"userTypeId":"date","editFormLabel":{"en":"Purchase Date"},"mandatory":"N"}. ' +
                            'For a dropdown use userTypeId "enumeration" and supply its options in "list".'
                    ),
                confirm: z.literal(true).describe('Must be exactly true. Confirms you intend to alter a live entity schema.')
            }
        },
        async ({ field }) =>
            jsonResult({ created: true, id: await bitrix.call('userfieldconfig.add', { moduleId: 'crm', field }) })
    );

    server.registerTool(
        'bitrix_add_item',
        {
            description:
                'WRITE ACTION: creates one record in an SPA entity type (crm.item.add). Ordinary data entry - it ' +
                'adds a real record to the live CRM. SPA field names are camelCase and differ from the ' +
                'SCREAMING_CASE used by deals (`title`, `stageId`, `contactId`, `assignedById`) - confirm them ' +
                'with bitrix_get_fields entity:"item" first. Requires confirm:true.',
            inputSchema: {
                entityTypeId: z.number().int().describe('The SPA entity type ID.'),
                fields: z
                    .record(z.string(), z.any())
                    .describe('Record values, e.g. {"title":"...","contactId":838,"stageId":"DT1036_5:NEW"}'),
                confirm: z.literal(true).describe('Must be exactly true. Confirms you intend to create a real record.')
            }
        },
        async ({ entityTypeId, fields }) =>
            jsonResult({ created: true, item: await bitrix.call('crm.item.add', { entityTypeId, fields }) })
    );

    server.registerTool(
        'bitrix_update_item',
        {
            description:
                'WRITE ACTION: updates one SPA record (crm.item.update). Overwrites live values with no undo. ' +
                'Pass only the fields you intend to change. Requires confirm:true.',
            inputSchema: {
                entityTypeId: z.number().int().describe('The SPA entity type ID.'),
                id: z.number().int().describe('The record ID to update.'),
                fields: z.record(z.string(), z.any()).describe('Only the fields to change, e.g. {"stageId":"DT1036_5:DONE"}'),
                confirm: z.literal(true).describe('Must be exactly true. Confirms you intend to modify a real record.')
            }
        },
        async ({ entityTypeId, id, fields }) =>
            jsonResult({ updated: true, item: await bitrix.call('crm.item.update', { entityTypeId, id, fields }) })
    );

    server.registerTool(
        'bitrix_list_item_products',
        {
            description:
                'List the product rows attached to a CRM record (crm.item.productrow.list). Read-only. Filter by ' +
                'ownerType + ownerId, where ownerType is a short symbol code - "D" for a deal, "T<entityTypeId>" ' +
                'for an SPA record. Verify the code against a record you have already attached products to in the ' +
                'UI rather than assuming: an unrecognised ownerType returns an empty list rather than an error, ' +
                'which is easy to misread as "this record has no products".',
            inputSchema: {
                ownerType: z.string().describe('Owner symbol code, e.g. "D" (deal) or "T1036" (SPA type 1036).'),
                ownerId: z.number().int().describe('The owning record ID.'),
                limit: z.number().int().min(1).max(200).optional()
            }
        },
        async ({ ownerType, ownerId, limit }) => {
            const { items, total } = await bitrix.list(
                'crm.item.productrow.list',
                { filter: { '=ownerType': ownerType, '=ownerId': ownerId } },
                clampLimit(limit),
                'productRows'
            );
            return jsonResult({ total, returned: items.length, productRows: items });
        }
    );

    server.registerTool(
        'bitrix_set_item_products',
        {
            description:
                'WRITE ACTION - REPLACES, DOES NOT APPEND: sets the product rows on a CRM record ' +
                '(crm.item.productrow.set). This overwrites the entire product list with what you pass - omitting ' +
                'an existing row deletes it. To add one product to a record that already has some, read the ' +
                'current rows with bitrix_list_item_products first and send them back along with the new one. ' +
                'Requires confirm:true.',
            inputSchema: {
                ownerType: z.string().describe('Owner symbol code, e.g. "D" (deal) or "T1036" (SPA type 1036).'),
                ownerId: z.number().int().describe('The owning record ID.'),
                productRows: z
                    .array(z.record(z.string(), z.any()))
                    .describe('The complete desired row set, e.g. [{"productId":20636,"quantity":1,"price":140000}]'),
                confirm: z
                    .literal(true)
                    .describe('Must be exactly true. Confirms you understand this replaces all existing product rows.')
            }
        },
        async ({ ownerType, ownerId, productRows }) =>
            jsonResult({ set: true, result: await bitrix.call('crm.item.productrow.set', { ownerType, ownerId, productRows }) })
    );
}
