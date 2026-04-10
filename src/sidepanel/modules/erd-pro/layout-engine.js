/**
 * ERD Pro — Hierarchy layout (Sugiyama-style)
 *
 * Computes entity positions in horizontal layers with crossing minimization.
 * Also computes layer bands needed by the channel router.
 *
 * @module erd-pro/layout-engine
 */

import { ENTITY_W, H_GAP, V_GAP, MAX_KEY_FIELDS, HEADER_H, FIELD_H, FIELD_PAD, MIN_CHANNEL } from './constants.js';
import { entityHeight } from './helpers.js';

export class LayoutEngine {
  #state;

  constructor(state) {
    this.#state = state;
  }

  /**
   * Run the full hierarchy layout pipeline.
   * Updates state.positions, state.layerAssignment, state.layerGroups, state.sortedLayers, state.entitySizes.
   */
  compute() {
    const entities = this.#state.entities;
    if (entities.length === 0) return;

    const names = entities.map(e => e.LogicalName);
    const nameSet = new Set(names);

    // Step 1: Layer assignment via longest-path on 1:N edges
    const { layers, children, parents } = this.#assignLayers(names, nameSet);

    // Step 2: Group by layer
    const layerGroups = new Map();
    for (const [name, layer] of layers) {
      if (!layerGroups.has(layer)) layerGroups.set(layer, []);
      layerGroups.get(layer).push(name);
    }
    const sortedLayers = [...layerGroups.keys()].sort((a, b) => a - b);

    // Step 3: Crossing minimization (barycenter, 4 sweeps)
    this.#minimizeCrossings(sortedLayers, layerGroups, parents, children);

    // Step 4: Compute entity sizes
    this.#computeSizes(names);

    // Step 5: Assign X/Y positions
    const pos = this.#assignPositions(sortedLayers, layerGroups);

    // Step 6: Refinement — pull toward neighbor centroid
    this.#refine(sortedLayers, layerGroups, pos);

    // Step 7: Normalize to origin
    this.#normalize(pos);

    // Store results in state
    this.#state.positions = pos;
    this.#state.layerAssignment = layers;
    this.#state.layerGroups = layerGroups;
    this.#state.sortedLayers = sortedLayers;
  }

  // -------------------------------------------------------------------------
  // Layer assignment
  // -------------------------------------------------------------------------

  #assignLayers(names, nameSet) {
    const inDegree = new Map();
    const children = new Map();
    const parents = new Map();
    for (const name of names) {
      inDegree.set(name, 0);
      children.set(name, []);
      parents.set(name, []);
    }

    for (const rel of this.#state.relationships) {
      if (rel.type !== '1:N') continue;
      if (!nameSet.has(rel.sourceEntity) || !nameSet.has(rel.targetEntity)) continue;
      if (rel.sourceEntity === rel.targetEntity) continue;
      children.get(rel.sourceEntity).push(rel.targetEntity);
      parents.get(rel.targetEntity).push(rel.sourceEntity);
      inDegree.set(rel.targetEntity, inDegree.get(rel.targetEntity) + 1);
    }

    const layers = new Map();
    const queue = [];
    for (const [name, deg] of inDegree) {
      if (deg === 0) { layers.set(name, 0); queue.push(name); }
    }

    // BFS longest-path: child layer = max(parent layer) + 1
    let iterations = 0;
    const maxIter = names.length * 10;
    while (queue.length > 0 && iterations++ < maxIter) {
      const cur = queue.shift();
      const curLayer = layers.get(cur);
      for (const child of children.get(cur)) {
        const newLayer = curLayer + 1;
        if (!layers.has(child) || layers.get(child) < newLayer) {
          layers.set(child, newLayer);
          queue.push(child);
        }
      }
    }

    // Disconnected entities → layer 0
    for (const name of names) {
      if (!layers.has(name)) layers.set(name, 0);
    }

