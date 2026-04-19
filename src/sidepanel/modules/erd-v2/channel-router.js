/**
 * ERD v2 — Channel-based orthogonal edge router
 *
 * Routes edges through horizontal channels between hierarchy layers and
 * vertical channels between entity columns. No pathfinding (A*) needed.
 *
 * All lines are strictly horizontal or vertical with 90° rounded corners.
 * Lane assignment is integrated — parallel edges are automatically spaced.
 *
 * @module erd-v2/channel-router
 */

import { ENTITY_W, STUB_LEN, LANE_STEP, PORT_MARGIN, PATH_CORNER_R, BUMP_R, ROUTE_MARGIN } from './constants.js';
import { entityHeight } from './helpers.js';

export class ChannelRouter {
  #state;

  constructor(state) {
    this.#state = state;
  }

  /**
   * Full routing pipeline (for full detail level). Call after layout is done.
   * Updates state.hTracks, state.vTracks, state.edgePaths.
   */
  computeAll() {
    this.#computeTracks();
    this.#routeAllEdges();
  }

  /**
   * Simple straight-line routing (for zoomed-out view).
   * Edges connect entity centers with a single line segment.
   */
  computeSimple() {
    const { positions, entitySizes, relationships, edgePaths } = this.#state;
    edgePaths.clear();

    for (const rel of relationships) {
      const srcPos = positions.get(rel.sourceEntity);
      const tgtPos = positions.get(rel.targetEntity);
      const srcSize = entitySizes.get(rel.sourceEntity);
      const tgtSize = entitySizes.get(rel.targetEntity);
      if (!srcPos || !tgtPos || !srcSize || !tgtSize) continue;
      if (rel.sourceEntity === rel.targetEntity) continue; // skip self-ref

      // Straight line from source center to target center
      const sx = srcPos.x + srcSize.w / 2;
      const sy = srcPos.y + srcSize.h / 2;
      const tx = tgtPos.x + tgtSize.w / 2;
      const ty = tgtPos.y + tgtSize.h / 2;

      edgePaths.set(rel.schemaName, `M ${sx} ${sy} L ${tx} ${ty}`);
    }
  }

  /**
   * Re-route only edges connected to a specific entity.
   * @param {string} entityName
   */
  computeForEntity(entityName) {
    // Recompute tracks (positions may have changed)
    this.#computeTracks();
    for (const rel of this.#state.relationships) {
      if (rel.sourceEntity === entityName || rel.targetEntity === entityName) {
        const path = this.#routeEdge(rel);
        this.#state.edgePaths.set(rel.schemaName, path);
      }
    }
  }

  // =========================================================================
  // Track computation
  // =========================================================================

