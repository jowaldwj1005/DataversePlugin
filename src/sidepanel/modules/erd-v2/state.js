/**
 * ERD v2 — Reactive state store with pub/sub
 * @module erd-v2/state
 */

import { SYSTEM_FIELD_NAMES } from './constants.js';

export class ErdState {
  #listeners = new Map();

  constructor() {
    // Data
    this.entities = [];
    this.relationships = [];
    this.positions = new Map();
    this.entitySizes = new Map();
    this.entityKeyFields = new Map();
    this.entityAllFields = new Map();
    this.adjacency = new Map();
    this.layerAssignment = new Map();
    this.layerGroups = new Map();
    this.sortedLayers = [];

    // Tracks (channel router output)
    this.hTracks = [];
    this.vTracks = [];
    this.edgePaths = new Map();

    // UI state
    this.expanded = new Map();
    this.selectedEntity = null;
    this.hoveredEntity = null;
    this.hiddenSystemFields = new Set(SYSTEM_FIELD_NAMES);
    this.entityFieldOverrides = new Map();

    // View
    this.pan = { x: 0, y: 0 };
    this.zoom = 1;

    // Filter
    this.filterText = '';
    this.filterCustomOnly = false;

    // Meta
    this.solutionName = null;
    this.solutions = [];
    this.loading = false;
    this.loadingMessage = '';
  }

  on(key, cb) {
    if (!this.#listeners.has(key)) this.#listeners.set(key, new Set());
    this.#listeners.get(key).add(cb);
    return () => this.off(key, cb);
  }

  off(key, cb) {
    this.#listeners.get(key)?.delete(cb);
  }

  set(key, value) {
    this[key] = value;
    this.#notify(key);
  }

  batch(updates) {
    const keys = [];
    for (const [key, value] of Object.entries(updates)) {
      this[key] = value;
      keys.push(key);
    }
    for (const key of keys) this.#notify(key);
  }

  resetData() {
    this.entities = [];
    this.relationships = [];
    this.positions.clear();
    this.entitySizes.clear();
    this.entityKeyFields.clear();
    this.entityAllFields.clear();
    this.adjacency.clear();
    this.layerAssignment.clear();
    this.layerGroups.clear();
    this.sortedLayers = [];
    this.hTracks = [];
    this.vTracks = [];
    this.edgePaths.clear();
    this.expanded.clear();
    this.selectedEntity = null;
    this.hoveredEntity = null;
    this.entityFieldOverrides.clear();
  }

  #notify(key) {
    const cbs = this.#listeners.get(key);
    if (!cbs) return;
    for (const cb of cbs) {
      try { cb(this[key]); } catch (e) { console.error(`[ErdState] Error in listener for "${key}":`, e); }
    }
  }
}
