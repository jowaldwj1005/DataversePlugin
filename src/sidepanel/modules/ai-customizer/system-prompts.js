/**
 * AI Customizer — System prompts
 *
 * Builds context-aware system prompts for view/form modification.
 * Provider adapters are in provider-adapters.js (single source of truth).
 */

// ---------------------------------------------------------------------------
// View modification system prompt
// ---------------------------------------------------------------------------

/**
 * Build a system prompt for modifying a Dataverse saved query (view).
 * @param {{ viewName: string, entityLogicalName: string, entitySetName: string,
 *           layoutxml: string, fetchxml: string,
 *           attributes: Array<{LogicalName:string, DisplayName:string, AttributeType:string}>,
 *           relationships: Array<{SchemaName:string, ReferencedEntity:string, ReferencingEntity:string, ReferencedEntityNavigationPropertyName:string, ReferencingEntityNavigationPropertyName:string}> }} ctx
 * @returns {string}
 */
export function buildViewPrompt(ctx) {
  const attrLines = ctx.attributes
    .map(a => {
      const dn = a.DisplayName?.UserLocalizedLabel?.Label || '';
      return `  ${a.LogicalName} (${a.AttributeType})${dn ? ` — "${dn}"` : ''}`;
    })
    .join('\n');

  const relLines = ctx.relationships
    .map(r => {
      const dir = r.ReferencingEntity === ctx.entityLogicalName ? 'N:1' : '1:N';
      const related = dir === 'N:1' ? r.ReferencedEntity : r.ReferencingEntity;
      const nav = dir === 'N:1'
        ? r.ReferencingEntityNavigationPropertyName
        : r.ReferencedEntityNavigationPropertyName;
      return `  ${r.SchemaName} (${dir} → ${related}) nav: ${nav || '—'}`;
    })
    .join('\n');

  return `You are a Dataverse / Dynamics 365 customization assistant.
Your task: modify a Saved Query (view) based on the user's instruction.

## Rules
- Output ONLY a JSON object with two keys: "layoutxml" and "fetchxml".
- Use ONLY attributes that exist in the attribute list below.
- Use ONLY relationships from the relationship list below.
- Preserve existing columns the user did not mention unless they explicitly ask to remove them.
- layoutxml format: <grid name="resultset" object="..." jump="" select="1" icon="1" preview="1"><row name="result" id="${ctx.entityLogicalName}id"><cell name="..." width="..." /></row></grid>
- fetchxml format: standard FetchXML (<fetch><entity name="${ctx.entityLogicalName}">...</entity></fetch>).
- Every <cell name="X"> in layoutxml MUST have a matching <attribute name="X"> in fetchxml.
- For link-entity columns use: <cell name="navprop.attributename" width="..." />
- Default column widths: 150 for text/string, 100 for numbers/dates/booleans, 200 for lookups.
- Never invent attribute logical names. If the user asks for a field that doesn't exist, reply with: { "error": "Attribute 'X' not found" }.
- Do NOT wrap the JSON in markdown code fences. Return raw JSON only.

## Current View: "${ctx.viewName}"
Entity: ${ctx.entityLogicalName} (EntitySet: ${ctx.entitySetName})

### Current layoutxml:
${ctx.layoutxml}

### Current fetchxml:
${ctx.fetchxml}

### Available Attributes:
${attrLines}

### Available Relationships:
${relLines || '  (none)'}`;
}
