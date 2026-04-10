/**
 * ERD Pro — Drag, hover, selection, keyboard interaction
 * @module erd-pro/interaction
 */

export class InteractionManager {
  #state;
  #renderer;
  #router;
  #viewport;
  #minimap;
  #onSelect;
  #onExpand;
  #isDragging = false;
  #dragEntity = null;
  #dragStart = { x: 0, y: 0 };
  #dragOrigin = { x: 0, y: 0 };
  #rafId = null;
  #keyHandler = null;

  constructor(state, renderer, router, viewport, minimap, callbacks) {
    this.#state = state;
    this.#renderer = renderer;
    this.#router = router;
    this.#viewport = viewport;
    this.#minimap = minimap;
    this.#onSelect = callbacks.onSelect;
    this.#onExpand = callbacks.onExpand;
  }

  /** Bind interaction handlers to all current entity elements. */
  bindAll() {
    for (const ent of this.#state.entities) {
      const g = this.#renderer.getEntityEl(ent.LogicalName);
      if (g) this.#bindEntity(g, ent);
    }
    this.#setupKeyboard();
  }

  destroy() {
    if (this.#keyHandler) {
      document.removeEventListener('keydown', this.#keyHandler);
      this.#keyHandler = null;
    }
    if (this.#rafId) cancelAnimationFrame(this.#rafId);
  }

  // -------------------------------------------------------------------------
  // Entity interaction binding
  // -------------------------------------------------------------------------

  #bindEntity(g, ent) {
    const name = ent.LogicalName;

    // Drag
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      this.#startDrag(e, name, g);
    });

    // Hover highlight
    g.addEventListener('mouseenter', () => {
      this.#renderer.applyHighlight(name);
    });
    g.addEventListener('mouseleave', () => {
      if (!this.#isDragging) this.#renderer.clearHighlight();
    });

    // Click select
    g.addEventListener('click', (e) => {
      if (this.#isDragging) return;
      e.stopPropagation();
      this.#state.set('selectedEntity', name);
      if (this.#onSelect) this.#onSelect(name);
    });

    // Double-click expand/collapse
    g.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const expanded = !this.#state.expanded.get(name);
      this.#state.expanded.set(name, expanded);
      if (this.#onExpand) this.#onExpand(name, expanded);
    });

    g.style.cursor = 'grab';
  }

  // -------------------------------------------------------------------------
  // Drag
  // -------------------------------------------------------------------------

  #startDrag(e, entityName, g) {
    this.#isDragging = false; // becomes true after movement threshold
    this.#dragEntity = entityName;
    this.#dragStart = { x: e.clientX, y: e.clientY };
    const pos = this.#state.positions.get(entityName);
    this.#dragOrigin = { x: pos.x, y: pos.y };

    g.setPointerCapture(e.pointerId);
    g.style.cursor = 'grabbing';

    const onMove = (e2) => {
      const dx = e2.clientX - this.#dragStart.x;
      const dy = e2.clientY - this.#dragStart.y;

      // Movement threshold to distinguish click from drag
      if (!this.#isDragging && Math.abs(dx) + Math.abs(dy) < 4) return;
      this.#isDragging = true;

      const zoom = this.#state.zoom;
      const newX = this.#dragOrigin.x + dx / zoom;
      const newY = this.#dragOrigin.y + dy / zoom;

      this.#state.positions.set(entityName, { x: newX, y: newY });

      // Throttle visual updates
      if (!this.#rafId) {
        this.#rafId = requestAnimationFrame(() => {
          this.#rafId = null;
          this.#renderer.updateEntityPosition(entityName, newX, newY);

          // During drag: quick 3-segment paths for connected edges
          this.#updateDragEdges(entityName);

          this.#minimap?.requestRender();
        });
      }
    };

    const onUp = (e2) => {
      g.releasePointerCapture(e2.pointerId);
      g.style.cursor = 'grab';
      g.removeEventListener('pointermove', onMove);
      g.removeEventListener('pointerup', onUp);

      if (this.#isDragging) {
        // On drag end: full channel re-route for connected edges
        this.#router.computeForEntity(entityName);
        for (const [schema, pathD] of this.#state.edgePaths) {
          const rel = this.#state.relationships.find(r => r.schemaName === schema);
          if (rel && (rel.sourceEntity === entityName || rel.targetEntity === entityName)) {
            this.#renderer.updateEdgePath(schema, pathD);
          }
        }
        this.#minimap?.requestRender();
      }

      // Reset after a tick (so click handler can check isDragging)
      setTimeout(() => { this.#isDragging = false; this.#dragEntity = null; }, 10);
    };

    g.addEventListener('pointermove', onMove);
    g.addEventListener('pointerup', onUp);
  }

  /**
   * During drag: compute simple 3-segment paths for connected edges.
   * Fast O(degree) update, no channel routing needed.
   */
  #updateDragEdges(entityName) {
    for (const rel of this.#state.relationships) {
      if (rel.sourceEntity !== entityName && rel.targetEntity !== entityName) continue;

      const srcPos = this.#state.positions.get(rel.sourceEntity);
      const tgtPos = this.#state.positions.get(rel.targetEntity);
      const srcSize = this.#state.entitySizes.get(rel.sourceEntity);
      const tgtSize = this.#state.entitySizes.get(rel.targetEntity);
      if (!srcPos || !tgtPos || !srcSize || !tgtSize) continue;

      // Simple path: source bottom center → midY → target top center
      const fx = srcPos.x + srcSize.w / 2;
      const fy = srcPos.y + srcSize.h;
      const tx = tgtPos.x + tgtSize.w / 2;
      const ty = tgtPos.y;
      const midY = (fy + ty) / 2;

      const d = `M ${fx} ${fy} V ${midY} H ${tx} V ${ty}`;
      this.#renderer.updateEdgePath(rel.schemaName, d);
    }
  }

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  #setupKeyboard() {
    this.#keyHandler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      switch (e.key) {
        case '+':
        case '=':
          e.preventDefault();
          this.#state.set('zoom', Math.min(3, this.#state.zoom + 0.1));
          this.#viewport.updateTransform();
          break;
        case '-':
          e.preventDefault();
          this.#state.set('zoom', Math.max(0.1, this.#state.zoom - 0.1));
          this.#viewport.updateTransform();
          break;
        case '0':
          e.preventDefault();
          this.#viewport.fitToContent();
          break;
        case 'Escape':
          this.#state.set('selectedEntity', null);
          this.#renderer.clearHighlight();
          break;
      }
    };
    document.addEventListener('keydown', this.#keyHandler);
  }
}
