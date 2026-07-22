import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BitrixClient } from '../bitrixClient.js';
import { jsonResult } from './shared.js';

interface DealRow {
    ID: string;
    STAGE_ID?: string;
    OPPORTUNITY?: string | number;
}

export function registerAnalyticsTools(server: McpServer, bitrix: BitrixClient): void {
    server.registerTool(
        'bitrix_deal_analytics',
        {
            description:
                'Computed sales/deal analytics: aggregates CRM deals by stage (counts and summed OPPORTUNITY ' +
                'value) and reports won/lost/open counts, optionally over a date range. Read-only. ' +
                'NOTE: this is NOT a passthrough to a Bitrix24 "BI Builder" API - Bitrix24 does not expose one. ' +
                'This tool pulls deals via crm.deal.list and aggregates them here instead.',
            inputSchema: {
                dateFrom: z.string().optional().describe('ISO date, e.g. "2026-01-01" - filters DATE_CREATE >= this'),
                dateTo: z.string().optional().describe('ISO date - filters DATE_CREATE <= this'),
                categoryId: z.number().int().optional().describe('Restrict to one CRM deal pipeline/category ID'),
                sampleSize: z
                    .number()
                    .int()
                    .min(1)
                    .max(2000)
                    .optional()
                    .describe('Max deals to pull and aggregate over (default 500, max 2000). Larger = slower, more API calls.')
            }
        },
        async ({ dateFrom, dateTo, categoryId, sampleSize }) => {
            const filter: Record<string, unknown> = {};
            if (dateFrom) filter['>=DATE_CREATE'] = dateFrom;
            if (dateTo) filter['<=DATE_CREATE'] = dateTo;
            if (categoryId !== undefined) filter.CATEGORY_ID = categoryId;

            const cap = Math.min(sampleSize ?? 500, 2000);
            const { items, total } = await bitrix.list<DealRow>(
                'crm.deal.list',
                {
                    filter,
                    select: ['ID', 'STAGE_ID', 'OPPORTUNITY', 'CATEGORY_ID', 'DATE_CREATE'],
                    order: { ID: 'DESC' }
                },
                cap
            );

            const byStage: Record<string, { count: number; sumOpportunity: number }> = {};
            let wonCount = 0;
            let lostCount = 0;
            let openCount = 0;
            let sumOpportunity = 0;

            for (const deal of items) {
                const stage = String(deal.STAGE_ID ?? 'UNKNOWN');
                const opp = Number(deal.OPPORTUNITY ?? 0) || 0;
                const bucket = (byStage[stage] ??= { count: 0, sumOpportunity: 0 });
                bucket.count++;
                bucket.sumOpportunity += opp;
                sumOpportunity += opp;
                if (stage.includes('WON')) wonCount++;
                else if (stage.includes('LOSE')) lostCount++;
                else openCount++;
            }

            return jsonResult({
                note:
                    total > items.length
                        ? `Aggregated over ${items.length} of ${total} matching deals (sampleSize cap reached) - raise sampleSize for a fuller picture.`
                        : `Aggregated over all ${items.length} matching deals.`,
                dealsAnalyzed: items.length,
                totalMatchingDeals: total,
                sumOpportunity,
                wonCount,
                lostCount,
                openCount,
                byStage
            });
        }
    );
}
