import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidRequestError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { JsonStore } from './store.js';
import { config } from './config.js';

// A minimal, single-user OAuth 2.1 authorization server, built to satisfy
// claude.ai's custom-connector flow (which expects a real OAuth dance with
// Dynamic Client Registration + PKCE - see README "LIMITATIONS & SECURITY"
// for why a bare static bearer token is not reliably accepted there).
//
// There is exactly one real "user": you. Signing in means typing the
// MCP_LOGIN_PASSPHRASE from your .env on a plain HTML page this server
// renders itself - there's no Bitrix24 account, no database of users, and
// Bitrix24 credentials never touch this OAuth layer at all. This just
// gates "is this really me connecting from Claude" before handing out a
// token that unlocks the /mcp endpoint.

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes to complete the login screen
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;

interface PendingCode {
    client: OAuthClientInformationFull;
    params: AuthorizationParams;
    expiresAt: number;
}

interface StoredClients {
    clients: Record<string, OAuthClientInformationFull>;
}

interface StoredTokens {
    access: Record<string, { clientId: string; scopes: string[]; expiresAt: number }>;
    refresh: Record<string, { clientId: string; scopes: string[] }>;
}

class PersistedClientsStore implements OAuthRegisteredClientsStore {
    constructor(private readonly store: JsonStore<StoredClients>) {}

    async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
        return this.store.get('clients')[clientId];
    }

    async registerClient(client: OAuthClientInformationFull): Promise<OAuthClientInformationFull> {
        const clients = this.store.get('clients');
        clients[client.client_id] = client;
        this.store.set('clients', clients);
        return client;
    }
}

export class BitrixMcpOAuthProvider implements OAuthServerProvider {
    readonly clientsStore: PersistedClientsStore;
    private readonly tokenStore: JsonStore<StoredTokens>;
    private readonly codes = new Map<string, PendingCode>();
    private readonly loginAttempts = new Map<string, { count: number; blockedUntil: number }>();

    constructor(dataDir: string) {
        this.clientsStore = new PersistedClientsStore(new JsonStore<StoredClients>('oauth-clients.json', { clients: {} }, dataDir));
        this.tokenStore = new JsonStore<StoredTokens>('oauth-tokens.json', { access: {}, refresh: {} }, dataDir);
    }

