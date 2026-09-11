import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BitrixClient } from '../bitrixClient.js';
import { jsonResult, clampLimit } from './shared.js';

// CRM contact tools, plus the duplicate check that any bulk import needs to
// run first.
//
// The Nigerian phone problem, which is the reason expandNigerianVariants
// exists: this portal already stores the same subscriber in more than one
// shape - staff records hold both "+2348133778812" and "08057020209" style
// numbers. Bitrix24's duplicate finder matches on the stored string, so
// "08057020209" and "+2348057020209" do NOT find each other. Importing a
// legacy customer list without reconciling those forms creates a duplicate
// Contact for every customer whose number happens to be stored in the other
// format - silently, with no error, and only visible months later once
// people are calling the same customer twice.

const NG_NATIONAL_LENGTH = 10; // e.g. 8057020209, the part after the 0 or +234

/**
 * Reduces a Nigerian number to its 10-digit national significant number,
 * or returns null if it does not look like one. Accepts +234…, 234…, 0…,
 * and bare 10-digit forms, ignoring spaces, dashes and parentheses.
 *
 * It also repairs the country-code-plus-trunk-zero malformation: this
 * portal stores numbers like "+23408033512189", which is +234 followed by
 * the full national form *including* its leading 0, giving 14 digits
 * instead of 13. Observed on real contact records (id 4886), not
 * hypothetical. Without stripping that stray zero the number reduces to
 * nothing and dedup silently falls back to exact string matching.
 */
export function toNgNationalNumber(raw: string): string | null {
    const digits = raw.replace(/[^\d+]/g, '');
    let rest: string;
    if (digits.startsWith('+234')) rest = digits.slice(4);
    else if (digits.startsWith('234')) rest = digits.slice(3);
    else if (digits.startsWith('0')) rest = digits.slice(1);
    else rest = digits.replace(/^\+/, '');
    // Country code followed by the trunk zero: "+234" + "08033512189".
    if (rest.length === NG_NATIONAL_LENGTH + 1 && rest.startsWith('0')) {
        rest = rest.slice(1);
    }
    return rest.length === NG_NATIONAL_LENGTH ? rest : null;
}

/**
 * Every stored form one Nigerian number might plausibly appear as,
 * including the two malformed country-code-plus-zero shapes. Both
 * directions matter: a correctly formatted import row has to find a
 * malformed stored contact, and a malformed import row has to find a
 * correctly stored one. Omitting the malformed probes produces a false
 * "no duplicate", which is the expensive direction to get wrong - it
 * creates a second contact for someone already in the CRM.
 */
export function ngPhoneVariants(raw: string): string[] {
    const national = toNgNationalNumber(raw);
    if (!national) return [raw];
    return [
        `+234${national}`,
        `234${national}`,
        `0${national}`,
        national,
        `+2340${national}`,
        `2340${national}`
    ];
}

