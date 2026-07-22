# NovelSolar Bitrix24 MCP Server

This is a small server that lets Claude talk directly to your Bitrix24 portal - list and create CRM deals, look up products, check tasks, see business process workflows, and more - using Bitrix24's own REST API. You run it yourself (on your own hosting), it holds your Bitrix24 credentials, and Claude connects to it over the internet using a login step you control.

This README assumes no programming background. Every command you need to run is in a grey box - copy it, paste it into the terminal/command prompt, press enter.

---

## Contents

1. [What you'll need](#1-what-youll-need)
2. [Install Node.js](#2-install-nodejs)
3. [Get the code and push it to your own GitHub](#3-get-the-code-and-push-it-to-your-own-github)
4. [Create the Bitrix24 inbound webhook](#4-create-the-bitrix24-inbound-webhook)
5. [Set your environment variables](#5-set-your-environment-variables)
6. [Test it on your own computer (recommended)](#6-test-it-on-your-own-computer-recommended)
7. [Deploy to Namecheap (cPanel / Stellar Plus)](#7-deploy-to-namecheap-cpanel--stellar-plus)
8. [Add it to Claude as a custom connector](#8-add-it-to-claude-as-a-custom-connector)
9. [One read-only end-to-end test](#9-one-read-only-end-to-end-test)
10. [Rotating or revoking access](#10-rotating-or-revoking-access)
11. [What each tool does](#11-what-each-tool-does)
12. [LIMITATIONS & SECURITY](#12-limitations--security)

---

## 1. What you'll need

- A Windows/Mac computer to do the setup from (you're already on one).
- A free [GitHub](https://github.com) account, to hold the code.
- Access to your Namecheap account and its cPanel (Stellar Plus hosting).
- Access to your Bitrix24 portal as an administrator, to create a webhook.
- About 45-60 minutes, more if this is your first time using a terminal.

---

## 2. Install Node.js

Node.js is the program that runs this server's code.

1. Go to [nodejs.org](https://nodejs.org) and download the **LTS** version for Windows.
2. Run the installer, click Next through the defaults, finish.
3. Open a terminal (search for "Command Prompt" or "PowerShell" in the Start menu) and run:

```bash
node --version
```

You should see something like `v20.x.x` or `v22.x.x`. If you see an error instead, restart your computer and try again (Windows sometimes needs a restart to pick up the new PATH).

---

## 3. Get the code and push it to your own GitHub

You already have the project folder (`Bitrix automation`). Now put it under version control and push it to a repository **you** own, so you can deploy from it later.

1. Create a new **private** repository on github.com (click the "+" in the top right > "New repository"). Name it something like `bitrix24-mcp`. Don't add a README/gitignore on GitHub's side - you already have those.
2. In your terminal, `cd` into the project folder and run:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/bitrix24-mcp.git
git push -u origin main
```

Replace `<your-username>` with your actual GitHub username. GitHub will prompt you to sign in the first time.

**Double-check before pushing:** run `git status` and make sure `.env` is NOT listed as a file about to be committed. The `.gitignore` file already excludes it, but it's worth a glance - `.env` is where your real secrets will live, and it must never end up on GitHub.

---

## 4. Create the Bitrix24 inbound webhook

**✅ Already done for your portal (nisl.bitrix24.com).** You've already created a webhook under your admin account and put it in `.env`. I verified it live with safe, read-only calls: `crm`, `task`, `bizproc`, `user` and `department` scopes are all active, and since it's an admin account, the business-process write tools (`bitrix_bp_start`, `bitrix_bp_add_template`, `bitrix_bp_update_template`) will work too. You can skip to [step 5](#5-set-your-environment-variables) - the rest of this section is reference material for if you ever need to recreate or rotate it.

In your Bitrix24 portal: **CRM (or the main menu) > Settings > Developer resources > Other > Inbound webhook** (the exact menu wording varies slightly by portal language/version - search "webhook" in Bitrix24's settings search if you can't find it).

**Which account should create it?** Bitrix24 inbound webhooks inherit the permissions of whichever user creates them. You asked for a purpose-made limited account rather than your admin login, which is good practice in general - **but with one important caveat**: the Business Process template tools in this server (creating/editing workflow templates, starting workflows) call Bitrix24 methods that are documented as admin-only. If you create the webhook under a non-admin account, `bitrix_bp_add_template`, `bitrix_bp_update_template` and possibly `bitrix_bp_start` will fail with a permissions error. Your realistic options:
- Create the webhook under your admin account (simplest, everything works, but the webhook has full admin reach).
- Create it under a limited account and accept that the business-process write tools won't work (everything else still will).
- Create a **second**, separate webhook under your admin account used only if you need business-process editing, and keep the main one limited. This server as built uses one webhook for everything, so this option would require duplicating the deployment - only worth it if you actually plan to use those tools often.

Given the choice, using your admin account for the one webhook is the more practical default unless you specifically want to keep the bizproc write tools disabled.

**Scopes to tick** (checkbox wording varies by portal language/version - tick anything matching these):

| Tick this | Needed for |
|---|---|
| **CRM** | Deals, and CRM Smart Process Automation (SPA) items |
| **Tasks** | Task list |
| **CRM Catalog / Store / Catalog** | Product catalog |
| **Business Processes / Workflows / bizproc** | Business process templates, instances, starting workflows |
| **Users / Company / Departments** | Employee directory and department structure |

Once created, Bitrix24 shows you a URL that looks like:

```
https://novelsolar.bitrix24.com/rest/1/aBcDeFgHiJkLmNoP/
```

Copy this somewhere safe for the next step - **treat it exactly like a password**. Anyone with this URL can do anything the webhook's account can do in your portal.

---

## 5. Set your environment variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Open `.env` in a text editor (Notepad works) and fill in:

- `BITRIX24_WEBHOOK_URL` - the URL from step 4.
- `MCP_SERVER_URL` - the public HTTPS address this server will live at once deployed (step 7 will tell you exactly what this is - come back and fill this in after you've picked a subdomain).
- `MCP_LOGIN_PASSPHRASE` - make up a long, random passphrase (20+ characters, a password manager can generate one). This is what you'll type once to let Claude connect - it is the only thing gating access to your Bitrix24 data from the internet, so treat it as seriously as the webhook URL.

Never commit this file to git. `.gitignore` already excludes it, but don't override that.

---

## 6. Test it on your own computer (recommended)

This step is optional but catches most mistakes before you deploy anywhere.

```bash
npm install
npm run build
npm start
```

You should see `NovelSolar Bitrix24 MCP server listening on port 3000`. Leave that running, open a second terminal, and check:

```bash
curl http://localhost:3000/health
```

You should get back `{"ok":true,"server":"novelsolar-bitrix24-mcp"}`. Press Ctrl+C in the first terminal to stop the server when you're done.

(For this local test, `MCP_SERVER_URL` in `.env` can temporarily be `http://localhost:3000` - change it to your real public URL before deploying.)

---

## 7. Deploy to Namecheap (cPanel / Stellar Plus)

**Be aware going in:** Stellar Plus is shared website hosting, not a purpose-built app host. It can run this server via cPanel's "Setup Node.js App" feature (built on something called Passenger), but there are real trade-offs versus a dedicated host like Railway:

- The app process can be **idled/recycled** after a period of no traffic. In practice this means the *first* request after a quiet spell can take a few seconds longer while it wakes back up - it should not drop the connection entirely, since this server is built to answer each request independently (no long-lived connection to lose).
- Node.js version choice and memory are more limited than a dedicated container host.
- I could not fully confirm from Namecheap's own documentation that the Node.js Selector is available specifically on the Stellar Plus tier (as opposed to Stellar Business) - check for it yourself in the next step, and contact Namecheap support if it's missing.

If any of this becomes a real problem in practice, moving to Railway later is a matter of redeploying the same code - nothing in the project is Namecheap-specific except the `.cpanel.yml` file.

### 7.1 Pick a subdomain

Use a dedicated subdomain rather than a subpath of your main site - e.g. `mcp.novelsolar.com`. This avoids a whole category of path-prefix bugs that come from mounting a Node app under a subfolder of an existing site. In cPanel:

1. **Domains > Subdomains** (or similar) - create `mcp` under `novelsolar.com`.
2. This gives you `https://mcp.novelsolar.com`. cPanel's AutoSSL should issue it a free HTTPS certificate automatically within a few minutes to hours - confirm the padlock shows before moving on, since Claude will refuse to connect over plain HTTP.

Go back to your `.env` (and update it again on the server in step 7.4) and set:

```
MCP_SERVER_URL=https://mcp.novelsolar.com
```

No trailing slash.

### 7.2 Set up Git Version Control in cPanel

1. In cPanel, find **Git™ Version Control**.
2. Click **Create**, and point it at your GitHub repository (`https://github.com/<your-username>/bitrix24-mcp.git`). Set the repository path to something like `/home/<your-cpanel-username>/bitrix-mcp` - this is where the code will live on the server.
3. If your GitHub repo is private, cPanel will need a way to authenticate - it will walk you through either an SSH deploy key (recommended) or a personal access token. Follow its on-screen instructions.

### 7.3 Set up the Node.js app

1. Find **Setup Node.js App** in cPanel. If you don't see it, that's the "is Stellar Plus supported" question from above - contact Namecheap support before going further.
2. Click **Create Application**:
   - **Node.js version**: pick the newest available (18 or higher).
   - **Application mode**: Production.
   - **Application root**: the same path you used in step 7.2 (e.g. `/home/<your-cpanel-username>/bitrix-mcp`).
   - **Application URL**: the `mcp` subdomain from step 7.1.
   - **Application startup file**: `dist/index.js`.
3. Before saving, add your environment variables in the **Environment variables** section of this same screen: `BITRIX24_WEBHOOK_URL`, `MCP_SERVER_URL`, `MCP_LOGIN_PASSPHRASE`. (You can also just place a `.env` file directly in the application root via cPanel's File Manager - either works, since the app reads `.env` from disk at startup if present. Don't do both with different values - pick one place and keep it consistent.)
4. Save/Create. cPanel will show you a "Run NPM Install" button and a command line snippet starting with `source /home/.../nodevenv/.../bin/activate` - **copy that exact line**, you need it next.

### 7.4 Wire up automatic builds (`.cpanel.yml`)

The project includes a `.cpanel.yml` file that runs `npm install` and `npm run build` automatically whenever cPanel pulls new code. It has a placeholder line that needs your real activation command from step 7.3:

1. Open `.cpanel.yml` and replace the placeholder line:
   ```
   source /home/REPLACE_ME/nodevenv/REPLACE_ME/20/bin/activate
   ```
   with the real one cPanel showed you.
2. Commit and push this change:
   ```bash
   git add .cpanel.yml
   git commit -m "Set cPanel Node.js activation path"
   git push
   ```
3. Back in cPanel's Git Version Control page for this repo, click **Pull or Deploy** > **Update from Remote**, then **Deploy HEAD Commit**. Watch the output - it should run `npm install` and `npm run build` and finish without errors.

**This is the single most fiddly step in the whole setup.** If it fails with `npm: command not found` or similar, the activation line is wrong - go back to the Node.js App screen in cPanel, copy the command it shows again (it's specific to your account, Node version, and app path), and re-check for typos.

4. Back on the **Setup Node.js App** screen, click **Restart** for your application.
5. Visit `https://mcp.novelsolar.com/health` in a browser. You should see `{"ok":true,"server":"novelsolar-bitrix24-mcp"}`. If you get a timeout or 502, the app isn't starting - check the app's log file (linked from the Node.js App screen) for the actual error.

---

## 8. Add it to Claude as a custom connector

**Honest assessment first:** this server implements a full, real OAuth 2.1 authorization flow (with Dynamic Client Registration and PKCE) purpose-built to match what Claude's remote-connector flow expects, per Anthropic's current documentation. This is the officially supported, generally-available path - not a workaround - and it's the same mechanism used by production remote MCP servers. It was tested end-to-end during development (registration, login, token exchange, and an authenticated tool call all verified working). That said, this is a from-scratch implementation, not a battle-tested SaaS product used by thousands of people, and it is running on hosting (Namecheap shared cPanel) that isn't purpose-built for this. If it doesn't connect on the first try, it's more likely to be a hosting hiccup (cold start, a bad activation path, a wrong `MCP_SERVER_URL`) than a fundamental flaw in the approach.

**Recommended order:**

1. **Try Claude Code first, if you have it**, since its command-line output shows you exactly what's failing if something goes wrong:
   ```bash
   claude mcp add --transport http novelsolar-bitrix24 https://mcp.novelsolar.com/mcp
   ```
   It will open a browser tab for the login step described below. If this works, claude.ai's web connector (which uses the same underlying protocol) is very likely to work too.

2. **Add it to claude.ai:** go to **Settings > Connectors > Add custom connector**. Enter:
   - **Name**: NovelSolar Bitrix24
   - **URL**: `https://mcp.novelsolar.com/mcp`
3. Click connect. Claude will redirect you to a plain login page hosted by your own server (not Bitrix24, not Claude) asking for a passphrase - type in the `MCP_LOGIN_PASSPHRASE` you set in step 5.
4. On success, you're redirected back to Claude and the connector should show as connected.

If it fails at this step, check (in this order): does `https://mcp.novelsolar.com/health` load in a plain browser tab? Does `MCP_SERVER_URL` in your `.env`/cPanel environment variables exactly match the URL you're connecting to (including `https://`, no trailing slash)? Is the SSL certificate valid (no browser warning)?

---

## 9. One read-only end-to-end test

Once connected, ask Claude something like:

> Using the NovelSolar Bitrix24 connector, list my 5 most recently created CRM deals.

This calls `bitrix_list_deals` - a read-only tool - and is a safe first check that the whole chain (Claude → OAuth token → your server → Bitrix24 webhook) works. If it returns real deals from your portal, everything is wired up correctly.

---

## 10. Rotating or revoking access

**If the Bitrix24 webhook URL leaks:**
1. In Bitrix24, go back to the inbound webhook settings and delete/regenerate it (Bitrix24 gives you a fresh URL; the old one stops working immediately).
2. Update `BITRIX24_WEBHOOK_URL` in your `.env` (or cPanel's environment variables screen).
3. Restart the app (cPanel's Node.js App screen > Restart).

**If you think someone else got hold of your login passphrase or a Claude session token:**
1. Change `MCP_LOGIN_PASSPHRASE` in your `.env`/cPanel environment variables and restart the app.
2. Delete the `data/oauth-tokens.json` and `data/oauth-clients.json` files on the server (via cPanel File Manager or SSH) to immediately invalidate every issued token and force a fresh login next time anything connects.
3. In claude.ai, remove and re-add the connector under **Settings > Connectors**.

---

## 11. What each tool does

**Read-only:**
- `bitrix_list_deals`, `bitrix_get_deal` - CRM deals
- `bitrix_list_items` - CRM Smart Process Automation (SPA) records
- `bitrix_get_fields` - discover valid field names for deals/SPA items
- `bitrix_list_catalogs` - list your product catalogs and their `iblockId`. **On your portal there are two: `14` "CRM Product Catalog" (~1,438 products) and `16` "CRM Product Catalog (offers)" (~46 - these are SKU-level variants of catalog 14, linked via `productIblockId`).**
- `bitrix_list_products` - product catalog. **Requires `iblockId`** (Bitrix24 rejects the call without one on any portal with more than one catalog, which is the case here) - use `14` for your main catalog.
- `bitrix_list_tasks` - tasks
- `bitrix_deal_analytics` - computed stage/won-lost aggregates over your deals (built by this server, not a raw Bitrix24 endpoint - see Limitations)
- `bitrix_bp_list_templates`, `bitrix_bp_list_instances` - business process templates and running instances
- `bitrix_list_employees`, `bitrix_list_departments` - company directory

**Write (all require `confirm: true` in the request, and Claude will show you what it's about to do):**
- `bitrix_add_deal`, `bitrix_update_deal` - create/edit a real CRM deal
- `bitrix_bp_start` - starts a real, live business process workflow (HIGH RISK - see Limitations)
- `bitrix_bp_add_template`, `bitrix_bp_update_template` - create/edit a business process template (VERY HIGH RISK - see Limitations)

---

## 12. LIMITATIONS & SECURITY

**What this can't do:**
- **Native "Absence Chart" / vacation/HR scheduling has no tool here.** Bitrix24 does not publish a REST API for this feature (confirmed during research - only generic work-schedule and time-tracking-report endpoints exist, which are not the same thing). If you need this, it isn't a build gap that can be quietly patched - it's a genuine absence of API surface on Bitrix24's side.
- **`bitrix_deal_analytics` is not Bitrix24's "BI Builder."** BI Builder is a dashboard-embedding feature (via Yandex DataLens) with no general-purpose query API. This tool instead pulls raw deals via `crm.deal.list` and aggregates them here - it's a real computation, just not a passthrough to Bitrix24's own reporting UI.
- Business-process write tools require the webhook's account to have admin rights in Bitrix24 (see step 4) - they will fail with a permissions error otherwise.

**Rate limits:** Bitrix24 asks integrations to stay under roughly 2 requests/second and will return a `QUERY_LIMIT_EXCEEDED` error if you exceed it. This server paces its own requests below that threshold and automatically retries with increasing delays if it gets rate-limited anyway (up to 5 attempts) rather than failing the tool call outright. Bitrix24 also enforces a separate cap: if a webhook's *cumulative* request execution time exceeds 480 seconds within any rolling 10-minute window, it's blocked for the rest of that window - heavy, repeated large list requests in a short burst could hit this; it resets on its own.

**Auth architecture, honestly:**
- This server implements its own minimal OAuth 2.1 authorization server (registration, login, token issuance) - there is exactly one real user (you), and "logging in" means typing the passphrase from `.env`. Bitrix24 credentials never touch this OAuth layer; they're only used server-side when actually calling Bitrix24's API.
- Registered OAuth clients and issued tokens are stored in plain JSON files under `data/` on the server (not a database, not encrypted at rest) - this is intentional given a single user, but it means anyone with file access to your hosting account has effectively the same access as a valid Claude session. Secure the hosting account itself (strong cPanel password, 2FA if Namecheap offers it) accordingly.
- Access tokens expire after 1 hour and silently refresh in the background via a refresh token, so you should only need to type the passphrase once per connector setup, not every hour.
- A basic brute-force guard blocks an IP address for 15 minutes after 5 failed passphrase attempts.

**Hosting caveats (Namecheap Stellar Plus specifically):**
- Possible cold-start delay after idle periods (see step 7).
- Node.js Selector availability on this specific plan tier wasn't fully confirmed from Namecheap's own documentation - verify it's present in your cPanel before relying on this path.
- If this ever becomes unreliable in practice, the code is portable - deploying the same repository to Railway (or any other Node.js host) instead is a matter of setting the same three environment variables and pointing `MCP_SERVER_URL` at the new address.

**If something needs a closer look:** the server's own error messages (surfaced back through Claude when a tool call fails) include Bitrix24's actual error code and description, which is usually enough to tell you whether it's a missing webhook scope, a bad field name, or a permissions issue.
