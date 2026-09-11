import 'dotenv/config';

// Reads and validates the environment variables this server needs, once,
// at startup. Never logs actual secret values - only which variable names
// are missing, so misconfiguration is easy to diagnose without leaking
// anything into logs.

function required(name: string): string {
    const value = process.env[name];
    if (!value || value.trim() === '') {
        throw new Error(`Missing required environment variable: ${name}. Copy .env.example to .env and fill it in.`);
    }
    return value.trim();
}

function optional(name: string): string | undefined {
    const value = process.env[name];
    return value && value.trim() !== '' ? value.trim() : undefined;
}

// Which credential the Bitrix24 calls use. Defaults to 'webhook' so an
// existing deployment keeps working untouched. Set BITRIX24_AUTH_MODE=app
// to switch, and back again if something regresses - the two are
// independent, so flipping is a one-variable rollback rather than a
// redeploy of different code.
const bitrixAuthMode = (optional('BITRIX24_AUTH_MODE') ?? 'webhook').toLowerCase();
if (bitrixAuthMode !== 'webhook' && bitrixAuthMode !== 'app') {
    throw new Error('BITRIX24_AUTH_MODE must be either "webhook" or "app".');
}

const bitrixWebhookUrl = bitrixAuthMode === 'webhook' ? required('BITRIX24_WEBHOOK_URL') : optional('BITRIX24_WEBHOOK_URL');
if (bitrixWebhookUrl && !/^https:\/\/[^/]+\/rest\/\d+\/[^/]+\/?$/.test(bitrixWebhookUrl)) {
    throw new Error(
        'BITRIX24_WEBHOOK_URL does not look like a Bitrix24 inbound webhook URL ' +
            '(expected format: https://<portal>/rest/<user id>/<token>/).'
    );
}

// Local-application credentials. Only required in app mode. The refresh
// token here is a SEED: once the server has refreshed once it stores the
// rotated token and ignores this value, because Bitrix24 invalidates a
// refresh token as soon as it is used.
const bitrixPortal = bitrixAuthMode === 'app' ? required('BITRIX24_PORTAL').replace(/^https?:\/\//, '').replace(/\/$/, '') : undefined;
const bitrixClientId = bitrixAuthMode === 'app' ? required('BITRIX24_CLIENT_ID') : undefined;
const bitrixClientSecret = bitrixAuthMode === 'app' ? required('BITRIX24_CLIENT_SECRET') : undefined;
// Optional. Normally the tokens arrive at the install handler instead, so
// this only exists as a manual fallback.
const bitrixRefreshToken = optional('BITRIX24_REFRESH_TOKEN');

// Guards the install handler. Bitrix24 POSTs live tokens to that URL, so it
// must not be callable by anyone who happens to guess the path - without
// this set, the endpoint refuses every request.
const bitrixInstallSecret = optional('BITRIX24_INSTALL_SECRET');

const rawServerUrl = required('MCP_SERVER_URL');
const serverUrl = new URL(rawServerUrl);
if (serverUrl.protocol !== 'https:' && serverUrl.hostname !== 'localhost' && serverUrl.hostname !== '127.0.0.1') {
    throw new Error('MCP_SERVER_URL must be an https:// URL (Claude will refuse to talk to a non-HTTPS remote server).');
}

const loginPassphrase = required('MCP_LOGIN_PASSPHRASE');
if (loginPassphrase.length < 12) {
    throw new Error('MCP_LOGIN_PASSPHRASE is too short - use at least 12 characters.');
}

export const config = {
    bitrixAuthMode: bitrixAuthMode as 'webhook' | 'app',
    bitrixWebhookUrl: bitrixWebhookUrl ? (bitrixWebhookUrl.endsWith('/') ? bitrixWebhookUrl : `${bitrixWebhookUrl}/`) : undefined,
    bitrixPortal,
    bitrixClientId,
    bitrixClientSecret,
    bitrixRefreshToken,
    bitrixInstallSecret,
    serverUrl,
    mcpResourceUrl: new URL('/mcp', serverUrl),
    loginPassphrase,
    port: Number(process.env.PORT) || 3000,
    dataDir: process.env.MCP_DATA_DIR || 'data'
};
