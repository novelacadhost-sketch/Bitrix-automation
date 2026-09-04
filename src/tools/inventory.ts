import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BitrixClient } from '../bitrixClient.js';
import { jsonResult, clampLimit } from './shared.js';

interface DocumentElementRow {
    id: number | string;
    docId: number | string;
    elementId: number | string;
    amount?: string | number | null;
    purchasingPrice?: string | number | null;
    storeFrom?: number | string | null;
    storeTo?: number | string | null;
}

interface DocumentRow {
    id: number | string;
    docType?: string;
    title?: string;
    dateCreate?: string | null;
    dateModify?: string | null;
    dateStatus?: string | null;
    responsibleId?: number | string;
    status?: string;
}

interface SaleItemRow {
    id: number | string;
    orderId: number | string;
    productId: number | string;
    quantity?: string | number;
    price?: string | number;
    dateInsert?: string | null;
}

interface SaleOrderRow {
    id: number | string;
    accountNumber?: string;
    dateInsert?: string | null;
    canceled?: string;
    deducted?: string;
    statusId?: string;
}

interface ShipmentRow {
    id: number | string;
    orderId: number | string;
    accountNumber?: string;
    dateDeducted?: string | null;
    deducted?: string;
    empDeductedId?: number | string;
    canceled?: string;
}