    return { layers, children, parents };
  }

  // -------------------------------------------------------------------------
  // Crossing minimization (barycenter heuristic)
  // -------------------------------------------------------------------------

  #minimizeCrossings(sortedLayers, layerGroups, parents, children) {
    for (let sweep = 0; sweep < 4; sweep++) {
      // Top-down
      for (let li = 1; li < sortedLayers.length; li++) {
        const layer = sortedLayers[li];
        const ents = layerGroups.get(layer);
        const prevLayer = layerGroups.get(sortedLayers[li - 1]);
        const prevOrder = new Map();
        prevLayer.forEach((name, idx) => prevOrder.set(name, idx));

        ents.sort((a, b) => {
          const aP = (parents.get(a) || []).filter(p => prevOrder.has(p));
          const bP = (parents.get(b) || []).filter(p => prevOrder.has(p));
          const aC = aP.length > 0 ? aP.reduce((s, p) => s + prevOrder.get(p), 0) / aP.length : prevOrder.size / 2;
          const bC = bP.length > 0 ? bP.reduce((s, p) => s + prevOrder.get(p), 0) / bP.length : prevOrder.size / 2;
          return aC - bC;
        });
        layerGroups.set(layer, ents);
      }

      // Bottom-up
      for (let li = sortedLayers.length - 2; li >= 0; li--) {
        const layer = sortedLayers[li];
        const ents = layerGroups.get(layer);
        const nextLayer = layerGroups.get(sortedLayers[li + 1]);
        const nextOrder = new Map();
        nextLayer.forEach((name, idx) => nextOrder.set(name, idx));

        ents.sort((a, b) => {
          const aCh = (children.get(a) || []).filter(c => nextOrder.has(c));
          const bCh = (children.get(b) || []).filter(c => nextOrder.has(c));
          const aC = aCh.length > 0 ? aCh.reduce((s, c) => s + nextOrder.get(c), 0) / aCh.length : nextOrder.size / 2;
          const bC = bCh.length > 0 ? bCh.reduce((s, c) => s + nextOrder.get(c), 0) / bCh.length : nextOrder.size / 2;
          return aC - bC;
        });
        layerGroups.set(layer, ents);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Entity sizes
  // -------------------------------------------------------------------------

  #computeSizes(names) {
    for (const name of names) {
      const fields = this.#getVisibleFields(name);
      const h = entityHeight(fields.length);
      this.#state.entitySizes.set(name, { w: ENTITY_W, h });
    }
  }

  #getVisibleFields(entityName) {
    const preset = this.#state.preset;
    if (preset === 'overview') return [];

    const isExpanded = this.#state.expanded.get(entityName) === true;
    const allFields = isExpanded
      ? (this.#state.entityAllFields.get(entityName) || [])
      : (this.#state.entityKeyFields.get(entityName) || []);

    const overrides = this.#state.entityFieldOverrides.get(entityName);
    if (overrides) return allFields.filter(f => f.isPk || overrides.has(f.name));
    if (isExpanded) return allFields;

    const filtered = allFields.filter(f => f.isPk || !this.#state.hiddenSystemFields.has(f.name));
    return filtered.length > MAX_KEY_FIELDS ? filtered.slice(0, MAX_KEY_FIELDS) : filtered;
  }

  // -------------------------------------------------------------------------
  // Position assignment
  // -------------------------------------------------------------------------

  #assignPositions(sortedLayers, layerGroups) {
    const pos = new Map();
    let currentY = 20;

    for (const layer of sortedLayers) {
      const ents = layerGroups.get(layer);
      let maxH = 0;
      let currentX = 20;

      for (const name of ents) {
        const size = this.#state.entitySizes.get(name);
        maxH = Math.max(maxH, size?.h || 60);
        pos.set(name, { x: currentX, y: currentY });
        currentX += ENTITY_W + H_GAP;
      }

      // Extra gap for routing channels between layers
      const channelGap = Math.max(MIN_CHANNEL, V_GAP * 1.2);
      currentY += maxH + channelGap;
    }

    return pos;
  }

  // -------------------------------------------------------------------------
  // Refinement: pull toward neighbor centroid + overlap resolution
  // -------------------------------------------------------------------------

  #refine(sortedLayers, layerGroups, pos) {
    const adjacency = this.#state.adjacency;

    for (let pass = 0; pass < 3; pass++) {
      for (const layer of sortedLayers) {
        const ents = layerGroups.get(layer);
        for (const name of ents) {
          const neighbors = adjacency.get(name);
          if (!neighbors || neighbors.size === 0) continue;
          let sumX = 0, count = 0;
          for (const nb of neighbors) {
            const p = pos.get(nb);
            if (p) { sumX += p.x; count++; }
          }
          if (count > 0) {
            const p = pos.get(name);
            p.x += (sumX / count - p.x) * 0.3;
          }
        }

        // Resolve overlaps within layer
        const sorted = ents.map(name => ({ name, x: pos.get(name).x })).sort((a, b) => a.x - b.x);
        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i - 1];
          const curr = sorted[i];
          const minGap = ENTITY_W + 40;
          if (curr.x - prev.x < minGap) {
            const push = (minGap - (curr.x - prev.x)) / 2 + 2;
            pos.get(prev.name).x -= push;
            pos.get(curr.name).x += push;
            sorted[i - 1].x = pos.get(prev.name).x;
            sorted[i].x = pos.get(curr.name).x;
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Normalize origin
  // -------------------------------------------------------------------------

  #normalize(pos) {
    let minX = Infinity, minY = Infinity;
    for (const p of pos.values()) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); }
    for (const p of pos.values()) { p.x -= minX - 20; p.y -= minY - 20; }
  }
}