  #computeTracks() {
    this.#computeHTracks();
    this.#computeVTracks();
  }

  /**
   * H-tracks: horizontal channels between each pair of adjacent layers.
   * Each track has multiple lanes for parallel edges.
   */
  #computeHTracks() {
    const { sortedLayers, layerGroups, positions, entitySizes } = this.#state;
    const hTracks = [];

    for (let i = 0; i < sortedLayers.length - 1; i++) {
      const layerAbove = sortedLayers[i];
      const layerBelow = sortedLayers[i + 1];

      // Find bottom of upper layer and top of lower layer
      let bottomOfUpper = -Infinity;
      for (const name of layerGroups.get(layerAbove)) {
        const pos = positions.get(name);
        const size = entitySizes.get(name);
        if (pos && size) bottomOfUpper = Math.max(bottomOfUpper, pos.y + size.h);
      }

      let topOfLower = Infinity;
      for (const name of layerGroups.get(layerBelow)) {
        const pos = positions.get(name);
        if (pos) topOfLower = Math.min(topOfLower, pos.y);
      }

      const channelTop = bottomOfUpper + ROUTE_MARGIN;
      const channelBottom = topOfLower - ROUTE_MARGIN;
      const channelMid = (channelTop + channelBottom) / 2;
      const capacity = Math.max(1, Math.floor((channelBottom - channelTop) / LANE_STEP));

      hTracks.push({
        layerAbove,
        layerBelow,
        top: channelTop,
        bottom: channelBottom,
        mid: channelMid,
        capacity,
        nextLane: 0,
      });
    }

    this.#state.hTracks = hTracks;
  }

  /**
   * V-tracks: vertical channels between horizontally adjacent entities.
   * Scanned across all layers.
   */
  #computeVTracks() {
    const { positions, entitySizes } = this.#state;
    const edges = []; // {left, right, x}

    // Collect all entity left/right edges
    for (const [name, pos] of positions) {
      const size = entitySizes.get(name);
      if (!size) continue;
      edges.push({ left: pos.x, right: pos.x + size.w, name });
    }
    edges.sort((a, b) => a.left - b.left);

    const vTracks = [];
    for (let i = 0; i < edges.length - 1; i++) {
      const gapLeft = edges[i].right;
      const gapRight = edges[i + 1].left;
      const gapWidth = gapRight - gapLeft;
      if (gapWidth > ROUTE_MARGIN * 2) {
        const x = (gapLeft + gapRight) / 2;
        const capacity = Math.max(1, Math.floor(gapWidth / LANE_STEP));
        // Avoid duplicate tracks at same X
        if (!vTracks.length || Math.abs(vTracks[vTracks.length - 1].x - x) > LANE_STEP) {
          vTracks.push({ x, left: gapLeft, right: gapRight, capacity, nextLane: 0 });
        }
      }
    }

    this.#state.vTracks = vTracks;
  }

  // =========================================================================
  // Edge routing
  // =========================================================================

  #routeAllEdges() {
    const { relationships } = this.#state;

    // Pre-compute port assignments
    const portMap = this.#assignPorts();

    // Sort by span (shorter edges first → get inner lanes)
    const sorted = [...relationships].sort((a, b) => {
      const spanA = this.#edgeSpan(a);
      const spanB = this.#edgeSpan(b);
      return spanA - spanB;
    });

    // Reset lane counters
    for (const t of this.#state.hTracks) t.nextLane = 0;
    for (const t of this.#state.vTracks) t.nextLane = 0;

    const edgePaths = new Map();
    for (const rel of sorted) {
      const path = this.#routeEdge(rel, portMap);
      edgePaths.set(rel.schemaName, path);
    }
    this.#state.edgePaths = edgePaths;
  }

  #edgeSpan(rel) {
    const la = this.#state.layerAssignment;
    const sLayer = la.get(rel.sourceEntity) ?? 0;
    const tLayer = la.get(rel.targetEntity) ?? 0;
    return Math.abs(tLayer - sLayer);
  }

  /**
   * Route a single edge.
   * Returns an SVG path string with rounded corners.
   */
  #routeEdge(rel, portMap) {
    const { positions, entitySizes, layerAssignment } = this.#state;

    const srcPos = positions.get(rel.sourceEntity);
    const tgtPos = positions.get(rel.targetEntity);
    if (!srcPos || !tgtPos) return '';

    const srcSize = entitySizes.get(rel.sourceEntity);
    const tgtSize = entitySizes.get(rel.targetEntity);
    if (!srcSize || !tgtSize) return '';

    const sLayer = layerAssignment.get(rel.sourceEntity) ?? 0;
    const tLayer = layerAssignment.get(rel.targetEntity) ?? 0;

    // Self-referencing
    if (rel.sourceEntity === rel.targetEntity) {
      return this.#routeSelfRef(srcPos, srcSize, portMap, rel);
    }

    // Determine direction: source should be above target for clean top→bottom flow
    let fromPos, toPos, fromSize, toSize, fromLayer, toLayer;
    if (sLayer <= tLayer) {
      fromPos = srcPos; toPos = tgtPos;
      fromSize = srcSize; toSize = tgtSize;
      fromLayer = sLayer; toLayer = tLayer;
    } else {
      fromPos = tgtPos; toPos = srcPos;
      fromSize = tgtSize; toSize = srcSize;
      fromLayer = tLayer; toLayer = sLayer;
    }

    // Get port positions
    const srcPort = this.#getPort(portMap, rel, 'source');
    const tgtPort = this.#getPort(portMap, rel, 'target');
    const fx = srcPort?.x ?? (fromPos.x + fromSize.w / 2);
    const fy = srcPort?.y ?? (fromPos.y + fromSize.h);
    const tx = tgtPort?.x ?? (toPos.x + toSize.w / 2);
    const ty = tgtPort?.y ?? toPos.y;

    if (fromLayer === toLayer) {
      // Same layer: route via bottom channel
      return this.#routeSameLayer(fx, fy, tx, ty, fromPos, toPos, fromSize, toSize, fromLayer);
    }

    if (toLayer === fromLayer + 1) {
      // Adjacent layers: simple 3-segment route
      return this.#routeAdjacent(fx, fy, tx, ty);
    }

    // Non-adjacent: 5-segment route through V-track
    return this.#routeDistant(fx, fy, tx, ty, fromLayer, toLayer);
  }

  // -------------------------------------------------------------------------
  // Routing cases
  // -------------------------------------------------------------------------

  /**
   * Adjacent layers: exit bottom → H to align → enter top
   * 3 segments with rounded corners
   */
  #routeAdjacent(fx, fy, tx, ty) {
    const stubEnd = fy + STUB_LEN;
    const stubEntry = ty - STUB_LEN;

    // Get a lane in the H-track between these layers
    const trackY = this.#claimHTrackLane(fy, ty);

    // Build waypoints
    const pts = [
      { x: fx, y: fy },      // start (bottom of source)
      { x: fx, y: trackY },   // down to track
      { x: tx, y: trackY },   // horizontal to target column
      { x: tx, y: ty },       // up into target
    ];

    return this.#waypointsToPath(pts);
  }

  /**
   * Non-adjacent layers: exit → H-track → V-track → H-track → enter
   * 5+ segments
   */
  #routeDistant(fx, fy, tx, ty, fromLayer, toLayer) {
    // Find the best V-track (closest to midpoint of source and target X)
    const midX = (fx + tx) / 2;
    const vTrack = this.#findNearestVTrack(midX);
    const vx = vTrack ? this.#claimVTrackLane(vTrack) : midX;

    // H-track just below source layer
    const hTrackTop = this.#claimHTrackLane(fy, fy + 100);
    // H-track just above target layer
    const hTrackBot = this.#claimHTrackLane(ty - 100, ty);

    const pts = [
      { x: fx, y: fy },          // start
      { x: fx, y: hTrackTop },   // down to first H-track
      { x: vx, y: hTrackTop },   // H to V-track
      { x: vx, y: hTrackBot },   // V through layers
      { x: tx, y: hTrackBot },   // H to target column
      { x: tx, y: ty },          // up into target
    ];

    return this.#waypointsToPath(pts);
  }

  /**
   * Same layer: source right/bottom → H-track below → target left/top
   */
  #routeSameLayer(fx, fy, tx, ty, fromPos, toPos, fromSize, toSize, layer) {
    const belowY = Math.max(fromPos.y + fromSize.h, toPos.y + toSize.h) + STUB_LEN;
    const trackY = this.#claimHTrackLane(belowY - STUB_LEN, belowY + STUB_LEN * 2) || belowY + LANE_STEP;

    const pts = [
      { x: fx, y: fy },
      { x: fx, y: trackY },
      { x: tx, y: trackY },
      { x: tx, y: ty },
    ];

    return this.#waypointsToPath(pts);
  }

  /**
   * Self-referencing: exit right → loop right+down → enter bottom-right or top
   */
  #routeSelfRef(pos, size, portMap, rel) {
    const loopOffset = 40;
    const rx = pos.x + size.w;
    const exitY = pos.y + size.h * 0.3;
    const entryY = pos.y + size.h * 0.7;

    const pts = [
      { x: rx, y: exitY },
      { x: rx + loopOffset, y: exitY },
      { x: rx + loopOffset, y: entryY },
      { x: rx, y: entryY },
    ];

    return this.#waypointsToPath(pts);
  }

  // -------------------------------------------------------------------------
  // Port assignment
  // -------------------------------------------------------------------------

  /**
   * Pre-compute port positions for all edges.
   * Returns Map<schemaName, { source: {x,y}, target: {x,y} }>
   */
  #assignPorts() {
    const { relationships, positions, entitySizes, layerAssignment } = this.#state;
    const portMap = new Map();

    // Group edges by entity + side
    const groups = new Map(); // `${entityName}:${side}` → [{rel, role}]

    for (const rel of relationships) {
      if (rel.sourceEntity === rel.targetEntity) continue; // self-ref handled separately

      const sLayer = layerAssignment.get(rel.sourceEntity) ?? 0;
      const tLayer = layerAssignment.get(rel.targetEntity) ?? 0;

      // Source exits bottom, target enters top (for downward flow)
      let srcSide, tgtSide;
      if (sLayer < tLayer) {
        srcSide = 'bottom'; tgtSide = 'top';
      } else if (sLayer > tLayer) {
        srcSide = 'top'; tgtSide = 'bottom';
      } else {
        // Same layer: source exits bottom, target enters bottom (route below)
        srcSide = 'bottom'; tgtSide = 'bottom';
      }

      const srcKey = `${rel.sourceEntity}:${srcSide}`;
      const tgtKey = `${rel.targetEntity}:${tgtSide}`;

      if (!groups.has(srcKey)) groups.set(srcKey, []);
      if (!groups.has(tgtKey)) groups.set(tgtKey, []);
      groups.get(srcKey).push({ rel, role: 'source' });
      groups.get(tgtKey).push({ rel, role: 'target' });
    }

    // For each group, distribute ports evenly along the side
    for (const [key, entries] of groups) {
      const [entityName, side] = key.split(':');
      const pos = positions.get(entityName);
      const size = entitySizes.get(entityName);
      if (!pos || !size) continue;

      // Sort entries by connected entity position for minimal crossings
      entries.sort((a, b) => {
        const aTarget = a.role === 'source' ? a.rel.targetEntity : a.rel.sourceEntity;
        const bTarget = b.role === 'source' ? b.rel.targetEntity : b.rel.sourceEntity;
        const aPos = positions.get(aTarget);
        const bPos = positions.get(bTarget);
        if (!aPos || !bPos) return 0;
        return aPos.x - bPos.x; // sort by target X position
      });

      const n = entries.length;
      const usable = size.w - 2 * PORT_MARGIN;
      const step = usable / (n + 1);

      for (let i = 0; i < n; i++) {
        const { rel, role } = entries[i];
        const portX = pos.x + PORT_MARGIN + (i + 1) * step;

        let portY;
        if (side === 'bottom') portY = pos.y + size.h;
        else if (side === 'top') portY = pos.y;
        else if (side === 'right') portY = pos.y + size.h / 2; // fallback
        else portY = pos.y + size.h / 2;

        if (!portMap.has(rel.schemaName)) portMap.set(rel.schemaName, {});
        portMap.get(rel.schemaName)[role] = { x: portX, y: portY };
      }
    }

    return portMap;
  }

  #getPort(portMap, rel, role) {
    return portMap?.get(rel.schemaName)?.[role] || null;
  }

  // -------------------------------------------------------------------------
  // Track lane allocation
  // -------------------------------------------------------------------------

  /**
   * Find the H-track whose mid Y is between yMin and yMax, claim a lane.
   * Returns the Y coordinate of the claimed lane.
   */
  #claimHTrackLane(yMin, yMax) {
    const { hTracks } = this.#state;
    // Find the track whose range overlaps [yMin, yMax]
    let best = null;
    let bestDist = Infinity;
    for (const track of hTracks) {
      if (track.mid >= yMin - 20 && track.mid <= yMax + 20) {
        const dist = Math.abs(track.mid - (yMin + yMax) / 2);
        if (dist < bestDist) { best = track; bestDist = dist; }
      }
    }

    if (!best) {
      // No track found — use midpoint as fallback
      return (yMin + yMax) / 2;
    }

    // Claim next lane
    const offset = (best.nextLane - (best.capacity - 1) / 2) * LANE_STEP;
    best.nextLane = (best.nextLane + 1) % best.capacity;
    return best.mid + offset;
  }

  /**
   * Find nearest V-track to a target X.
   */
  #findNearestVTrack(targetX) {
    const { vTracks } = this.#state;
    if (!vTracks.length) return null;
    let best = vTracks[0];
    let bestDist = Math.abs(best.x - targetX);
    for (const t of vTracks) {
      const d = Math.abs(t.x - targetX);
      if (d < bestDist) { best = t; bestDist = d; }
    }
    return best;
  }

  /**
   * Claim a lane in a V-track. Returns the X coordinate.
   */
  #claimVTrackLane(track) {
    const offset = (track.nextLane - (track.capacity - 1) / 2) * LANE_STEP;
    track.nextLane = (track.nextLane + 1) % track.capacity;
    return track.x + offset;
  }

  // -------------------------------------------------------------------------
  // Path generation with rounded corners
  // -------------------------------------------------------------------------

  /**
   * Convert a list of waypoints into an SVG path string with rounded 90° corners.
   * @param {{x: number, y: number}[]} pts
   * @returns {string} SVG path d attribute
   */
  #waypointsToPath(pts) {
    if (pts.length < 2) return '';
    if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;

    const r = PATH_CORNER_R;
    const parts = [`M ${pts[0].x} ${pts[0].y}`];

    for (let i = 1; i < pts.length - 1; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const next = pts[i + 1];

      // Direction vectors
      const dx1 = curr.x - prev.x;
      const dy1 = curr.y - prev.y;
      const dx2 = next.x - curr.x;
      const dy2 = next.y - curr.y;

      const len1 = Math.abs(dx1) + Math.abs(dy1);
      const len2 = Math.abs(dx2) + Math.abs(dy2);
      const cr = Math.min(r, len1 / 2, len2 / 2);

      if (cr < 1) {
        // Segments too short for rounding
        parts.push(`L ${curr.x} ${curr.y}`);
        continue;
      }

      // Point just before the corner
      const beforeX = curr.x - (dx1 === 0 ? 0 : Math.sign(dx1) * cr);
      const beforeY = curr.y - (dy1 === 0 ? 0 : Math.sign(dy1) * cr);

      // Point just after the corner
      const afterX = curr.x + (dx2 === 0 ? 0 : Math.sign(dx2) * cr);
      const afterY = curr.y + (dy2 === 0 ? 0 : Math.sign(dy2) * cr);

      // Determine sweep flag for the arc
      // Cross product of direction vectors determines CW vs CCW
      const cross = (dx1 || dy1) && (dx2 || dy2)
        ? Math.sign(dx1) * Math.sign(dy2) - Math.sign(dy1) * Math.sign(dx2)
        : 0;
      const sweep = cross > 0 ? 1 : 0;

      parts.push(`L ${beforeX} ${beforeY}`);
      parts.push(`A ${cr} ${cr} 0 0 ${sweep} ${afterX} ${afterY}`);
    }

    // Final point
    const last = pts[pts.length - 1];
    parts.push(`L ${last.x} ${last.y}`);

    return parts.join(' ');
  }
}