export function registerInventoryTools(server: McpServer, bitrix: BitrixClient): void {
    server.registerTool(
        'bitrix_list_inventory_documents',
        {
            description:
                'List inventory documents (catalog.document.list) - the records behind receipts, branch-to-branch ' +
                'transfers, and corrections (docType: A=arrival, M=moving/transfer, D/C=deduction/correction). ' +
                'Read-only. Does NOT include sales - those live in sale.order/sale.basketitem, see ' +
                'bitrix_list_sale_orders. Returns at most `limit` rows (default 50, max 200).',
            inputSchema: {
                filter: z.record(z.string(), z.any()).optional().describe('e.g. {"id":[160,918]} or {"docType":"M"}'),
                select: z.array(z.string()).optional(),
                limit: z.number().int().min(1).max(200).optional()
            }
        },
        async ({ filter, select, limit }) => {
            const { items, total } = await bitrix.list(
                'catalog.document.list',
                {
                    filter: filter ?? {},
                    select: select ?? ['id', 'docType', 'title', 'status', 'dateCreate', 'dateModify', 'dateStatus', 'responsibleId', 'currency']
                },
                clampLimit(limit),
                'documents'
            );
            return jsonResult({ total, returned: items.length, documents: items });
        }
    );

    server.registerTool(
        'bitrix_list_inventory_movements',
        {
            description:
                'List individual product movement line items within inventory documents ' +
                '(catalog.document.element.list) - each row is one product moving into a store (storeFrom is ' +
                'null), out of a store (storeTo is null), or between two stores (both set). Read-only. Pair ' +
                'with bitrix_list_inventory_documents (matching on docId) to get the date/type/title. Returns at ' +
                'most `limit` rows (default 50, max 200).',
            inputSchema: {
                filter: z
                    .record(z.string(), z.any())
                    .optional()
                    .describe('e.g. {"elementId":19988} (elementId = productId) or {"docId":160}'),
                select: z.array(z.string()).optional(),
                limit: z.number().int().min(1).max(200).optional()
            }
        },
        async ({ filter, select, limit }) => {
            const { items, total } = await bitrix.list(
                'catalog.document.element.list',
                { filter: filter ?? {}, select: select ?? ['id', 'docId', 'elementId', 'amount', 'purchasingPrice', 'storeFrom', 'storeTo'] },
                clampLimit(limit),
                'documentElements'
            );
            return jsonResult({ total, returned: items.length, movements: items });
        }
    );

    server.registerTool(
        'bitrix_list_sale_orders',
        {
            description:
                'List sale orders (sale.order.list) - the e-commerce/POS order module, separate from CRM deals ' +
                'and from inventory documents. Read-only. `deducted:"Y"` means stock was actually removed for ' +
                'this order. Returns at most `limit` rows (default 50, max 200).',
            inputSchema: {
                filter: z.record(z.string(), z.any()).optional().describe('e.g. {"id":5408} or {"accountNumber":"5408"}'),
                select: z.array(z.string()).optional(),
                limit: z.number().int().min(1).max(200).optional()
            }
        },
        async ({ filter, select, limit }) => {
            const { items, total } = await bitrix.list(
                'sale.order.list',
                {
                    filter: filter ?? {},
                    select: select ?? ['id', 'accountNumber', 'price', 'currency', 'dateInsert', 'statusId', 'deducted', 'canceled', 'responsibleId']
                },
                clampLimit(limit),
                'orders'
            );
            return jsonResult({ total, returned: items.length, orders: items });
        }
    );

    server.registerTool(
        'bitrix_list_sale_items',
        {
            description:
                'List line items (products) within sale orders (sale.basketitem.list). Read-only. Filter by ' +
                'orderId to see everything in one order, or by productId to see every sale of one product ' +
                'portal-wide. NOTE: these rows do not carry a store/branch field - Bitrix24 does not expose ' +
                'which branch fulfilled a sale via this API, only which employee deducted it (see ' +
                'bitrix_list_sale_orders / the shipment\'s empDeductedId, not exposed as its own tool here). ' +
                'Returns at most `limit` rows (default 50, max 200).',
            inputSchema: {
                filter: z.record(z.string(), z.any()).optional().describe('e.g. {"orderId":5408} or {"productId":19988}'),
                select: z.array(z.string()).optional(),
                limit: z.number().int().min(1).max(200).optional()
            }
        },
        async ({ filter, select, limit }) => {
            const { items, total } = await bitrix.list(
                'sale.basketitem.list',
                { filter: filter ?? {}, select: select ?? ['id', 'orderId', 'productId', 'quantity', 'price', 'name', 'dateInsert'] },
                clampLimit(limit),
                'basketItems'
            );
            return jsonResult({ total, returned: items.length, items });
        }
    );

    server.registerTool(
        'bitrix_trace_product_movement',
        {
            description:
                'Full reconciled inventory trace for one product: combines catalog.document.element.list ' +
                '(receipts/transfers/corrections), sale.order + sale.basketitem.list (sales), and the current ' +
                'catalog.storeproduct.list / catalog.product.list snapshot into one chronological ledger with a ' +
                'running balance, instead of you having to cross-reference three separate Bitrix24 modules by ' +
                'hand. Read-only. Pages through every matching row internally (no sampling), so it can take ' +
                'a while for a product with a long history. ' +
                'IMPORTANT LIMITATION, learned the hard way: Bitrix24 sales do not carry a store/branch field in ' +
                'this API - when `storeId` is given, receipts/transfers are correctly scoped to that branch, but ' +
                'sales are shown portal-wide as a separate reference figure only (cannot be proven to belong to ' +
                'that specific branch) - do not treat a branch-scoped reconciliation as fully closed without ' +
                'checking that caveat. When `storeId` is omitted, the trace covers the whole portal, which avoids ' +
                'that specific attribution problem, but expect a small residual gap rather than an exact 0 for a ' +
                'fast-moving product - this trace takes over a minute on a busy SKU, and real sales/receipts keep ' +
                'happening on a live portal while it runs. A large or consistently-reproducible gap is worth ' +
                'investigating (e.g. order returns/reversals are not modeled here as their own event type).',
            inputSchema: {
                productId: z.number().int().describe('The product ID to trace (see bitrix_list_products).'),
                storeId: z.number().int().optional().describe('Restrict receipts/transfers to one branch - see the limitation note about sales above.'),
                iblockId: z.number().int().optional().describe('Catalog/infoblock ID the product belongs to (default 14) - only used for the portal-wide snapshot lookup when storeId is omitted.')
            }
        },
        async ({ productId, storeId, iblockId }) => {
            const targetIblockId = iblockId ?? 14;

            const { items: allMovements } = await bitrix.list<DocumentElementRow>(
                'catalog.document.element.list',
                { filter: { elementId: productId }, select: ['id', 'docId', 'elementId', 'amount', 'purchasingPrice', 'storeFrom', 'storeTo'] },
                Infinity,
                'documentElements'
            );
            const relevantMovements =
                storeId !== undefined
                    ? allMovements.filter(m => numOrNull(m.storeFrom) === storeId || numOrNull(m.storeTo) === storeId)
                    : allMovements;

            const docIds = [...new Set(relevantMovements.map(m => Number(m.docId)))];
            const documentsById = new Map<number, DocumentRow>();
            if (docIds.length > 0) {
                const { items: docs } = await bitrix.list<DocumentRow>(
                    'catalog.document.list',
                    { filter: { id: docIds }, select: ['id', 'docType', 'title', 'dateCreate', 'dateModify', 'dateStatus', 'responsibleId'] },
                    Infinity,
                    'documents'
                );
                for (const d of docs) documentsById.set(Number(d.id), d);
            }

            const { items: saleItems } = await bitrix.list<SaleItemRow>(
                'sale.basketitem.list',
                { filter: { productId }, select: ['id', 'orderId', 'productId', 'quantity', 'price', 'dateInsert'] },
                Infinity,
                'basketItems'
            );

            const orderIds = [...new Set(saleItems.map(s => Number(s.orderId)))];
            const ordersById = new Map<number, SaleOrderRow>();
            const shipmentsByOrderId = new Map<number, ShipmentRow[]>();
            if (orderIds.length > 0) {
                const { items: orders } = await bitrix.list<SaleOrderRow>(
                    'sale.order.list',
                    { filter: { id: orderIds }, select: ['id', 'accountNumber', 'dateInsert', 'canceled', 'deducted', 'statusId'] },
                    Infinity,
                    'orders'
                );
                for (const o of orders) ordersById.set(Number(o.id), o);

                const { items: shipments } = await bitrix.list<ShipmentRow>(
                    'sale.shipment.list',
                    { filter: { orderId: orderIds }, select: ['id', 'orderId', 'accountNumber', 'dateDeducted', 'deducted', 'empDeductedId', 'canceled'] },
                    Infinity,
                    'shipments'
                );
                for (const s of shipments) {
                    const list = shipmentsByOrderId.get(Number(s.orderId)) ?? [];
                    list.push(s);
                    shipmentsByOrderId.set(Number(s.orderId), list);
                }
            }

            type LedgerEvent = {
                source: 'inventory_document' | 'sale';
                date: string | null;
                kind: string;
                signedQuantity: number;
                detail: Record<string, unknown>;
            };
            const events: LedgerEvent[] = [];

            for (const m of relevantMovements) {
                const doc = documentsById.get(Number(m.docId));
                const amount = Number(m.amount) || 0;
                const storeFrom = numOrNull(m.storeFrom);
                const storeTo = numOrNull(m.storeTo);
                let kind: string;
                let signedQuantity: number;
                if (storeFrom === null && storeTo !== null) {
                    kind = 'receipt';
                    signedQuantity = amount;
                } else if (storeFrom !== null && storeTo === null) {
                    kind = 'deduction';
                    signedQuantity = -amount;
                } else if (storeFrom !== null && storeTo !== null) {
                    if (storeId !== undefined && storeFrom === storeId) {
                        kind = 'transfer_out';
                        signedQuantity = -amount;
                    } else if (storeId !== undefined && storeTo === storeId) {
                        kind = 'transfer_in';
                        signedQuantity = amount;
                    } else {
                        kind = 'transfer';
                        signedQuantity = 0; // portal-wide view: nets to zero, shown for visibility only
                    }
                } else {
                    kind = 'unknown';
                    signedQuantity = 0;
                }
                events.push({
                    source: 'inventory_document',
                    date: doc?.dateModify || doc?.dateCreate || null,
                    kind,
                    signedQuantity,
                    detail: { docId: m.docId, docType: doc?.docType, title: doc?.title, amount, storeFrom, storeTo }
                });
            }

            let totalSalesQuantity = 0;
            for (const s of saleItems) {
                const order = ordersById.get(Number(s.orderId));
                const shipments = shipmentsByOrderId.get(Number(s.orderId)) ?? [];
                const deducted = shipments.some(sh => sh.deducted === 'Y') || order?.deducted === 'Y';
                const canceled = order?.canceled === 'Y' || shipments.some(sh => sh.canceled === 'Y');
                const amount = Number(s.quantity) || 0;
                const signedQuantity = deducted && !canceled ? -amount : 0;
                if (signedQuantity !== 0) totalSalesQuantity += amount;
                events.push({
                    source: 'sale',
                    date: s.dateInsert || order?.dateInsert || null,
                    kind: canceled ? 'sale_canceled' : deducted ? 'sale' : 'sale_not_deducted',
                    signedQuantity,
                    detail: {
                        orderId: s.orderId,
                        orderAccountNumber: order?.accountNumber,
                        shipmentAccountNumbers: shipments.map(sh => sh.accountNumber).filter(Boolean),
                        amount,
                        deductedByEmployeeId: shipments[0]?.empDeductedId
                    }
                });
            }

            events.sort((a, b) => new Date(a.date ?? 0).getTime() - new Date(b.date ?? 0).getTime());

            const documentedRunningBalance = relevantMovements.reduce((sum, m) => {
                const amount = Number(m.amount) || 0;
                const storeFrom = numOrNull(m.storeFrom);
                const storeTo = numOrNull(m.storeTo);
                if (storeFrom === null && storeTo !== null) return sum + amount;
                if (storeFrom !== null && storeTo === null) return sum - amount;
                if (storeFrom !== null && storeTo !== null) {
                    if (storeId !== undefined && storeFrom === storeId) return sum - amount;
                    if (storeId !== undefined && storeTo === storeId) return sum + amount;
                }
                return sum;
            }, 0);

            let currentSnapshot: number;
            let reconciliation: Record<string, unknown>;
            if (storeId !== undefined) {
                const { items: sp } = await bitrix.list<{ amount?: string | number | null }>(
                    'catalog.storeproduct.list',
                    { filter: { productId, storeId }, select: ['amount'] },
                    5,
                    'storeProducts'
                );
                currentSnapshot = Number(sp[0]?.amount) || 0;
                reconciliation = {
                    scope: `store ${storeId} only`,
                    documentedRunningBalance,
                    currentSnapshot,
                    gap: documentedRunningBalance - currentSnapshot,
                    portalWideSalesQuantityForReference: totalSalesQuantity,
                    note:
                        'Sales cannot be proven to belong to this specific store via the API (see tool description) - ' +
                        'if `gap` is non-zero, check whether a sale around that date/quantity (portalWideSalesQuantityForReference, ' +
                        'or bitrix_list_sale_items filtered to this productId) plausibly happened at this branch before concluding data is missing.'
                };
            } else {
                const { items: prod } = await bitrix.list<{ quantity?: string | number | null }>(
                    'catalog.product.list',
                    { filter: { iblockId: targetIblockId, id: productId }, select: ['id', 'iblockId', 'quantity'] },
                    5,
                    'products'
                );
                currentSnapshot = Number(prod[0]?.quantity) || 0;
                const fullyReconciledBalance = documentedRunningBalance - totalSalesQuantity;
                reconciliation = {
                    scope: 'whole portal',
                    documentedRunningBalance,
                    totalSalesQuantity,
                    fullyReconciledBalance,
                    currentSnapshot,
                    gap: fullyReconciledBalance - currentSnapshot,
                    note:
                        'Portal-wide, there is no cross-branch attribution problem (unlike the store-scoped case), so this should ' +
                        'land close to 0 - but do not expect it to land exactly on 0 for a fast-moving product: this trace makes many ' +
                        'paginated API calls and can take over a minute, during which real sales/receipts keep happening on a live ' +
                        'portal, so a small residual gap (a handful of units on a product with hundreds of movements) is normal drift, ' +
                        'not necessarily a data problem. A large or consistently-reproducible gap is worth investigating further - ' +
                        'confirmed causes seen on this account include order returns/reversals not modeled here as a distinct event type.'
                };
            }

            return jsonResult({ productId, storeId: storeId ?? null, eventCount: events.length, events, reconciliation });
        }
    );
}

function numOrNull(value: number | string | null | undefined): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
}
