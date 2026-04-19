/**
 * ERD v2 — dagre-based hierarchical layout
 *
 * Uses @dagrejs/dagre v3 for proper Sugiyama layout with
 * Brandes-Kopf coordinate assignment. Layout is computed
 * for ACTUAL entity dimensions (220px wide, height from field count)
 * so entities never overlap at any zoom level.
 *
 * @module erd-v2/layout-engine
 */

import { Graph, layout } from '../../lib/dagre.esm.js';
import { ENTITY_W, MAX_KEY_FIELDS } from './constants.js';
import { entityHeight } from './helpers.js';

export class LayoutEngine {
  #state;

  constructor(state) {
    this.#state = state;
  }

  /**
   * Run dagre layout. Updates state.positions and state.entitySizes.
   */
  compute() {
    const entities = this.#state.entities;
    if (entities.length === 0) return;

    const g = new Graph();
    g.setGraph({
      rankdir: 'TB',     // top-to-bottom hierarchy
      nodesep: 60,        // horizontal gap between nodes in same rank
      ranksep: 100,       // vertical gap between ranks
      marginx: 20,
      marginy: 20,
    });
    g.setDefaultEdgeLabel(() => ({}));

    // Add nodes with ACTUAL dimensions
    for (const ent of entities) {
      const name = ent.LogicalName;
      const fields = this.#getVisibleFields(name);
      const h = entityHeight(fields.length);
      g.setNode(name, { width: ENTITY_W, height: h });
    }

    // Add edges — 1:N relationships drive the hierarchy
    const nameSet = new Set(entities.map(e => e.LogicalName));
    for (const rel of this.#state.relationships) {
      if (rel.type !== '1:N') continue;
      if (!nameSet.has(rel.sourceEntity) || !nameSet.has(rel.targetEntity)) continue;
      if (rel.sourceEntity === rel.targetEntity) continue;
      // Avoid duplicate edges (dagre doesn't support multigraph by default)
      if (!g.hasEdge(rel.sourceEntity, rel.targetEntity)) {
        g.setEdge(rel.sourceEntity, rel.targetEntity);
      }
    }

    // Compute layout
    layout(g);

    // Extract positions (dagre returns center coords → convert to top-left)
    const pos = new Map();
    const sizes = new Map();
    for (const name of g.nodes()) {
      const node = g.node(name);
      pos.set(name, {
        x: node.x - node.width / 2,
        y: node.y - node.height / 2,
      });
      sizes.set(name, { w: node.width, h: node.height });
    }

    this.#state.positions = pos;
    this.#state.entitySizes = sizes;

    // Clear layer info (dagre handles this internally, not exposed)
    this.#state.layerAssignment = new Map();
    this.#state.layerGroups = new Map();
    this.#state.sortedLayers = [];
  }

  /**
   * Get visible fields for layout height computation.
   * Uses key fields filtered by system field settings.
   */
  #getVisibleFields(entityName) {
    const allFields = this.#state.entityKeyFields.get(entityName) || [];
    const filtered = allFields.filter(f =>
      f.isPk || !this.#state.hiddenSystemFields.has(f.name)
    );
    return filtered.length > MAX_KEY_FIELDS
      ? filtered.slice(0, MAX_KEY_FIELDS)
      : filtered;
  }
}
