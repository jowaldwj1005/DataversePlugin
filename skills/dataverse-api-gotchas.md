# Skill: Dataverse Web API — Common Traps

Use this when building any client that queries the Dataverse Web API.
These are non-obvious behaviours that are not clearly documented and cause real bugs.

---

## 1. `$orderby` is rejected on all metadata endpoints

`EntityDefinitions`, `/Attributes`, `/Relationships`, `/Keys` — all reject `$orderby` with a 400 error.
Sort client-side:

```js
const attrs = data.value || [];
attrs.sort((a, b) => a.LogicalName.localeCompare(b.LogicalName));
```

---

## 2. `$select` on `/Attributes` — base type properties only

`EntityDefinitions(LogicalName='x')/Attributes` returns the base `AttributeMetadata` OData type.
Allowed `$select` fields: `LogicalName`, `DisplayName`, `AttributeType`, `SchemaName`,
`RequiredLevel`, `IsPrimaryId`, `IsPrimaryName`, `Description`, `IsCustomAttribute`.

Type-specific properties (`MaxLength`, `MinValue`, `MaxValue`, `Precision`, `Format`, `OptionSet`)
require a type-cast URL:

```
GET /EntityDefinitions(LogicalName='account')/Attributes/Microsoft.Dynamics.CRM.StringAttributeMetadata
    ?$select=LogicalName,MaxLength
```

Or fetch one attribute individually:

```
GET /EntityDefinitions(LogicalName='account')/Attributes(LogicalName='name')
    /Microsoft.Dynamics.CRM.StringAttributeMetadata
```

---

## 3. Role privilege depth — use `RetrieveRolePrivilegesRole`

`roleprivileges_association` and `roleprivilegesdepthmask` both return incomplete or unusable depth data.
The purpose-built OData function is the only reliable source:

```
GET /RetrieveRolePrivilegesRole(RoleId=@p)?@p=<roleGuid>
```

Response shape:
```json
{
  "RolePrivileges": [
    { "PrivilegeId": "guid", "Depth": "Global", "BusinessUnitId": "guid" }
  ]
}
```

**Note**: The response does NOT include `PrivilegeName`. To resolve names, query `privileges`
with a `$filter` on `privilegeid`:
```
GET /privileges?$select=privilegeid,name&$filter=privilegeid eq <guid> or privilegeid eq <guid>
```
Privilege names follow the pattern `prv` + Operation + EntityName (e.g. `prvReadAccount`).

`Depth` is a string — never a number. Map to access level integers:
```js
const DEPTH = { Basic: 1, Local: 2, Deep: 4, Global: 8 };
```

---

## 4. User privilege depth — use `RetrieveUserPrivileges`

For all privileges a specific user holds (across direct roles + team roles):

```
GET /RetrieveUserPrivileges(UserId=@p)?@p=<userGuid>
```

Same `RolePrivileges[].PrivilegeId` / `.Depth` shape as above (no `PrivilegeName`).
Resolve names via `privileges` endpoint, then parse to extract operation and entity:
- `"prvCreateAccount"` → op: `Create`, entity: `account`
- `"prvAppendToAccount"` → op: `AppendTo`, entity: `account`
- Match operations longest-first to avoid `Append` swallowing `AppendTo`

---

## 5. FetchXML via OData — entity set name required in URL

FetchXML queries are sent as a query string parameter, not as a POST body:

```
GET /api/data/v9.2/accounts?fetchXml=%3Cfetch%20...%3E
```

The URL segment (`accounts`) must be the **EntitySetName** — not the LogicalName.
`account` (LogicalName) → `accounts` (EntitySetName) — but custom entities are unpredictable.
Always fetch `EntitySetName` from metadata: `EntityDefinitions(LogicalName='x')?$select=EntitySetName`.

---

## 6. N:N relationships cannot be `$expand`ed

OData v4 `$expand` works for 1:N and N:1 navigation properties, but **not for N:N** intersect entities.
There is no standard navigation property for N:N that supports `$expand`.
Use FetchXML `<link-entity>` for N:N joins — it's the only supported path.

---

## 7. `$batch` response is `multipart/mixed` — parse boundary manually

The response to `POST $batch` has `Content-Type: multipart/mixed; boundary="..."`.
Parse the boundary from the header, then split the body on `--{boundary}`.
Each part contains its own status line, headers, and JSON body.

```js
const boundary = contentType.match(/boundary="?([^";]+)"?/)[1];
const parts = body.split(`--${boundary}`).slice(1, -1);
```

JSON.parse does not work on the raw response.

---

## 8. N:N expand via navigation property — field security profiles

For N:N associations where you need members of a set, use the **nav property on one side**
rather than `$expand` with a nested `$filter` (which is unreliable in Dataverse):

```
GET /systemusers(<userId>)/systemuserprofiles_association?$select=fieldsecurityprofileid,name
```

This is more reliable than:
```
GET /fieldsecurityprofiles?$expand=systemuserprofiles_association($filter=systemuserid eq <id>)
```

---

## 9. Custom Actions/Functions are in `customapis`, not `sdkmessage`

Unmanaged custom actions and functions registered with the Custom API framework:

```
GET /customapis?$select=uniquename,displayname,isfunction,boundentitylogicalname
```

Request parameters:
```
GET /customapirequestparameters?$filter=customapiid/uniquename eq '<name>'&$select=uniquename,name,type,isoptional
```

Response properties:
```
GET /customapiresponseproperties?$filter=customapiid/uniquename eq '<name>'&$select=uniquename,name,type
```

Bound APIs (on an entity): `boundentitylogicalname` is not null. The `isboundapi` field does NOT exist in the OData schema — use `boundentitylogicalname eq null` / `ne null` to filter instead.
