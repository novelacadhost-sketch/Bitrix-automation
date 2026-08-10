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

    server.registerTool(
        'bitrix_list_prices',
        {
            description:
                'List per-product prices (catalog.price.list). Read-only. Each row is one price for one ' +
                'product under one price type (catalogGroupId) - most portals have a single "base" price type, ' +
                'see bitrix_stock_value_report which resolves that automatically. Returns at most `limit` rows ' +
                '(default 50, max 200).',
            inputSchema: {
                filter: z.record(z.string(), z.any()).optional().describe('e.g. {"productId":212} or {"catalogGroupId":2}'),
                select: z.array(z.string()).optional(),
                limit: z.number().int().min(1).max(200).optional()
            }
        },
        async ({ filter, select, limit }) => {
            const { items, total } = await bitrix.list(
                'catalog.price.list',
                {
                    filter: filter ?? {},
                    select: select ?? ['id', 'productId', 'catalogGroupId', 'price', 'currency', 'priceScale', 'quantityFrom', 'quantityTo']
                },
                clampLimit(limit),
                'prices'
            );
            return jsonResult({ total, returned: items.length, prices: items });
        }
    );

    server.registerTool(
        'bitrix_list_stores',
        {
            description:
                'List branches/warehouses (catalog.store.list). Read-only. Includes utility entries (e.g. a ' +
                'placeholder "Empty Warehouse") alongside real branches, not filtered out. Returns at most ' +
                '`limit` rows (default 50, max 200).',
            inputSchema: {
                filter: z.record(z.string(), z.any()).optional(),
                select: z.array(z.string()).optional(),
                limit: z.number().int().min(1).max(200).optional()
            }
        },
        async ({ filter, select, limit }) => {
            const { items, total } = await bitrix.list(
                'catalog.store.list',
                { filter: filter ?? {}, select: select ?? ['id', 'title', 'address', 'active', 'sort'] },
                clampLimit(limit),
                'stores'
            );
            return jsonResult({ total, returned: items.length, stores: items });
        }
    );

    server.registerTool(
        'bitrix_list_store_products',
        {
            description:
                'List per-branch product quantities (catalog.storeproduct.list). Read-only. Each row is one ' +
                "product's quantity at one specific branch/warehouse (storeId). Not every product with stock " +
                'has a matching row here for every branch it could be in - see bitrix_stock_value_report for a ' +
                'reconciled total that accounts for that gap explicitly. Returns at most `limit` rows (default ' +
                '50, max 200).',
            inputSchema: {
                filter: z.record(z.string(), z.any()).optional().describe('e.g. {"productId":212} or {"storeId":4}'),
                select: z.array(z.string()).optional(),
                limit: z.number().int().min(1).max(200).optional()
            }
        },
        async ({ filter, select, limit }) => {
            const { items, total } = await bitrix.list(
                'catalog.storeproduct.list',
                { filter: filter ?? {}, select: select ?? ['id', 'productId', 'storeId', 'amount', 'quantityReserved'] },
                clampLimit(limit),
                'storeProducts'
            );
            return jsonResult({ total, returned: items.length, storeProducts: items });
        }
    );

    server.registerTool(
        'bitrix_stock_value_report',
        {
            description:
                'Computed inventory valuation report: joins catalog.product.list, catalog.price.list, ' +
                'catalog.store.list and catalog.storeproduct.list server-side to compute total stock value ' +
                '(quantity x price per SKU) and a per-branch value breakdown. Read-only. This pulls and pages ' +
                'through every matching product/price/store-product row internally rather than sampling - a ' +
                'valuation total that silently dropped rows would just be wrong - so it typically takes 1-3 ' +
                'minutes to run instead of being instant. It explicitly reports stock quantity that exists in ' +
                "a product's total but has no matching per-branch row (unallocatedQuantity/Value), and the " +
                "opposite discrepancy where a product's branch-level quantities collectively exceed its own " +
                'total figure (overAllocatedQuantity/Value) - both are live data inconsistencies this tool has ' +
                'observed between Bitrix24 endpoints, surfaced rather than silently absorbed into one number.',
            inputSchema: {
                iblockId: z.number().int().optional().describe('Catalog/infoblock ID to report on (default 14, the main product catalog).')
            }
        },
        async ({ iblockId }) => {
            const targetIblockId = iblockId ?? 14;

            // Resolve the portal's base price type dynamically instead of assuming a fixed
            // catalogGroupId - if a portal only has one price type (common), that's the one to use
            // regardless of what numeric ID it happens to have.
            const priceTypeResult = await bitrix.call<{ priceTypes?: Array<{ id: number; base?: string; name?: string }> }>(
                'catalog.priceType.list',
                {}
            );
            const priceTypes = priceTypeResult?.priceTypes ?? [];
            const basePriceType = priceTypes.find(t => t.base === 'Y') ?? priceTypes[0];
            if (!basePriceType) {
                throw new Error('catalog.priceType.list returned no price types - cannot value stock without one.');
            }

            const [productsResult, pricesResult, storesResult, storeProductsResult] = await Promise.all([
                bitrix.list<{ id: number | string; name?: string; quantity?: string | number }>(
                    'catalog.product.list',
                    { filter: { iblockId: targetIblockId }, select: ['id', 'iblockId', 'name', 'quantity'] },
                    Infinity,
                    'products'
                ),
                bitrix.list<{ productId: number | string; price?: string | number; currency?: string; quantityFrom?: number | null }>(
                    'catalog.price.list',
                    { filter: { catalogGroupId: basePriceType.id }, select: ['productId', 'price', 'currency', 'quantityFrom'] },
                    Infinity,
                    'prices'
                ),
                bitrix.list<{ id: number | string; title?: string }>('catalog.store.list', { select: ['id', 'title'] }, Infinity, 'stores'),
                bitrix.list<{ productId: number | string; storeId: number | string; amount?: string | number | null }>(
                    'catalog.storeproduct.list',
                    { select: ['productId', 'storeId', 'amount'] },
                    Infinity,
                    'storeProducts'
                )
            ]);
            const products = productsResult.items;
            const prices = pricesResult.items;
            const stores = storesResult.items;
            const storeProducts = storeProductsResult.items;

            // One price per product: prefer the untiered row (no quantityFrom) if a product has
            // more than one row under the base price type.
            const priceByProduct = new Map<number, number>();
            const currenciesSeen = new Set<string>();
            for (const row of prices) {
                const pid = Number(row.productId);
                const isUntiered = row.quantityFrom === null || row.quantityFrom === undefined || row.quantityFrom === 0;
                if (!priceByProduct.has(pid) || isUntiered) {
                    priceByProduct.set(pid, Number(row.price) || 0);
                }
                if (row.currency) currenciesSeen.add(row.currency);
            }

            const storeNameById = new Map<number, string>();
            for (const s of stores) storeNameById.set(Number(s.id), s.title ?? `Store ${s.id}`);

            const allocatedQtyByProduct = new Map<number, number>();
            const branchAgg = new Map<number, { quantity: number; value: number }>();
            for (const row of storeProducts) {
                const amount = Number(row.amount) || 0;
                if (amount === 0) continue;
                const pid = Number(row.productId);
                const sid = Number(row.storeId);
                allocatedQtyByProduct.set(pid, (allocatedQtyByProduct.get(pid) ?? 0) + amount);
                const price = priceByProduct.get(pid) ?? 0;
                const bucket = branchAgg.get(sid) ?? { quantity: 0, value: 0 };
                bucket.quantity += amount;
                bucket.value += amount * price;
                branchAgg.set(sid, bucket);
            }

            const productQtyById = new Map<number, number>();
            for (const product of products) {
                productQtyById.set(Number(product.id), Number(product.quantity) || 0);
            }

            let totalStockValue = 0;
            let unallocatedQuantity = 0;
            let unallocatedValue = 0;
            let overAllocatedQuantity = 0;
            let overAllocatedValue = 0;
            const productsMissingPrice: number[] = [];

            // Union of every product that has either a recorded total quantity or any allocated
            // (per-branch) quantity - a product can have one without the other, in both
            // directions. Confirmed live against this portal: some products have branch-level
            // (storeproduct) quantities that collectively EXCEED the product's own total quantity
            // figure, not just the shortfall case this tool was originally asked to handle - so we
            // reconcile both directions rather than silently letting the branch breakdown disagree
            // with the headline total with no explanation.
            const allProductIds = new Set<number>([...productQtyById.keys(), ...allocatedQtyByProduct.keys()]);
            for (const pid of allProductIds) {
                const totalQty = productQtyById.get(pid) ?? 0;
                const allocated = allocatedQtyByProduct.get(pid) ?? 0;
                if (totalQty <= 0 && allocated <= 0) continue;

                const price = priceByProduct.get(pid);
                if (price === undefined) productsMissingPrice.push(pid);
                const effectivePrice = price ?? 0;

                totalStockValue += totalQty * effectivePrice;

                const remainder = totalQty - allocated;
                if (remainder > 0) {
                    unallocatedQuantity += remainder;
                    unallocatedValue += remainder * effectivePrice;
                } else if (remainder < 0) {
                    overAllocatedQuantity += -remainder;
                    overAllocatedValue += -remainder * effectivePrice;
                }
            }

            // Every store, including ones with zero allocated value - "pass through, don't filter".
            // Branch quantities/values are the raw, itemized catalog.storeproduct.list amounts -
            // they are NOT capped to match each product's totalStockValue contribution, so their
            // sum can exceed totalStockValue by roughly overAllocatedValue (see below).
            const branches = stores
                .map(s => {
                    const sid = Number(s.id);
                    const bucket = branchAgg.get(sid) ?? { quantity: 0, value: 0 };
                    return { storeId: sid, title: storeNameById.get(sid) ?? `Store ${sid}`, quantity: bucket.quantity, value: bucket.value };
                })
                .sort((a, b) => b.value - a.value);

            return jsonResult({
                iblockId: targetIblockId,
                currency: currenciesSeen.size === 1 ? [...currenciesSeen][0] : undefined,
                currencyWarning:
                    currenciesSeen.size > 1
                        ? `Multiple currencies found in matched price rows (${[...currenciesSeen].join(', ')}) - totals below mix them, treat with caution.`
                        : undefined,
                priceTypeUsed: { id: basePriceType.id, name: basePriceType.name },
                productsConsidered: productsResult.total,
                totalStockValue,
                unallocatedQuantity,
                unallocatedValue,
                unallocatedNote:
                    unallocatedQuantity > 0
                        ? `${unallocatedQuantity} units of stock (worth ${unallocatedValue}) exist in catalog.product.list quantities but have no matching per-branch row in catalog.storeproduct.list - included in totalStockValue but not in any branch's figure below.`
                        : 'Every unit of stock is accounted for in the branch breakdown below.',
                overAllocatedQuantity,
                overAllocatedValue,
                overAllocatedNote:
                    overAllocatedQuantity > 0
                        ? `${overAllocatedQuantity} units (worth ${overAllocatedValue}) is the opposite discrepancy: some products' catalog.storeproduct.list branch quantities collectively exceed that product's own quantity figure in catalog.product.list. This excess IS included in the branch breakdown below (since it's real, itemized per-branch data) but is NOT included in totalStockValue (which is based on each product's own quantity field) - that's why summing the branches below gives a larger number than totalStockValue. This reflects a live data inconsistency between the two Bitrix24 endpoints, not a bug in this report.`
                        : 'Branch-level quantities never exceed each product\'s own total quantity figure - no reconciliation discrepancy in this direction.',
                productsMissingPrice:
                    productsMissingPrice.length > 0 ? { count: productsMissingPrice.length, sampleIds: productsMissingPrice.slice(0, 10) } : undefined,
                branches
            });
        }
    );
}
