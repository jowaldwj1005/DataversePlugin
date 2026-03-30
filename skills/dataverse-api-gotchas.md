# Skill: Dataverse Web API Gotchas

Key facts that have caused bugs in this codebase. Read before touching any API query.

## 1. `api-client.request()` returns unwrapped data

`DataverseClient.request()` already throws on failure and returns `response.data` directly.
Modules must NOT check `response.success` or `response.ok`, and must NOT do `response.data || response`.

```js
// WRONG
const response = await this.api.request('GET', 'accounts');
if (!response.success && !response.ok) throw new Error(response.error);
const data = response.data || response;

// CORRECT
const data = await this.api.request('GET', 'accounts');
const records = data.value || [];
```

## 2. `$select` on `/Attributes` — base type only

`EntityDefinitions(LogicalName='x')/Attributes` returns the base `AttributeMetadata` OData type.
You can only `$select` properties defined on that base type:
- `LogicalName`, `DisplayName`, `AttributeType`, `SchemaName`, `RequiredLevel`, `IsPrimaryId`, `IsPrimaryName`, `Description`, `IsCustomAttribute`

Type-specific properties (`MaxLength`, `MinValue`, `MaxValue`, `Precision`, `Format`, `OptionSet`) require a type-cast URL:
```
/Attributes/Microsoft.Dynamics.CRM.StringAttributeMetadata?$select=LogicalName,MaxLength
```
Or fetch the full attribute separately:
```
/Attributes(LogicalName='name')/Microsoft.Dynamics.CRM.StringAttributeMetadata
```

## 3. Role privilege depth — use `RetrieveRolePrivilegesRole`

Both `roleprivileges_association` and `roleprivilegesdepthmask` fail to return usable depth data.
Use the purpose-built Dataverse function instead:

```
GET /RetrieveRolePrivilegesRole(RoleId=@p)?@p={roleId}
```

Returns:
```json
{
  "RolePrivileges": [
    { "PrivilegeId": "...", "PrivilegeName": "prvReadAccount", "Depth": "Global" }
  ]
}
```

`Depth` is a string: `"Basic"` (User) | `"Local"` (BU) | `"Deep"` (Parent:Child BU) | `"Global"` (Org).
Map to ACCESS_LEVELS: `{ Basic: 1, Local: 2, Deep: 4, Global: 8 }`.

## 4. `$orderby` not supported on metadata endpoints

Endpoints under `EntityDefinitions`, `/Attributes`, `/Relationships` etc. reject `$orderby`.
Sort client-side with `.sort((a, b) => a.LogicalName.localeCompare(b.LogicalName))`.

## 5. Service worker can be killed by Chrome

MV3 service workers are killed after ~30 seconds of inactivity. `activeEnv` (in-memory) is lost.
Always restore from `chrome.storage.session` at the start of `proxyApiRequest`:
```js
if (!activeEnv) {
  const stored = await chrome.storage.session.get('activeEnv');
  if (stored.activeEnv) activeEnv = stored.activeEnv;
}
```

## 6. Content scripts orphaned after extension reload (dev mode)

After reloading the extension unpacked, existing tabs' content scripts lose their extension connection.
Recovery: use `chrome.scripting.executeScript()` to re-inject on-demand when `sendMessage` fails.
Requires `"scripting"` permission in manifest.

## 7. FetchXML via OData URL

FetchXML queries go through GET with `?fetchXml={encodeURIComponent(xml)}`:
```
GET /accounts?fetchXml=%3Cfetch%20...%3E
```
The entity set name in the URL must match `<entity name="account">` → `EntitySetName` from metadata.