export function registerContactTools(server: McpServer, bitrix: BitrixClient): void {
    server.registerTool(
        'bitrix_list_contacts',
        {
            description:
                'List CRM contacts (crm.contact.list). Read-only. Note that PHONE and EMAIL are multi-value ' +
                'fields and are only returned when you ask for them explicitly in `select`.',
            inputSchema: {
                filter: z.record(z.string(), z.any()).optional().describe('e.g. {"%NAME":"Ade"} or {"ASSIGNED_BY_ID":346}'),
                select: z.array(z.string()).optional().describe('Defaults to a compact set including PHONE and EMAIL.'),
                order: z.record(z.string(), z.enum(['ASC', 'DESC'])).optional(),
                limit: z.number().int().min(1).max(200).optional()
            }
        },
        async ({ filter, select, order, limit }) => {
            const { items, total } = await bitrix.list(
                'crm.contact.list',
                {
                    filter: filter ?? {},
                    select: select ?? ['ID', 'NAME', 'LAST_NAME', 'PHONE', 'EMAIL', 'ASSIGNED_BY_ID', 'DATE_CREATE'],
                    order: order ?? { ID: 'DESC' }
                },
                clampLimit(limit)
            );
            return jsonResult({ total, returned: items.length, contacts: items });
        }
    );

    server.registerTool(
        'bitrix_get_contact',
        {
            description: 'Get a single CRM contact by ID (crm.contact.get). Read-only.',
            inputSchema: { id: z.number().int().describe('Contact ID') }
        },
        async ({ id }) => jsonResult(await bitrix.call('crm.contact.get', { id }))
    );

    server.registerTool(
        'bitrix_find_duplicate_contacts',
        {
            description:
                'Check whether contacts already exist for given phone numbers or e-mail addresses ' +
                '(crm.duplicate.findbycomm). Read-only. ALWAYS run this before creating contacts in bulk. ' +
                'With type "PHONE" and expandNigerianVariants left on, each number is also checked in its ' +
                '+234…, 234…, 0… and bare national forms, because Bitrix24 matches the stored string and this ' +
                'portal holds the same subscriber in more than one of those shapes - an exact-match-only check ' +
                'will report "no duplicate" for a customer who is already in the CRM.',
            inputSchema: {
                type: z.enum(['PHONE', 'EMAIL']).describe('Which communication channel to match on.'),
                values: z.array(z.string()).min(1).describe('The numbers or addresses to check.'),
                expandNigerianVariants: z
                    .boolean()
                    .optional()
                    .describe('PHONE only. Default true. Also checks the other Nigerian formats of each number.')
            }
        },
        async ({ type, values, expandNigerianVariants }) => {
            const expand = type === 'PHONE' && expandNigerianVariants !== false;
            const results = [];
            for (const value of values) {
                const probes = expand ? ngPhoneVariants(value) : [value];
                const found = await bitrix.call<Record<string, number[]>>('crm.duplicate.findbycomm', {
                    type,
                    values: probes,
                    entity_type: 'CONTACT'
                });
                const ids = Array.from(new Set(found?.CONTACT ?? []));
                results.push({
                    value,
                    checkedAs: probes,
                    duplicateContactIds: ids,
                    isDuplicate: ids.length > 0
                });
            }
            const dupes = results.filter(r => r.isDuplicate).length;
            return jsonResult({ checked: results.length, withDuplicates: dupes, results });
        }
    );

    server.registerTool(
        'bitrix_add_contact',
        {
            description:
                'WRITE ACTION: creates a new CRM contact (crm.contact.add). Adds a real person to the live CRM. ' +
                'Run bitrix_find_duplicate_contacts first - Bitrix24 does not block duplicates on this endpoint ' +
                'and will happily create a second record for someone already in the CRM. PHONE and EMAIL are ' +
                'multi-value fields and take the shape [{"VALUE":"+234...","VALUE_TYPE":"WORK"}]. Requires confirm:true.',
            inputSchema: {
                fields: z
                    .record(z.string(), z.any())
                    .describe(
                        'Contact values, e.g. {"NAME":"Ade","LAST_NAME":"Bello",' +
                            '"PHONE":[{"VALUE":"+2348057020209","VALUE_TYPE":"MOBILE"}]}'
                    ),
                confirm: z.literal(true).describe('Must be exactly true. Confirms you intend to create a real contact.')
            }
        },
        async ({ fields }) => jsonResult({ created: true, id: await bitrix.call('crm.contact.add', { fields }) })
    );

    server.registerTool(
        'bitrix_update_contact',
        {
            description:
                'WRITE ACTION: updates an existing CRM contact (crm.contact.update). Overwrites live values with ' +
                'no undo. Be careful with PHONE and EMAIL: passing a new array REPLACES all existing entries for ' +
                'that field rather than adding to them, so read the contact first if you mean to append a number. ' +
                'Requires confirm:true.',
            inputSchema: {
                id: z.number().int().describe('Contact ID to update'),
                fields: z.record(z.string(), z.any()).describe('Only the fields you want to change.'),
                confirm: z.literal(true).describe('Must be exactly true. Confirms you intend to modify a real contact.')
            }
        },
        async ({ id, fields }) => jsonResult({ updated: await bitrix.call('crm.contact.update', { id, fields }), id })
    );
}
