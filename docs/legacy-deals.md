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
Record. **No Action Needed currently has nothing routing to it** — see the
engine section.

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
| `ufCrm100Attempts` | integer | default **0**; incremented by the BP, never typed |
| `ufCrm100CallResult` | enum | written by the call task, drives routing |
| `UF_CRM_100_MAINTENANCE_NEEDED` | enum, multiple | which parts need maintenance |
| `UF_CRM_100_1789554916` | enum | Deal Type chosen at triage |
| `UF_CRM_100_REPAIR_CHILD_CREATED` | Y/N | spawn guard |
| `UF_CRM_100_MAINTENANCE_CHILD_CREATED` | Y/N | spawn guard |
| `UF_CRM_100_DEAL_CREATED` | Y/N | spawn guard |

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
| CCTV | 2716 |
| Borehole/Pump | 2718 |
| Floodlights/Streetlights | 2720 |
| Solar Generators | 2722 |
| Battery | 2724 |
| Inverter | 2726 |
| Panel | 2728 |
| OTHERS | 2770 |

**Record Source** — `ufCrm100RecordSource` (required): Paper Invoice 2704 ·
Spreadsheet 2706 · WhatsApp 2708 · Enterpriza 2772 · Odoo 2774

**Call Result** — `ufCrm100CallResult`: Reached 2742 · No Answer 2744 ·
Wrong Number 2746 · Declined 2748 · Call Later 2750

> Purchase Date, System Type and Record Source are all **required**, so any
> bulk load must supply all three or the row is rejected.

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

## The engine — BUILT

Two templates on `DYNAMIC_1222`, following the portal convention of a
`<Name> New` plus a master engine.

### Trigger

`Legacy Deals New` (**1006**) runs `AUTO_EXECUTE: "1"` — on record add.

`Legacy Deals Master Engine` (**1008**) is `AUTO_EXECUTE: "0"` on purpose. It
is started by a **"run workflow" robot on the Triaged stage** rather than by
on-modify. That matters: on-modify would re-fire the engine every time one of
its own Set Field steps wrote to the record, re-running every block and
spawning duplicate children. Firing from a stage-entry robot runs it once per
arrival at Triaged.

### Template 1006 — `Legacy Deals New`

1. **Set variable** `LDNo` from global variable *Legacy Deal No*
2. **Modify item** — `TITLE` = `NISL-LD-{=Variable:LDNo}`
3. **Modify global variable** — `={=Variable:LDNo} + 1`
4. **Request info** "Call this legacy client" → `CallResult` (required),
   `ServicesRequested` (multiple)
5. **Modify item** — writes Call Result, Requested Services, and
   `={=Document:UF_CRM_100_ATTEMPTS} + 1`
6. **Condition** on `UF_CRM_100_CALL_RESULT` → six branches

| Call result | → Stage |
|---|---|
| Reached | Triaged |
| No Answer | Call Later |
| Wrong Number | Invalid Record |
| Declined | Declined |
| *otherwise* | Call Later |

**Services Requested is required when the task is answered**, and the `None`
option was removed from both the field and the templates. That is a
deliberate decision with a consequence: an agent who reaches someone wanting
nothing must record it as **Declined**. Declined therefore covers both "not
interested" and "nothing needed right now", and **No Action Needed has
nothing routing to it** — it is inert, and should either be deleted from the
pipeline or repurposed as a hard "do not contact" outcome if that distinction
is ever wanted.

The earlier design had a second path — Reached with services set to `None` —
which overlapped Declined without any rule telling an agent which to pick.
Two stages reachable from the same conversation, chosen by feel, produce two
lists that mean nothing afterwards. One outcome, one field.

The counter read/use/write-back sits **above** the call task deliberately: the
workflow parks at that task for days, and a counter updated after it would
hand every record created in the meantime the same number.

### Template 1008 — `Legacy Deals Master Engine`

Outer condition on `STAGE_ID`, three stage branches: **Triaged**, **Call
Later**, and one on `PREPARATION` (titled "Unreachable", actually an
escalation: wait 14d → Call Later).

Inside **Triaged**, three *sibling* Condition blocks — not branches of one:

| Block | Condition | Action |
|---|---|---|
| Repair | contain Repair **AND** `REPAIR_CHILD_CREATED` = N | create Service Center (cat 54, `DT1104_54:NEW`) → set flag Y |
| Maintenance | contain Maintenance **AND** `MAINTENANCE_CHILD_CREATED` = N | ask maintenance type → create Maintenance (cat 30, `DT1058_30:NEW`) → set flag Y |
| Deal | contain New System **OR** Upgrade | nested condition `DEAL_CREATED` = N → ask Deal Type → create deal → set flag Y |

Then **Change stage → Routed**.

Both SPA children set `PARENT_ID_1222 = {=Document:ID}`.

**Deal routing** — the deal type is asked, not inferred:

| Answer | Pipeline | Entry stage |
|---|---|---|
| Installation Sales | 0 (default) | `NEW` |
| Product Sales | 4 | `C4:NEW` |
| Contract Sales | 2 | `C2:NEW` |

Inside **Call Later**: re-ask the call, write back with **merge on** so services
accumulate, then Triaged if reached, or wait 3d → call again → Unreachable if
still no answer.

### Three structural rules this template had to learn

**Sibling blocks, not branches, for independent tests.** `IfElseActivity` is
`if / else if / else` — the first matching branch runs and the rest are
skipped. Repair and Maintenance as two branches of one condition means a
client wanting both gets one. They must be separate Condition blocks. The
same portal already does this in *Product Sales Other Stages*, which checks
Battery / Inverter / Panel in three separate blocks for exactly this reason.

**Nest, do not mix AND with OR.** Condition rows join linearly with no
bracketing, so `A OR B AND C` is ambiguous. The deal guard is therefore an
outer condition (`contain New System OR Upgrade`) wrapping an inner one
(`Deal Created = No`).

**Guards are required once anything can re-enter Triaged.** Each block checks
its own `*_DONE` flag and sets it after creating. A single "children created"
flag is not enough when Requested Services is appended to rather than
replaced — the second call adds Maintenance to `[Repair]`, and without
per-service flags either the new service is blocked or the old one duplicates.

### Still open

- **`OverdueDate` on task activities is unused portal-wide** — no working
  example exists in any of the 102 templates, and the two `dateadd` forms that
  do exist (`DelayActivity.TimeoutTime`, `CrmCreateToDoActivity.Deadline`) use
  different syntax. Deliberately skipped; the portal's idiom for time pressure
  is `DelayActivity`, already used twice in 1008.
- **Deals cannot carry `PARENT_ID_1222`.** Parent fields belong to dynamic
  types; every other example on the portal runs the other way
  (`1214_PARENT_ID_2`). Deal traceability comes from the title (`NISL-LD-n`)
  and from the SPA's **CRM bindings → "Add linked items list to details
  form"** setting instead.
- **`BindToCurrentElement`** is exposed on both SPA create activities and is
  still empty — untested, possibly a cleaner link than `PARENT_ID_1222`.
- **Product rows** remain `ACCESS_DENIED` over REST even under app auth.
- **Purchase Date has no default** despite being required and despite the
  1-January convention.


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
