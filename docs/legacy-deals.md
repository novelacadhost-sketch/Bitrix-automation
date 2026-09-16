# Legacy Deals — build spec and reference

Outreach pipeline for customers who bought from us **before Bitrix24**. One
record per historical system sold. Staff fill the form in Bitrix, a workflow
task tells them to call the client, and the recorded outcome routes the
client into the appropriate existing process.

Built 2026-09-11. Everything under "What exists" is live on the portal.
Everything under "Still to build" is not.

---

## What exists

### The SPA

| Property | Value |
|---|---|
| Title | Legacy Deals |
| **Type id** (`crm.type.*`) | **100** |
| **entityTypeId** (`crm.item.*`, `crm.category.*`) | **1222** |
| Custom section | 4 — Client Services |
| Default category (pipeline) | 130 |
| Stage `ENTITY_ID` | `DYNAMIC_1222_STAGE_130` |
| Userfield entity id | `CRM_1222` |

Enabled: client binding, product rows, stages, automation, business
processes, documents, recycle bin, counters. Categories are off
deliberately — one pipeline, with Branch as a filterable field, because 49+
branches as separate pipelines would be unusable.

> **The type has two different ids and they are not interchangeable.**
> `crm.type.get/update` take `id` = **100**. `crm.item.*` and
> `crm.category.*` take `entityTypeId` = **1222**. Custom fields are named
> from the *type id*, hence `UF_CRM_100_*`. Passing the wrong number returns
> "Smart Process Automation was not found", which reads like the type does
> not exist rather than like a wrong identifier.

### Stages

`SYSTEM: Y` stages can be renamed but never deleted. A pipeline may have
only **one** success stage, but any number of failure stages — which is why
the dead ends are modelled separately rather than collapsed into one
"failed" bucket. They need completely different follow-up: *No Action
Needed* gets re-touched in a year, *Unreachable* gets tried on another
channel, *Declined* gets left alone.

| Stage ID | `STATUS_ID` | Sort | Semantics | System |
|---|---|---|---|---|
| 1266 | `DT1222_130:NEW` | 10 | in progress | **Y** |
| 1268 | `DT1222_130:PREPARATION` | 20 | in progress | N |
| 1270 | `DT1222_130:CLIENT` | 30 | in progress | N |
| 1296 | `DT1222_130:TRIAGED` | 35 | in progress | N |
| 1272 | `DT1222_130:SUCCESS` | 40 | **S** (success) | **Y** |
| 1298 | `DT1222_130:NOACTION` | 45 | F | N |
| 1300 | `DT1222_130:UNREACHABLE` | 46 | F | N |
| 1302 | `DT1222_130:INVALID` | 47 | F | N |
| 1274 | `DT1222_130:FAIL` | 50 | F | **Y** |

Display names in order: To Contact → Attempting Contact → Call Later →
Triaged → Routed, then Declined, No Action Needed, Unreachable, Invalid
Record.

### Custom fields

All on `CRM_1222`. API names are camelCase; `upperName` is the underlying
column.

| API name | Type | Notes |
|---|---|---|
| `ufCrm100PurchaseDate` | date | **REQUIRED** — see convention below |
| `ufCrm100SystemType` | enum, **multiple** | |
| `ufCrm100ReqServices` | enum, **multiple** | drives routing |
| `ufCrm100SystemCapacity` | string | e.g. 2.5kVA |
| `ufCrm100Branch` | iblock_element | **IBLOCK_ID 28**, stores element ids |
| `ufCrm100RecordSource` | enum | |
| `ufCrm100InstallAddress` | string | |
| `ufCrm100NextAction` | date | powers Call Later |
| `ufCrm100Attempts` | integer | should be automation-maintained, not typed |

**Requested Services** — `ufCrm100ReqServices`

| Option | ID |
|---|---|
| New System | 2730 |
| Upgrade | 2732 |
| Repair | 2734 |
| Maintenance | 2736 |

**System Type** — `ufCrm100SystemType`

| Option | ID |
|---|---|
| Full System (LITHIUM) | 2710 |
| Full System (TUBULAR) | 2712 |
| Full System (SMF) | 2714 |
| `CCTV ` (note trailing space) | 2716 |
| Borehole/Pump | 2718 |
| Floodlights/Streetlights | 2720 |
| Solar Generators | 2722 |
| Battery | 2724 |
| Inverter | 2726 |
| Panel | 2728 |

**Record Source** — `ufCrm100RecordSource`: Paper Invoice 2704 ·
Spreadsheet 2706 · WhatsApp 2708

### Client binding

Use **`contactIds`** (multiple). `contactId` still works but is flagged
`isDeprecated` by the API.

### Relations

Legacy Deals is the parent of Deal (2), Maintenance (1058) and Service
Center (1104); Contact (3) and Company (4) are its parents.

> `isChildrenListEnabled` came back `"N"` on all three despite being sent as
> `"Y"` — Bitrix silently downgraded it. The relations work, but a Legacy
> Deals record will not *display* its spawned children until that box is
> ticked in the relation settings in the UI. Worth doing: without it there
> is no trace connecting a repair in October and a maintenance visit in
> January back to the same outreach call.

