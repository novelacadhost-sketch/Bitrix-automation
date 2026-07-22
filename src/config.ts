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

const bitrixWebhookUrl = required('BITRIX24_WEBHOOK_URL');
if (!/^https:\/\/[^/]+\/rest\/\d+\/[^/]+\/?$/.test(bitrixWebhookUrl)) {
    throw new Error(
        'BITRIX24_WEBHOOK_URL does not look like a Bitrix24 inbound webhook URL ' +
            '(expected format: https://<portal>/rest/<user id>/<token>/).'
    );
}

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
    bitrixWebhookUrl: bitrixWebhookUrl.endsWith('/') ? bitrixWebhookUrl : `${bitrixWebhookUrl}/`,
    serverUrl,
    mcpResourceUrl: new URL('/mcp', serverUrl),
    loginPassphrase,
    port: Number(process.env.PORT) || 3000,
    dataDir: process.env.MCP_DATA_DIR || 'data'
};
