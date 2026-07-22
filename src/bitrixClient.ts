// A thin client for calling Bitrix24's REST API through an inbound webhook.
//
// What this handles for you:
//  - Building the request URL/body for a given REST method + params.
//  - Bitrix24's error shape: errors come back as a JSON body with an
//    `error` code and `error_description`, sometimes alongside a non-200
//    HTTP status and sometimes not - we normalise both into a BitrixApiError.
//  - Rate limits: Bitrix24 asks integrations to stay under ~2 requests/sec
//    and returns error code QUERY_LIMIT_EXCEEDED (HTTP 503) if you go over.
//    We pace requests client-side so we rarely hit this, and if we do
//    anyway, we retry with exponential backoff instead of failing the tool
//    call outright.

const MIN_INTERVAL_MS = 550; // a little under 2 req/sec, on purpose
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 600;

export class BitrixApiError extends Error {
    constructor(
        public readonly code: string,
        description: string
    ) {
        super(`Bitrix24 API error [${code}]: ${description}`);
        this.name = 'BitrixApiError';
    }
}

interface BitrixRawBody {
    result: unknown;
    next?: number;
    total?: number;
}

export class BitrixClient {
    private nextRequestAt = 0;

    constructor(private readonly webhookUrl: string) {}

    /** Calls a non-list Bitrix24 REST method and returns its `result` field. */
    async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
        const body = await this.callWithRetry(method, params);
        return body.result as T;
    }

    /**
     * Calls a Bitrix24 *list* method (crm.deal.list, crm.item.list, ...) and
     * pages through `start` until `limit` rows are collected or Bitrix runs
     * out of rows - whichever comes first. Bitrix returns ~50 rows per page
     * regardless of what you ask for, so fetching more than that means
     * multiple requests under the hood.
     *
     * Most list methods return the array directly as `result`, but a few
     * (catalog.product.list is the confirmed one - it returns
     * `{ products: [...] }`) nest it under a named key instead. Pass that
     * key as `resultKey` when that's the case.
     */
    async list<T = unknown>(
        method: string,
        params: Record<string, unknown>,
        limit: number,
        resultKey?: string
    ): Promise<{ items: T[]; total: number }> {
        const items: T[] = [];
        let start = 0;
        let total = 0;
        for (;;) {
            const body = await this.callWithRetry(method, { ...params, start });
            const rawResult = resultKey ? (body.result as Record<string, unknown> | undefined)?.[resultKey] : body.result;
            const page = Array.isArray(rawResult) ? (rawResult as T[]) : [];
            items.push(...page);
            total = body.total ?? items.length;
            if (items.length >= limit || page.length === 0 || body.next === undefined) break;
            start = body.next;
        }
        return { items: items.slice(0, limit), total };
    }

    private async callWithRetry(method: string, params: Record<string, unknown>): Promise<BitrixRawBody> {
        let attempt = 0;
        for (;;) {
            await this.waitForSlot();
            try {
                return await this.doCall(method, params);
            } catch (err) {
                const isRateLimit = err instanceof BitrixApiError && err.code === 'QUERY_LIMIT_EXCEEDED';
                const isTransient = isRateLimit || err instanceof TypeError; // TypeError == fetch/network failure
                attempt++;
                if (!isTransient || attempt > MAX_RETRIES) {
                    throw err;
                }
                const backoff = BASE_BACKOFF_MS * 2 ** (attempt - 1);
                await sleep(backoff);
            }
        }
    }

    private async waitForSlot(): Promise<void> {
        const now = Date.now();
        const waitMs = this.nextRequestAt - now;
        this.nextRequestAt = Math.max(now, this.nextRequestAt) + MIN_INTERVAL_MS;
        if (waitMs > 0) {
            await sleep(waitMs);
        }
    }

    private async doCall(method: string, params: Record<string, unknown>): Promise<BitrixRawBody> {
        const url = `${this.webhookUrl}${method}.json`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });

        let body: any;
        try {
            body = await response.json();
        } catch {
            throw new BitrixApiError('BAD_RESPONSE', `Non-JSON response from Bitrix24 (HTTP ${response.status})`);
        }

        if (body && typeof body.error === 'string') {
            throw new BitrixApiError(body.error, body.error_description ?? 'No further details provided by Bitrix24.');
        }

        if (!response.ok) {
            throw new BitrixApiError('HTTP_ERROR', `Bitrix24 returned HTTP ${response.status} with no error body.`);
        }

        return body as BitrixRawBody;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
