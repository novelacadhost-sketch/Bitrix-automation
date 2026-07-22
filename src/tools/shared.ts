import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// Every tools/*.ts file imports zod as `import * as z from 'zod/v4'`, NOT
// `import { z } from 'zod'`. This isn't a style choice: classic zod v3's
// types combined with McpServer.registerTool's generics in this SDK version
// cause TypeScript to recurse near-infinitely (a multi-minute hang ending
// in "Type instantiation is excessively deep" or an out-of-memory crash),
// especially with z.record(). The zod/v4 subpath (shipped inside the same
// zod package, matching the SDK's own examples) avoids it entirely.

export function jsonResult(data: unknown): CallToolResult {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

const DEFAULT_LIMIT = 50;
const MAX_PAGED_LIMIT = 200; // for tools that page through bitrix.list()
const MAX_SINGLE_PAGE_LIMIT = 50; // for tools that only fetch one Bitrix24 page

export function clampLimit(limit: number | undefined): number {
    if (!limit || limit < 1) return DEFAULT_LIMIT;
    return Math.min(Math.floor(limit), MAX_PAGED_LIMIT);
}

export function clampSinglePageLimit(limit: number | undefined): number {
    if (!limit || limit < 1) return DEFAULT_LIMIT;
    return Math.min(Math.floor(limit), MAX_SINGLE_PAGE_LIMIT);
}
