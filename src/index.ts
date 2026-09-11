import express, { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { config } from './config.js';
import { BitrixClient } from './bitrixClient.js';
import { AppTransport, WebhookTransport } from './bitrixAuth.js';
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

const bitrixTransport =
    config.bitrixAuthMode === 'app'
        ? new AppTransport(
              config.bitrixPortal!,
              config.bitrixClientId!,
              config.bitrixClientSecret!,
              config.bitrixRefreshToken!,
              config.dataDir
          )
        : new WebhookTransport(config.bitrixWebhookUrl!);
const bitrix = new BitrixClient(bitrixTransport);
console.log(`Bitrix24 auth mode: ${config.bitrixAuthMode}`);
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

// Bitrix24 local-application install handler.
//
// When a Server-type local app is installed or reinstalled, Bitrix24 POSTs
// a fresh token pair here (AUTH_ID / REFRESH_ID). Capturing them server-side
// means a refresh token never has to travel through a config file, a chat
// window or a clipboard - and "reinstall the app in Bitrix24" becomes the
// recovery procedure if the stored token is ever lost or revoked.
//
// Guarded by a shared secret in the query string, because this endpoint
// accepts credentials: anyone who could POST here could otherwise swap the
// server's Bitrix24 identity for one they control. With no secret
// configured the endpoint stays closed.
app.all('/bitrix/install', (req: Request, res: Response) => {
    const expected = config.bitrixInstallSecret;
    if (!expected) {
        res.status(404).send('Install handler is disabled. Set BITRIX24_INSTALL_SECRET to enable it.');
        return;
    }
    const provided = typeof req.query.secret === 'string' ? req.query.secret : '';
    if (provided !== expected) {
        // Deliberately vague - do not confirm whether the path is right.
        res.status(404).send('Not found.');
        return;
    }
    if (!(bitrixTransport instanceof AppTransport)) {
        res.status(409).send('Server is running in webhook mode. Set BITRIX24_AUTH_MODE=app and redeploy first.');
        return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const query = (req.query ?? {}) as Record<string, unknown>;
    // Log field NAMES only, never values - this is how we tell "Bitrix24
    // never called us" apart from "Bitrix24 called us with fields we did
    // not expect", which look identical from the outside.
    console.log(
        `Bitrix24 install handler: method=${req.method} bodyKeys=[${Object.keys(body).join(',')}] queryKeys=[${Object.keys(query).join(',')}]`
    );

    // Bitrix24 sends these in the POST body on install, but some flows put
    // them in the query string instead, so accept either.
    const pick = (name: string): string => {
        const fromBody = body[name];
        if (typeof fromBody === 'string' && fromBody) return fromBody;
        const fromQuery = query[name];
        return typeof fromQuery === 'string' && fromQuery ? fromQuery : '';
    };
    const accessToken = pick('AUTH_ID');
    const refreshToken = pick('REFRESH_ID');
    const expiresIn = Number(pick('AUTH_EXPIRES')) || 3600;

    if (!accessToken || !refreshToken) {
        // A GET from a browser lands here too - that is the normal way to
        // check the URL is live before installing, so say so plainly.
        res.status(200).send(
            'Install handler is live and the secret is correct. ' +
                'Now install the local application in Bitrix24 - it will POST its tokens to this URL.'
        );
        return;
    }

    bitrixTransport.acceptInstallTokens(accessToken, refreshToken, expiresIn);
    // Never log the tokens themselves.
    console.log('Bitrix24 local application installed - token pair stored.');
    // Calling installFinish() matters when the app is configured with
    // "Application completes the installation itself" ticked: without it
    // Bitrix24 waits forever on the install screen. Wrapped in a guard so
    // the same page still renders fine when opened directly in a browser,
    // where BX24 does not exist.
    res.status(200).send(
        '<html><head><script src="//api.bitrix24.com/api/v1/"></script></head>' +
            '<body><h3>Connected.</h3><p>Tokens stored. You can close this window.</p>' +
            '<script>try{if(typeof BX24!=="undefined"){BX24.init(function(){BX24.installFinish();});}}catch(e){}</script>' +
            '</body></html>'
    );
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
