/**
 * ERD v2 — Drag, hover, selection, keyboard interaction
 *
 * Single click = select entity + highlight relationships + detail panel.
 * No double-click focus mode. Esc = deselect.
 *
 * @module erd-v2/interaction
 */

export class InteractionManager {
  #state;
  #renderer;
  #router;
  #viewport;
  #minimap;
  #onSelect;
  #isDragging = false;
  #dragEntity = null;
  #dragStart = { x: 0, y: 0 };
  #dragOrigin = { x: 0, y: 0 };
  #rafId = null;
  #keyHandler = null;

  #svg;
  #bgClickHandler;

  constructor(state, renderer, router, viewport, minimap, callbacks) {
    this.#state = state;
    this.#renderer = renderer;
    this.#router = router;
    this.#viewport = viewport;
    this.#minimap = minimap;
    this.#onSelect = callbacks.onSelect;
  }

  bindAll() {
    for (const ent of this.#state.entities) {
      const g = this.#renderer.getEntityEl(ent.LogicalName);
      if (g) this.#bindEntity(g, ent);
    }
    this.#setupKeyboard();
    this.#setupBackgroundDeselect();
  }

  destroy() {
    if (this.#keyHandler) {
      document.removeEventListener('keydown', this.#keyHandler);
      this.#keyHandler = null;
    }
    if (this.#bgClickHandler && this.#svg) {
      this.#svg.removeEventListener('click', this.#bgClickHandler);
      this.#bgClickHandler = null;
    }
    if (this.#rafId) cancelAnimationFrame(this.#rafId);
  }

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
      if (!this.#isDragging) {
        // If an entity is selected, re-apply its highlight; otherwise clear
        if (this.#state.selectedEntity) {
          this.#renderer.applyHighlight(this.#state.selectedEntity);
        } else {
          this.#renderer.clearHighlight();
        }
      }
    });

    // Single click = select + detail panel
    g.addEventListener('click', (e) => {
      if (this.#isDragging) return;
      e.stopPropagation();
      this.#state.selectedEntity = name;
      this.#renderer.applyHighlight(name);
      if (this.#onSelect) this.#onSelect(name);
    });

    g.style.cursor = 'grab';
  }

  // -------------------------------------------------------------------------
  // Drag
  // -------------------------------------------------------------------------

  #startDrag(e, entityName, g) {
    this.#isDragging = false;
    this.#dragEntity = entityName;
    this.#dragStart = { x: e.clientX, y: e.clientY };
    const pos = this.#state.positions.get(entityName);
    this.#dragOrigin = { x: pos.x, y: pos.y };

    g.setPointerCapture(e.pointerId);
    g.style.cursor = 'grabbing';

    const onMove = (e2) => {
      const dx = e2.clientX - this.#dragStart.x;
      const dy = e2.clientY - this.#dragStart.y;

      if (!this.#isDragging && Math.abs(dx) + Math.abs(dy) < 4) return;
      this.#isDragging = true;

      const zoom = this.#state.zoom;
      const newX = this.#dragOrigin.x + dx / zoom;
      const newY = this.#dragOrigin.y + dy / zoom;

      this.#state.positions.set(entityName, { x: newX, y: newY });

      if (!this.#rafId) {
        this.#rafId = requestAnimationFrame(() => {
          this.#rafId = null;
          this.#renderer.updateEntityPosition(entityName, newX, newY);
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
        // Re-route all simple edges (straight lines) after drag
        this.#router.computeSimple();
        this.#renderer.updateAllEdges();
        this.#minimap?.requestRender();
      }

      setTimeout(() => { this.#isDragging = false; this.#dragEntity = null; }, 10);
    };

    g.addEventListener('pointermove', onMove);
    g.addEventListener('pointerup', onUp);
  }

  #updateDragEdges(entityName) {
    for (const rel of this.#state.relationships) {
      if (rel.sourceEntity !== entityName && rel.targetEntity !== entityName) continue;

      const srcPos = this.#state.positions.get(rel.sourceEntity);
      const tgtPos = this.#state.positions.get(rel.targetEntity);
      const srcSize = this.#state.entitySizes.get(rel.sourceEntity);
      const tgtSize = this.#state.entitySizes.get(rel.targetEntity);
      if (!srcPos || !tgtPos || !srcSize || !tgtSize) continue;

      const fx = srcPos.x + srcSize.w / 2;
      const fy = srcPos.y + srcSize.h;
      const tx = tgtPos.x + tgtSize.w / 2;
      const ty = tgtPos.y;
      const midY = (fy + ty) / 2;

      this.#renderer.updateEdgePath(rel.schemaName, `M ${fx} ${fy} V ${midY} H ${tx} V ${ty}`);
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
          this.#state.selectedEntity = null;
          this.#renderer.clearHighlight();
          break;
      }
    };
    document.addEventListener('keydown', this.#keyHandler);
  }

  // -------------------------------------------------------------------------
  // Background click to deselect
  // -------------------------------------------------------------------------

  #setupBackgroundDeselect() {
    // Find the SVG element (parent of the root group)
    this.#svg = this.#renderer.root?.closest('svg');
    if (!this.#svg) return;

    this.#bgClickHandler = (e) => {
      // Only deselect if clicking on SVG background or edge layer (not on an entity)
      if (e.target === this.#svg || e.target.closest('.erdv2-edges')) {
        this.#state.selectedEntity = null;
        this.#renderer.clearHighlight();
      }
    };
    this.#svg.addEventListener('click', this.#bgClickHandler);
  }
}
