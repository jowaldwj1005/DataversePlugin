/**
 * ERD Pro — Focus mode: BFS navigation for large models
 *
 * Shows only entities within N hops of a focus entity.
 * Neighbor badges show expandable counts.
 *
 * @module erd-pro/focus-mode
 */

export class FocusMode {
  #state;
  #renderer;
  #layout;
  #router;
  #active = false;

  constructor(state, renderer, layout, router) {
    this.#state = state;
    this.#renderer = renderer;
    this.#layout = layout;
    this.#router = router;
  }

  get active() { return this.#active; }

  /**
   * Enter focus mode centered on an entity.
   * @param {string} entityName - center entity
   * @param {number} radius - hop distance (default 1)
   */
  focus(entityName, radius = 1) {
    this.#active = true;
    this.#state.focusEntity = entityName;
    this.#state.focusRadius = radius;
    this.#applyVisibility();
  }

  /** Expand to show one more hop from the current center. */
  expand() {
    if (!this.#active) return;
    this.#state.focusRadius = Math.min(this.#state.focusRadius + 1, 5);
    this.#applyVisibility();
  }

  /** Re-center on a different entity. */
  recenter(entityName) {
    this.#state.focusEntity = entityName;
    this.#state.focusRadius = 1;
    this.#applyVisibility();
  }

  /** Exit focus mode, show all entities. */
  exit() {
    this.#active = false;
    this.#state.focusEntity = null;
    for (const ent of this.#state.entities) {
      this.#renderer.setVisibility(ent.LogicalName, true);
    }
  }

  /**
   * Get the set of visible entities for the current focus.
   * Uses BFS on the adjacency graph.
   */
  getVisibleSet() {
    const center = this.#state.focusEntity;
    if (!center) return new Set(this.#state.entities.map(e => e.LogicalName));

    const adjacency = this.#state.adjacency;
    const radius = this.#state.focusRadius;
    const visible = new Set();
    const queue = [{ name: center, depth: 0 }];
    visible.add(center);

    while (queue.length > 0) {
      const { name, depth } = queue.shift();
      if (depth >= radius) continue;
      const neighbors = adjacency.get(name);
      if (!neighbors) continue;
      for (const nb of neighbors) {
        if (!visible.has(nb)) {
          visible.add(nb);
          queue.push({ name: nb, depth: depth + 1 });
        }
      }
    }

    return visible;
  }

  /**
   * Get neighbor counts for entities at the edge of the focus radius.
   * These are shown as [+N] badges indicating expandable connections.
   * @returns {Map<string, number>} entityName → count of hidden neighbors
   */
  getEdgeCounts() {
    const visible = this.getVisibleSet();
    const adjacency = this.#state.adjacency;
    const counts = new Map();

    for (const name of visible) {
      const neighbors = adjacency.get(name);
      if (!neighbors) continue;
      let hiddenCount = 0;
      for (const nb of neighbors) {
        if (!visible.has(nb)) hiddenCount++;
      }
      if (hiddenCount > 0) counts.set(name, hiddenCount);
    }

    return counts;
  }

  // --- Private ---

  #applyVisibility() {
    const visible = this.getVisibleSet();
    for (const ent of this.#state.entities) {
      this.#renderer.setVisibility(ent.LogicalName, visible.has(ent.LogicalName));
    }
  }
}
