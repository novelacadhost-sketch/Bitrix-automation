import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BitrixClient } from '../bitrixClient.js';
import { jsonResult, clampLimit } from './shared.js';

export function registerBizprocTools(server: McpServer, bitrix: BitrixClient): void {
    server.registerTool(
        'bitrix_bp_list_templates',
        {
            description: 'List Business Process (workflow) templates (bizproc.workflow.template.list). Read-only.',
            inputSchema: {
                filter: z.record(z.string(), z.any()).optional(),
                select: z.array(z.string()).optional(),
                limit: z.number().int().min(1).max(200).optional()
            }
        },
        async ({ filter, select, limit }) => {
            const { items, total } = await bitrix.list(
                'bizproc.workflow.template.list',
                { filter: filter ?? {}, select: select ?? ['ID', 'NAME', 'MODULE_ID', 'ENTITY', 'DOCUMENT_TYPE', 'ACTIVE'] },
                clampLimit(limit)
            );
            return jsonResult({ total, returned: items.length, templates: items });
        }
    );

    server.registerTool(
        'bitrix_bp_list_instances',
        {
            description:
                'List currently running/completed Business Process instances (bizproc.workflow.instances). ' +
                'Read-only. Useful to check what automations are actively running against a document.',
            inputSchema: {
                filter: z
                    .record(z.string(), z.any())
                    .optional()
                    .describe('e.g. {"MODULE_ID":"crm","ENTITY":"CCrmDocumentDeal","DOCUMENT_ID":["DEAL_123"]}'),
                limit: z.number().int().min(1).max(200).optional()
            }
        },
        async ({ filter, limit }) => {
            const { items, total } = await bitrix.list('bizproc.workflow.instances', { filter: filter ?? {} }, clampLimit(limit));
            return jsonResult({ total, returned: items.length, instances: items });
        }
    );

    server.registerTool(
        'bitrix_bp_start',
        {
            description:
                'WRITE ACTION - HIGH RISK: starts a Business Process workflow against a real document ' +
                '(bizproc.workflow.start). This immediately triggers a live automation - notifications, CRM ' +
                'field changes, task creation, whatever the template does - exactly as if it fired naturally. ' +
                'There is no dry-run and no undo. Requires confirm:true.',
            inputSchema: {
                templateId: z.number().int().describe('Workflow template ID (see bitrix_bp_list_templates)'),
                documentId: z
                    .array(z.string())
                    .describe('Bitrix24 document ID triple, e.g. ["crm","CCrmDocumentDeal","DEAL_123"]'),
                parameters: z.record(z.string(), z.any()).optional().describe('Template input parameters, if the template defines any'),
                confirm: z.literal(true).describe('Must be exactly true. Confirms you understand this starts a real, live workflow.')
            }
        },
        async ({ templateId, documentId, parameters }) =>
            jsonResult({
                started: true,
                workflowId: await bitrix.call('bizproc.workflow.start', {
                    TEMPLATE_ID: templateId,
                    DOCUMENT_ID: documentId,
                    PARAMETERS: parameters ?? {}
                })
            })
    );

    server.registerTool(
        'bitrix_bp_add_template',
        {
            description:
                'WRITE ACTION - VERY HIGH RISK: creates a brand-new Business Process template ' +
                '(bizproc.workflow.template.add). Bitrix24 templates are defined by a specific ROBOT_DATA ' +
                'structure - a malformed one can produce a broken or nonsensical workflow that silently fails ' +
                'or misbehaves once someone starts it against a real deal/task. This does not affect processes ' +
                'already running. Strongly prefer drafting new templates visually in the Bitrix24 UI, and use ' +
                'this tool only for narrow, well-understood edits. Requires confirm:true.',
            inputSchema: {
                fields: z
                    .record(z.string(), z.any())
                    .describe(
                        'Template fields, e.g. {"NAME":"...","DOCUMENT_TYPE":["crm","CCrmDocumentDeal","DEAL"],"TEMPLATE":"<ROBOT_DATA>","AUTO_EXECUTE":0}'
                    ),
                confirm: z.literal(true).describe('Must be exactly true. Confirms you understand this creates a real, live workflow template.')
            }
        },
        async ({ fields }) => jsonResult({ created: true, templateId: await bitrix.call('bizproc.workflow.template.add', fields) })
    );

    server.registerTool(
        'bitrix_bp_update_template',
        {
            description:
                'WRITE ACTION - VERY HIGH RISK: edits an existing Business Process template that may be ' +
                'actively used by live deals/tasks right now (bizproc.workflow.template.update). Editing does ' +
                'not retroactively change instances already running, but any process started after your edit ' +
                'uses the new definition immediately - a mistake here can break automations silently, with no ' +
                'undo. Read the existing template first (bitrix_bp_list_templates with TEMPLATE in `select`) ' +
                'and keep a copy before changing it. Requires confirm:true.',
            inputSchema: {
                id: z.number().int().describe('Template ID to update'),
                fields: z.record(z.string(), z.any()).describe('Only the fields you want to change'),
                confirm: z
                    .literal(true)
                    .describe('Must be exactly true. Confirms you understand this modifies a real, potentially live workflow template with no undo.')
            }
        },
        async ({ id, fields }) => jsonResult({ updated: await bitrix.call('bizproc.workflow.template.update', { id, fields }), id })
    );
}
