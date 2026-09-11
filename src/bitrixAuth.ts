import { JsonStore } from './store.js';

// How a Bitrix24 REST call is authenticated. Two modes, because they are
// not interchangeable in capability:
//
//  - Inbound webhook: one long-lived URL, no token juggling. Simple, and
//    what this server has always used. But Bitrix24 refuses some methods
//    outright to webhooks regardless of the account's rights -
//    bizproc.workflow.template.add returns "Access denied! Application
//    context required" no matter how privileged the webhook user is.
//
//  - Local application (OAuth): calls carry an access token issued to a
//    registered app, acting on behalf of the user who authorised it. This
//    satisfies the application-context requirement, and inherits that
//    user's rights - so an admin-authorised app can also do things a
//    limited webhook cannot, such as userfieldconfig.add.
//
// IMPORTANT, and the reason each deployment needs its own app: Bitrix24
// rotates refresh tokens. Every refresh returns a new refresh_token and
// invalidates the one used. Two services sharing a single app's token will
// therefore keep silently revoking each other, producing intermittent auth
// failures that look random. Give every service its own local app.

export interface BitrixTransport {
    /** Full URL to POST a given REST method to. */
    endpoint(method: string): Promise<string>;
    /**
     * Called when Bitrix24 rejects a call with an auth-looking error code.
     * Return true if the caller should retry (e.g. a token was refreshed),
     * false if the failure is permanent.
     */
    handleAuthError(code: string): Promise<boolean>;
}

export class WebhookTransport implements BitrixTransport {
    constructor(private readonly webhookUrl: string) {}

    async endpoint(method: string): Promise<string> {
        return `${this.webhookUrl}${method}.json`;
    }

    async handleAuthError(): Promise<boolean> {
        // A webhook URL cannot be renewed in-process: whatever was denied
        // will be denied again. Retrying would just burn rate limit.
        return false;
    }
}

interface TokenState {
    accessToken?: string;
    refreshToken?: string;
    /** Epoch ms. Treated as already stale a minute early, to avoid races. */
    expiresAt?: number;
}

const EXPIRY_SAFETY_MS = 60_000;
const OAUTH_TOKEN_URL = 'https://oauth.bitrix.info/oauth/token/';
const AUTH_ERROR_CODES = new Set(['expired_token', 'invalid_token', 'NO_AUTH_FOUND', 'WRONG_AUTH_TYPE']);

export class AppTransport implements BitrixTransport {
    private readonly store: JsonStore<TokenState>;
    private refreshing: Promise<void> | null = null;

    constructor(
        private readonly portal: string,
        private readonly clientId: string,
        private readonly clientSecret: string,
        seedRefreshToken: string | undefined,
        dataDir: string
    ) {
        this.store = new JsonStore<TokenState>('bitrix-oauth.json', {}, dataDir);
        // Seed from the environment only if we have nothing stored. Once a
        // refresh has happened, the stored token is newer than the seed and
        // the seed is dead - overwriting with it would revoke ourselves.
        if (seedRefreshToken && !this.store.get('refreshToken')) {
            this.store.set('refreshToken', seedRefreshToken);
        }
    }

    /**
     * Stores the token pair Bitrix24 POSTs to a local application's handler
     * when the app is installed or reinstalled. This is the preferred way in:
     * it avoids a refresh token ever being pasted through a config file or a
     * chat window, and reinstalling the app in Bitrix24 becomes the recovery
     * path if the stored token is ever lost or revoked.
     */
    acceptInstallTokens(accessToken: string, refreshToken: string, expiresInSec: number): void {
        this.store.set('accessToken', accessToken);
        this.store.set('refreshToken', refreshToken);
        this.store.set('expiresAt', Date.now() + (expiresInSec || 3600) * 1000);
    }

    /** True once we hold a refresh token from any source. */
    get isAuthorised(): boolean {
        return Boolean(this.store.get('refreshToken'));
    }

    async endpoint(method: string): Promise<string> {
        const token = await this.accessToken();
        return `https://${this.portal}/rest/${method}.json?auth=${encodeURIComponent(token)}`;
    }

    async handleAuthError(code: string): Promise<boolean> {
        if (!AUTH_ERROR_CODES.has(code)) return false;
        // Force a refresh even if we thought the token was still valid -
        // Bitrix24 is the authority on that, not our clock.
        this.store.set('expiresAt', 0);
        try {
            await this.refresh();
            return true;
        } catch {
            return false;
        }
    }

    private async accessToken(): Promise<string> {
        const token = this.store.get('accessToken');
        const expiresAt = this.store.get('expiresAt') ?? 0;
        if (token && Date.now() < expiresAt - EXPIRY_SAFETY_MS) return token;
        await this.refresh();
        const fresh = this.store.get('accessToken');
        if (!fresh) throw new Error('Bitrix24 OAuth: no access token after refresh.');
        return fresh;
    }

    /** Refreshes once even if several callers ask concurrently. */
    private async refresh(): Promise<void> {
        if (this.refreshing) return this.refreshing;
        this.refreshing = this.doRefresh().finally(() => {
            this.refreshing = null;
        });
        return this.refreshing;
    }

    private async doRefresh(): Promise<void> {
        const refreshToken = this.store.get('refreshToken');
        if (!refreshToken) {
            throw new Error(
                'Bitrix24 OAuth: no refresh token stored. Set BITRIX24_REFRESH_TOKEN to a freshly ' +
                    'authorised token and restart.'
            );
        }
        const url =
            `${OAUTH_TOKEN_URL}?grant_type=refresh_token` +
            `&client_id=${encodeURIComponent(this.clientId)}` +
            `&client_secret=${encodeURIComponent(this.clientSecret)}` +
            `&refresh_token=${encodeURIComponent(refreshToken)}`;

        const response = await fetch(url);
        const body: any = await response.json().catch(() => null);

        if (!body || typeof body.access_token !== 'string') {
            const detail = body?.error_description || body?.error || `HTTP ${response.status}`;
            throw new Error(
                `Bitrix24 OAuth refresh failed: ${detail}. If this says the token is invalid, the stored ` +
                    'refresh token has been used elsewhere or has lapsed - re-authorise the app and reseed ' +
                    'BITRIX24_REFRESH_TOKEN. Note that refresh tokens rotate: a second service sharing this ' +
                    "app's token will revoke this one every time it refreshes."
            );
        }

        this.store.set('accessToken', body.access_token);
        if (typeof body.refresh_token === 'string') {
            // Rotated - the token we just used is now dead. Persisting the
            // new one immediately matters: losing it means re-authorising
            // the app by hand.
            this.store.set('refreshToken', body.refresh_token);
        }
        const expiresInSec = Number(body.expires_in) || 3600;
        this.store.set('expiresAt', Date.now() + expiresInSec * 1000);
    }
}