    // Called by the SDK once it has validated the client_id/redirect_uri/
    // code_challenge on the incoming GET /authorize request. Instead of
    // redirecting immediately (as a "no login required" demo would), we
    // show a login page. The page's form posts to our own POST /login route
    // (registered separately in index.ts, deliberately NOT under /authorize
    // - the SDK's router mounts its handler with a prefix match on
    // /authorize, so a sibling path avoids any collision with it), which is
    // what actually issues the authorization code and redirects back to
    // Claude.
    async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
        this.purgeExpiredCodes();
        if (!client.redirect_uris.includes(params.redirectUri)) {
            throw new InvalidRequestError('Unregistered redirect_uri');
        }
        res.status(200).type('html').send(renderLoginPage(client.client_id, params, undefined));
    }

    // Handler for POST /login (wired up in index.ts). Checks the
    // passphrase and, if correct, issues an authorization code and redirects
    // back to Claude exactly as OAuthServerProvider.authorize() would have.
    async handleLoginSubmit(req: Request, res: Response): Promise<void> {
        const body = req.body ?? {};
        const params: AuthorizationParams = {
            state: emptyToUndefined(body.state),
            scopes: typeof body.scope === 'string' && body.scope.length > 0 ? body.scope.split(' ') : [],
            codeChallenge: String(body.code_challenge ?? ''),
            redirectUri: String(body.redirect_uri ?? ''),
            resource: emptyToUndefined(body.resource) ? new URL(String(body.resource)) : undefined
        };

        const clientId = String(body.client_id ?? '');
        const ip = req.ip ?? 'unknown';
        if (this.isBlocked(ip)) {
            res.status(429).type('html').send(renderLoginPage(clientId, params, 'Too many failed attempts. Wait 15 minutes and try again.'));
            return;
        }

        const client = await this.clientsStore.getClient(clientId);
        if (!client || !client.redirect_uris.includes(params.redirectUri)) {
            res.status(400).send('Unknown client or redirect URI. Please restart the connection from Claude.');
            return;
        }

        if (!passphraseMatches(String(body.passphrase ?? ''), config.loginPassphrase)) {
            this.recordFailedAttempt(ip);
            res.status(401).type('html').send(renderLoginPage(clientId, params, 'Incorrect passphrase. Try again.'));
            return;
        }
        this.loginAttempts.delete(ip);

        this.purgeExpiredCodes();
        const code = randomUUID();
        this.codes.set(code, { client, params, expiresAt: Date.now() + CODE_TTL_MS });

        const target = new URL(params.redirectUri);
        target.searchParams.set('code', code);
        if (params.state !== undefined) target.searchParams.set('state', params.state);
        res.redirect(target.toString());
    }

    async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
        const entry = this.codes.get(authorizationCode);
        if (!entry || entry.expiresAt < Date.now()) {
            throw new Error('Invalid or expired authorization code');
        }
        return entry.params.codeChallenge;
    }

    async exchangeAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<OAuthTokens> {
        const entry = this.codes.get(authorizationCode);
        if (!entry || entry.expiresAt < Date.now()) {
            throw new Error('Invalid or expired authorization code');
        }
        if (entry.client.client_id !== client.client_id) {
            throw new Error('Authorization code was not issued to this client');
        }
        if (entry.params.resource && entry.params.resource.toString() !== config.mcpResourceUrl.toString()) {
            throw new Error(`Invalid resource: ${entry.params.resource}`);
        }
        this.codes.delete(authorizationCode);
        return this.mintTokens(client.client_id, entry.params.scopes ?? []);
    }

    async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[]): Promise<OAuthTokens> {
        const refresh = this.tokenStore.get('refresh');
        const entry = refresh[refreshToken];
        if (!entry || entry.clientId !== client.client_id) {
            throw new Error('Invalid refresh token');
        }
        return this.mintTokens(client.client_id, scopes ?? entry.scopes, refreshToken);
    }

    async verifyAccessToken(token: string): Promise<AuthInfo> {
        const entry = this.tokenStore.get('access')[token];
        if (!entry || entry.expiresAt < Date.now()) {
            throw new Error('Invalid or expired token');
        }
        return {
            token,
            clientId: entry.clientId,
            scopes: entry.scopes,
            expiresAt: Math.floor(entry.expiresAt / 1000)
        };
    }

    async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
        const access = this.tokenStore.get('access');
        if (access[request.token]) {
            delete access[request.token];
            this.tokenStore.set('access', access);
        }
        const refresh = this.tokenStore.get('refresh');
        if (refresh[request.token]) {
            delete refresh[request.token];
            this.tokenStore.set('refresh', refresh);
        }
    }

    private mintTokens(clientId: string, scopes: string[], existingRefreshToken?: string): OAuthTokens {
        const accessToken = randomUUID();
        const refreshToken = existingRefreshToken ?? randomUUID();

        const access = this.tokenStore.get('access');
        access[accessToken] = { clientId, scopes, expiresAt: Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000 };
        this.tokenStore.set('access', access);

        if (!existingRefreshToken) {
            const refresh = this.tokenStore.get('refresh');
            refresh[refreshToken] = { clientId, scopes };
            this.tokenStore.set('refresh', refresh);
        }

        return {
            access_token: accessToken,
            token_type: 'bearer',
            expires_in: ACCESS_TOKEN_TTL_SECONDS,
            refresh_token: refreshToken,
            scope: scopes.join(' ')
        };
    }

    private purgeExpiredCodes(): void {
        const now = Date.now();
        for (const [code, entry] of this.codes) {
            if (entry.expiresAt < now) this.codes.delete(code);
        }
    }

    private isBlocked(ip: string): boolean {
        const entry = this.loginAttempts.get(ip);
        return !!entry && entry.blockedUntil > Date.now();
    }

    private recordFailedAttempt(ip: string): void {
        const now = Date.now();
        const existing = this.loginAttempts.get(ip);
        const count = existing && existing.blockedUntil <= now ? existing.count + 1 : (existing?.count ?? 0) + 1;
        const blockedUntil = count >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_BLOCK_MS : 0;
        this.loginAttempts.set(ip, { count: blockedUntil ? 0 : count, blockedUntil });
    }
}

// Constant-time-ish passphrase comparison: hashing both sides to a fixed
// length first means timingSafeEqual never throws on a length mismatch and
// the comparison time doesn't leak how much of the passphrase was guessed
// correctly.
function passphraseMatches(candidate: string, expected: string): boolean {
    const a = createHash('sha256').update(candidate).digest();
    const b = createHash('sha256').update(expected).digest();
    return timingSafeEqual(a, b);
}

function emptyToUndefined(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length === 0) return undefined;
    return value;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderLoginPage(clientId: string, params: AuthorizationParams, error: string | undefined): string {
    const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>NovelSolar Bitrix24 MCP Server - Sign in</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: system-ui, sans-serif; background: #f4f4f5; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
    form { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.15); width: 320px; }
    h1 { font-size: 1.1rem; margin: 0 0 1rem; }
    input[type=password] { width: 100%; padding: 0.5rem; box-sizing: border-box; margin-bottom: 1rem; border: 1px solid #ccc; border-radius: 4px; }
    button { width: 100%; padding: 0.6rem; background: #16457a; color: white; border: none; border-radius: 4px; font-size: 1rem; cursor: pointer; }
    .error { color: #b91c1c; font-size: 0.9rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <form method="post" action="/login">
    <h1>Sign in to connect Claude to Bitrix24</h1>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    ${hidden('client_id', clientId)}
    ${hidden('redirect_uri', params.redirectUri)}
    ${hidden('state', params.state ?? '')}
    ${hidden('code_challenge', params.codeChallenge)}
    ${hidden('resource', params.resource?.toString() ?? '')}
    ${hidden('scope', (params.scopes ?? []).join(' '))}
    <input type="password" name="passphrase" placeholder="Passphrase" autofocus required>
    <button type="submit">Sign in</button>
  </form>
</body>
</html>`;
}