---

## Design decisions worth not re-litigating

**Outcome is a field, not a stage.** A record sits in exactly one stage, but
a client can want a repair *and* a maintenance plan *and* a bigger system.
Modelling outcomes as stages silently forces an either/or. Stages describe
where the *conversation* is; `ufCrm100ReqServices` describes what the client
wants, and it is multi-select for exactly this reason.

**System Type is denormalised on purpose.** Product rows carry the real
SKUs, but filtering SPA records by product-row contents is painful in both
the UI and REST. Campaigns ("everyone with an inverter, call about
maintenance") filter on System Type instead.

**Installation (1062) is not a routing target.** Installation is a *service
product* that has to be sold on a deal first — product 212, "Inverter, Solar
Panel & Battery Installation", ₦40,000. So a client wanting a new system or
an upgrade goes to **Deal**, and Installation follows from the won deal
through the existing process.

**Undated records still get called.** Purchase Date is mandatory, and legacy
paperwork often has no reliable date. Convention: **1 January of the
best-known year**, with Record Source flagging the uncertainty. Do not let
people enter *today* — it looks real and is worse than an obvious
placeholder. This needs to be written into the field hint where staff can
see it, not just here.

---

## Still to build

### Routing table

| Requested Service | Target |
|---|---|
| New System (2730) | **Deal** — C4 sales pipeline |
| Upgrade (2732) | **Deal** — C4 sales pipeline |
| Repair (2734) | **Service Center** — entityTypeId 1104 |
| Maintenance (2736) | **Maintenance** — entityTypeId 1058 |

### Template 1 — `Legacy Deals New` — BUILT (template id 1000)

Document type `DYNAMIC_1222`. Currently `AUTO_EXECUTE` = `"0"` (manual only)
so it can be tested with bizproc.workflow.start before going live; set it to
`"1"` (on add) once verified.

Follows the portal's existing convention: every SPA here has a `<Name> New`
(on add), a `<Name> Update` / `Master Engine (When Changed)` (on change), and
a `<Name> Other Stages` (manual). **Model it on template 448, "Maintenance
Master Engine (When Changed)"** — it already does this exact shape.

**1. Request Information activity** — "Call Client & Log Call Outcome"

- Assigned to: `{=Document:ASSIGNED_BY_ID}` — the record's responsible
  person, so branches call their own customers
- Show comment: yes, labelled **Notes**
- Status message: "Waiting for call outcome"

| Task field | Type | Options |
|---|---|---|
| Call Result | select, **required** | Reached · No Answer · Wrong Number · Declined · Call Later |
| Services Requested | select, **multiple** | New System · Upgrade · Repair · Maintenance |

**2. Condition** branching on the Call Result variable:

| Branch | → Stage |
|---|---|
| Reached | `DT1222_130:TRIAGED` |
| No Answer | `DT1222_130:CLIENT` (Call Later) |
| Wrong Number | `DT1222_130:INVALID` |
| Declined | `DT1222_130:FAIL` |
| *otherwise* (Call Later) | `DT1222_130:CLIENT` |

Two deliberate simplifications: **No Answer goes to Call Later, not
Unreachable** — one missed call should not write a customer off; escalation
stays manual until attempt-count logic exists. And **No Action Needed is not
reachable from this template** — "reached, wants nothing" belongs in the
Triaged step below.

### Template 2 — `Legacy Deals Master Engine (When Changed)`

`AUTO_EXECUTE` = on change (**2**). Branches on `STAGE_ID`.

On entry to `DT1222_130:TRIAGED`, read `ufCrm100ReqServices` and spawn one
child per selected option per the routing table, setting the parent field so
the children trace back. Then move the record to `DT1222_130:SUCCESS`
(Routed). If no services are selected, move to `DT1222_130:NOACTION`.

Useful activities, all confirmed present on this portal: `CrmCopyDynamicActivity`
(create a child SPA record), `CrmChangeStatusActivity` (move stage),
`SetFieldActivity`, `DelayActivity`, `Task2Activity`, `IMNotifyActivity`,
`CrmTimelineCommentAdd`, `CrmUpdateDynamicActivity`.

### Open questions

- **`CATEGORY_ID: "0"`** on the four stages added over REST (1276, 1278,
  1280, 1282), where Bitrix's own five carry `"130"`. `ENTITY_ID` is correct
  so they appear in the right pipeline, but this may make a kanban filter or
  automation trigger skip them. Settle it by walking test record **id 2**
  through Triaged → Routed and watching. Fix if needed:
  `bitrix_update_stage` with `CATEGORY_ID: 130`.
- **Can Set Field map the task's Services Requested labels onto the
  enumeration IDs?** The field wants 2730–2736, the task returns text. If
  not, the staff member sets the field on the record and the task captures
  the outcome only.
- **Product rows are unreadable over REST** — `crm.item.productrow.list`
  returns `ACCESS_DENIED` even for a plain deal, and even as an
  admin-authorised app. Product access is a separate permission from CRM
  entity access in Bitrix; check CRM → Settings → Access permissions. People
  can still attach products through the UI — this only blocks automation and
  reporting. Also unresolved: the correct `ownerType` code for a dynamic
  type (`T1222` and `T100` both return `ENTITY_TYPE_NOT_SUPPORTED`).

---

## REST gotchas found the hard way

Each of these cost real time. None are documented clearly.

- **`crm.item.list` returns `{items: [...]}`, not a bare array.** The pager
  needs `resultKey: 'items'` or it sees a non-array, stops on the first page
  and returns `total: 0` **with no error** — a convincingly empty result for
  a populated SPA. Fixed in `src/tools/crm.ts`.
- **Nigerian phone numbers defeat duplicate detection.** Bitrix matches the
  stored string, and this portal holds the same subscriber as `+234…`,
  `0…`, and the malformed `+2340…` (country code *and* trunk zero, 14
  digits — e.g. contact 4886). A check on the correct national form reports
  "no duplicate" for someone already in the CRM. `bitrix_find_duplicate_contacts`
  probes all forms; see `src/tools/contacts.ts`.
- **`userfieldconfig.add` needs portal admin**, not just CRM admin. A
  limited webhook gets "You are not allowed to create custom fields".
- **`bizproc.workflow.template.add` cannot be called by a webhook at all** —
  "Access denied! Application context required", regardless of rights. It
  needs a local application's OAuth token. Hence `BITRIX24_AUTH_MODE=app`.
- **`crm.status.add` silently orphans a stage unless you pass `CATEGORY_ID`
  AND sort it into the right zone.** This cost a day. A stage created
  without `CATEGORY_ID` gets `0` instead of the pipeline's id. Records still
  move into it by `crm.item.update`, the kanban still shows it, and
  filtering by `stageId` still works - so every check short of a business
  process says it is fine. But **bizproc validates that the target stage
  belongs to the record's category and refuses silently when it does not**,
  so `CrmChangeStatusActivity` completes with no error and no stage change.
  `crm.status.update` accepts `CATEGORY_ID` and returns `updated: true`
  while ignoring it, so the only repair is delete and re-add.

  Sort order is not cosmetic either, and the two rules conflict:
  - an in-progress stage must sort **before** the success stage, else the
    add is refused outright ("Cannot create more stages after the final stage")
  - a stage with `SEMANTICS: "F"` must sort **after** it, else the add is
    refused with "Cannot add semantics with the specified sort order"

  So failure stages belong between the success stage and the system FAIL
  stage (here 45-47, between 40 and 50). Getting this wrong was how the
  original three failure stages ended up at `CATEGORY_ID: 0`.

- **BP templates CAN be created over REST** - but `TEMPLATE_DATA` is not
  what `.list` gives you. It is base64 of a PHP-serialized **six-key
  wrapper**:

  ```
  { VERSION: 2, TEMPLATE: [...activities...],
    PARAMETERS, VARIABLES, CONSTANTS, DOCUMENT_FIELDS }
  ```

  `.list` returns only the inner `TEMPLATE` array, so a template read back
  from the API is missing the wrapper and cannot be re-submitted - which is
  why a byte-faithful copy of a working template is rejected with a bare
  "Incorrect workflow template". Send the wrapper and it succeeds.
  `DOCUMENT_FIELDS` may be empty. `AUTO_EXECUTE` must be a **string**
  (`"0"`, not `0`), and app auth is required - a webhook is refused outright
  with "Application context required".

  The wrapper was recovered from a **.bpt export** (the UI's export button),
  which is exactly `zlib(php_serialize(wrapper))`. Use
  `scripts/bp-template.js` to inspect an export or build a payload; if the
  format ever changes, export any template and run `inspect` on it.
- **A local app's install hook may never fire.** Bitrix will not re-run the
  install path for an app it already considers installed, so
  `/bitrix/install` was never called. The reliable route is the
  authorization-code flow at **`/bitrix/connect?secret=…`**, which depends
  only on an admin opening a URL and approving. Use that to re-authorise if
  the token is ever lost.
- **Refresh tokens rotate.** Every refresh invalidates the previous token, so
  two services sharing one local app will silently revoke each other. Every
  deployment needs its own app. The rotated token lives in
  `MCP_DATA_DIR/bitrix-oauth.json` — on Railway that must be a mounted
  volume.

## Reference data

- **Branch registry**: IBLOCK_ID 28, 52 elements, read with
  `bitrix_list_iblock_elements`. Carries account number, address, phone,
  email and a manager reference per branch. Examples: 9304 Bodija Branch
  Ibadan · 6432 Tokunbo Branch Ibadan · 6434 Akinjide Branch Ibadan · 9318
  Akure. **These do not map one-to-one onto the 49 warehouses in
  `catalog.store.list`** — different vocabularies, similar names. Do not
  assume they join.
- **Product catalog**: iblock 14 (main, 1,108 products), iblock 16 (offers).
- **Deal pipelines in play**: C4 (sales), C30.
- **Test record**: Legacy Deals **id 2**, "TEST — Legacy Deal (safe to
  delete)", parked in To Contact, bound to contact 4890. Recycle bin is on.
