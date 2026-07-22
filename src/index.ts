import express, { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { config } from './config.js';
import { BitrixClient } from './bitrixClient.js';
import { buildMcpServer } from './mcpServer.js';
import { BitrixMcpOAuthProvider } from './oauthProvider.js';

const app = express();

// We sit behind a reverse proxy on every supported host (Railway's edge,
// or cPanel/Passenger on Namecheap) - this tells Express to trust the
// X-Forwarded-* headers those proxies set, so req.ip and req.protocol
// reflect the real client instead of the proxy.
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: false })); // needed for the OAuth token endpoint and our /login form

const bitrix = new BitrixClient(config.bitrixWebhookUrl);
const oauthProvider = new BitrixMcpOAuthProvider(config.dataDir);
const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(config.mcpResourceUrl);

// Mounts /authorize, /token, /register, /revoke and the .well-known
// metadata endpoints Claude's connector setup discovers automatically.
app.use(
    mcpAuthRouter({
        provider: oauthProvider,
        issuerUrl: config.serverUrl,
        resourceServerUrl: config.mcpResourceUrl,
        scopesSupported: ['mcp'],
        resourceName: 'NovelSolar Bitrix24 MCP Server'
    })
);

// Our own login-confirmation endpoint - see oauthProvider.ts for why this
// is a sibling path rather than nested under /authorize.
app.post('/login', (req, res) => {
    oauthProvider.handleLoginSubmit(req, res).catch(err => {
        console.error('Login error:', err);
        if (!res.headersSent) res.status(500).send('Something went wrong. Please go back to Claude and try connecting again.');
    });
});

// The actual MCP endpoint. Every request gets a brand-new McpServer and
// transport (stateless mode) - there is no session kept alive between
// calls, which keeps this friendly to hosts that idle/recycle the process
// between requests.
app.post('/mcp', requireBearerAuth({ verifier: oauthProvider, resourceMetadataUrl }), async (req: Request, res: Response) => {
    const server = buildMcpServer(bitrix);
    try {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => {
            transport.close();
            server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    } catch (err) {
        console.error('Error handling MCP request:', err);
        if (!res.headersSent) {
            res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
        }
    }
});

app.get('/mcp', (_req, res) => {
    res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed - this server is stateless, only POST /mcp is supported.' },
        id: null
    });
});

app.delete('/mcp', (_req, res) => {
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
});

// Unauthenticated health check - useful for Railway/cPanel uptime checks
// and for the README's end-to-end test.
app.get('/health', (_req, res) => {
    res.json({ ok: true, server: 'novelsolar-bitrix24-mcp' });
});

app.listen(config.port, () => {
    console.log(`NovelSolar Bitrix24 MCP server listening on port ${config.port}`);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
