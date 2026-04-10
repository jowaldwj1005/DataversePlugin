/**
 * ERD Pro — Progressive data loading
 * @module erd-pro/data-loader
 */

import { SYSTEM_FIELD_NAMES, SYSTEM_ATTR_TYPES, MAX_KEY_FIELDS } from './constants.js';
import { isSystemNoise } from './helpers.js';

export class DataLoader {
  #api;
  #cache;
  #state;

  constructor(apiClient, metadataCache, state) {
    this.#api = apiClient;
    this.#cache = metadataCache;
    this.#state = state;
  }

  /** Fetch unmanaged solutions and store in state. */
  async loadSolutions() {
    try {
      const response = await this.#api.request('GET',
        'solutions?$select=friendlyname,uniquename,version,ismanaged&$filter=ismanaged eq false'
      );
      const solutions = (response.value || []).sort((a, b) =>
        (a.friendlyname || '').localeCompare(b.friendlyname || ''));
      this.#state.set('solutions', solutions);
      return solutions;
    } catch (err) {
      throw new Error(`Failed to load solutions: ${err.message}`);
    }
  }

  /**
   * Full loading pipeline for a solution.
   * Progressive: entities first, then relationships + fields in batches.
   * @param {string} uniqueName
   * @param {(msg: string) => void} onProgress
   */
  async loadSolution(uniqueName, onProgress = () => {}) {
    this.#state.resetData();
    this.#state.set('solutionName', uniqueName);
    this.#state.set('loading', true);

    try {
      // Phase 1: Fetch entities (instant from cache if warm)
      onProgress('Loading entities…');
      const entities = await this.#loadEntities(uniqueName);
      this.#state.set('entities', entities);

      // Phase 2: Relationships in batches (no entity cap)
      const entityNames = new Set(entities.map(e => e.LogicalName));
      onProgress(`Loading relationships… 0/${entities.length}`);
      await this.#loadRelationshipsBatched(entities, entityNames, onProgress);

      // Build adjacency
      this.#buildAdjacency();
      this.#state.set('adjacency', this.#state.adjacency);

      // Phase 3: Fields in batches
      onProgress(`Loading fields… 0/${entities.length}`);
      await this.#loadFieldsBatched(entities, onProgress);

    } finally {
      this.#state.set('loading', false);
    }
  }

  // --- Phase 1: Entities ---

  async #loadEntities(uniqueName) {
    const compResp = await this.#api.request('GET',
      `solutioncomponents?$filter=solutionid/uniquename eq '${uniqueName}' and componenttype eq 1&$select=objectid`
    );
    const objectIds = (compResp.value || []).map(c => c.objectid).filter(Boolean);
    if (!objectIds.length) throw new Error('No entities found in this solution');

    const allEntities = await this.#cache.getEntities();
    let matched = allEntities.filter(e => objectIds.includes(e.MetadataId));
    if (!matched.length) matched = allEntities.slice(0, 30);
    return matched;
  }

  // --- Phase 2: Relationships (batched, no cap) ---

  async #loadRelationshipsBatched(entities, entityNames, onProgress) {
    const BATCH = 10;
    const rawOneToMany = [];
    const rawManyToMany = [];

    for (let i = 0; i < entities.length; i += BATCH) {
      const batch = entities.slice(i, i + BATCH);
      await Promise.all(batch.map(async (ent) => {
        try {
          const rels = await this.#cache.getRelationships(ent.LogicalName);
          for (const rel of rels.OneToMany) {
            if (entityNames.has(rel.ReferencingEntity)) rawOneToMany.push(rel);
          }
          if (rels.ManyToMany) {
            for (const rel of rels.ManyToMany) {
              if (entityNames.has(rel.Entity1LogicalName) && entityNames.has(rel.Entity2LogicalName)) {
                rawManyToMany.push(rel);
              }
            }
          }
        } catch { /* skip per-entity errors */ }
      }));
      onProgress(`Loading relationships… ${Math.min(i + BATCH, entities.length)}/${entities.length}`);

      // Incremental: normalize and update state after each batch
      this.#normalizeRelationships(rawOneToMany, rawManyToMany);
      this.#state.set('relationships', this.#state.relationships);
    }
  }

  #normalizeRelationships(oneToMany, manyToMany) {
    const seen = new Set();
    const rels = [];

    for (const rel of oneToMany) {
      if (seen.has(rel.SchemaName)) continue;
      seen.add(rel.SchemaName);
      rels.push({
        schemaName: rel.SchemaName,
        type: '1:N',
        sourceEntity: rel.ReferencedEntity,
        targetEntity: rel.ReferencingEntity,
        sourceAttribute: rel.ReferencedAttribute,
        targetAttribute: rel.ReferencingAttribute,
        intersectEntity: null,
        navPropertyName: rel.ReferencingEntityNavigationPropertyName || '',
      });
    }

    for (const rel of manyToMany) {
      if (seen.has(rel.SchemaName)) continue;
      seen.add(rel.SchemaName);
      rels.push({
        schemaName: rel.SchemaName,
        type: 'N:N',
        sourceEntity: rel.Entity1LogicalName,
        targetEntity: rel.Entity2LogicalName,
        sourceAttribute: rel.Entity1IntersectAttribute || '',
        targetAttribute: rel.Entity2IntersectAttribute || '',
        intersectEntity: rel.IntersectEntityName || '',
        navPropertyName: rel.Entity1NavigationPropertyName || '',
      });
    }

    this.#state.relationships = rels;
  }

  // --- Phase 3: Fields (batched) ---

  async #loadFieldsBatched(entities, onProgress) {
    const BATCH = 10;
    for (let i = 0; i < entities.length; i += BATCH) {
      const batch = entities.slice(i, i + BATCH);
      await Promise.all(batch.map(ent => this.#loadEntityFields(ent)));
      onProgress(`Loading fields… ${Math.min(i + BATCH, entities.length)}/${entities.length}`);
      // Signal update so renderer can resize entities
      this.#state.set('entityKeyFields', this.#state.entityKeyFields);
    }
  }

  async #loadEntityFields(ent) {
    if (this.#state.entityKeyFields.has(ent.LogicalName)) return;
    try {
      const attrs = await this.#cache.getAttributes(ent.LogicalName);
      const keyFields = [];
      const allFields = [];

      const makeField = (attr, isPk, isLookup) => ({
        name: attr.LogicalName,
        displayName: attr.DisplayName?.UserLocalizedLabel?.Label || attr.LogicalName,
        type: attr.AttributeType || 'String',
        isPk,
        isLookup,
        required: attr.RequiredLevel?.Value === 'ApplicationRequired' || attr.RequiredLevel?.Value === 'SystemRequired',
      });

      // PK
      const pk = attrs.find(a => a.LogicalName === ent.PrimaryIdAttribute);
      if (pk) keyFields.push(makeField(pk, true, false));

      // Primary name
      const pn = attrs.find(a => a.LogicalName === ent.PrimaryNameAttribute);
      if (pn) keyFields.push(makeField(pn, false, false));

      // Lookup name set for derived-field detection
      const lookupNames = new Set();
      for (const attr of attrs) {
        const t = attr.AttributeType;
        if (t === 'Lookup' || t === 'Owner' || t === 'Customer') lookupNames.add(attr.LogicalName);
      }

      // Key fields: non-system, non-noise
      const keyRest = [];
      for (const attr of attrs) {
        if (attr.LogicalName === ent.PrimaryIdAttribute || attr.LogicalName === ent.PrimaryNameAttribute) continue;
        if (isSystemNoise(attr, lookupNames)) continue;
        const t = attr.AttributeType;
        const isLookup = t === 'Lookup' || t === 'Owner' || t === 'Customer';
        keyRest.push(makeField(attr, false, isLookup));
      }
      keyRest.sort((a, b) => a.displayName.localeCompare(b.displayName));
      keyFields.push(...keyRest);

      // All fields for expanded view
      if (pk) allFields.push(makeField(pk, true, false));
      if (pn) allFields.push(makeField(pn, false, false));
      const rest = attrs
        .filter(a => a.LogicalName !== ent.PrimaryIdAttribute &&
                     a.LogicalName !== ent.PrimaryNameAttribute &&
                     !SYSTEM_ATTR_TYPES.has(a.AttributeType))
        .sort((a, b) => (a.DisplayName?.UserLocalizedLabel?.Label || a.LogicalName)
          .localeCompare(b.DisplayName?.UserLocalizedLabel?.Label || b.LogicalName));
      for (const attr of rest) {
        const t = attr.AttributeType;
        const isLookup = t === 'Lookup' || t === 'Owner' || t === 'Customer';
        allFields.push(makeField(attr, false, isLookup));
      }

      this.#state.entityKeyFields.set(ent.LogicalName, keyFields);
      this.#state.entityAllFields.set(ent.LogicalName, allFields);
    } catch {
      this.#state.entityKeyFields.set(ent.LogicalName, []);
      this.#state.entityAllFields.set(ent.LogicalName, []);
    }
  }

  // --- Adjacency ---

  #buildAdjacency() {
    const adj = this.#state.adjacency;
    adj.clear();
    for (const ent of this.#state.entities) adj.set(ent.LogicalName, new Set());
    for (const rel of this.#state.relationships) {
      adj.get(rel.sourceEntity)?.add(rel.targetEntity);
      adj.get(rel.targetEntity)?.add(rel.sourceEntity);
    }
  }
}
