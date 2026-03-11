// ─── Section Grouper v2 ───
// Groups flat Figma children into logical sections using a hybrid approach:
//   Phase 1: Identify "anchor" elements (full-width backgrounds/containers)
//   Phase 2: Absorb overlapping elements into each anchor
//   Phase 3: Group remaining orphans by proximity
//
// This handles layered designs where backgrounds and content are siblings.

import { computeBoundingBox } from '../utils/geometry.js';
import { extractBackground } from './spacing-extractor.js';

const FULL_WIDTH_RATIO = 0.85;
const OVERLAP_THRESHOLD = 0.3; // 30% vertical overlap → belongs to anchor
const ORPHAN_PROXIMITY_PX = 150; // Orphans within 150px of an anchor → absorb

/**
 * Group flat children into logical sections.
 *
 * @param {object[]} children - Direct children of the page frame
 * @param {number} pageWidth - Width of the page frame
 * @returns {object[]} Array of grouped sections
 */
export function groupIntoLogicalSections(children, pageWidth) {
  const visible = children.filter(
    (c) => c.visible !== false && c.absoluteBoundingBox
  );

  if (visible.length === 0) return [];

  console.log(`  [Grouper] ${visible.length} visible children`);

  // Annotate each node with spatial info
  const nodes = visible.map((node) => {
    const bb = node.absoluteBoundingBox;
    return {
      node,
      y: bb.y,
      bottom: bb.y + bb.height,
      height: bb.height,
      width: bb.width,
      area: bb.width * bb.height,
      isFullWidth: bb.width >= pageWidth * FULL_WIDTH_RATIO,
      hasBg: hasVisibleBackground(node),
      hasChildren: !!(node.children && node.children.length > 0),
      assigned: false,
    };
  });

  // Sort by Y position
  nodes.sort((a, b) => a.y - b.y);

  // ─── Phase 1: Identify anchors ───
  // An anchor is a tall, full-width element (background or container with children).
  // It defines a section's vertical range.
  const anchors = identifyAnchors(nodes, pageWidth);
  console.log(`  [Grouper] Found ${anchors.length} anchors`);

  // ─── Phase 2: Absorb overlapping elements into anchors ───
  for (const anchor of anchors) {
    absorbOverlapping(anchor, nodes);
  }

  // ─── Phase 3: Handle remaining orphans ───
  const orphans = nodes.filter((n) => !n.assigned);
  console.log(`  [Grouper] ${orphans.length} orphans after absorption`);

  // Try to attach orphans to the nearest anchor
  for (const orphan of orphans) {
    attachOrphanToNearestAnchor(orphan, anchors);
  }

  // Remaining true orphans: create standalone sections
  const remainingOrphans = nodes.filter((n) => !n.assigned);
  const orphanGroups = groupOrphansByProximity(remainingOrphans);

  // ─── Build final sections ───
  const sections = [];

  for (const anchor of anchors) {
    sections.push(buildGroupDescriptor(anchor, pageWidth, sections.length));
  }

  for (const group of orphanGroups) {
    sections.push(buildOrphanGroupDescriptor(group, pageWidth, sections.length));
  }

  // Sort sections by Y position
  sections.sort((a, b) => a.bounds.y - b.bounds.y);

  console.log(`  [Grouper] Final: ${sections.length} sections`);

  return sections;
}

// ─── Phase 1: Anchor identification ───

/**
 * Identify anchor elements — tall, full-width backgrounds or containers.
 * These define section boundaries.
 */
function identifyAnchors(nodes, pageWidth) {
  const anchors = [];

  // Sort candidates by area (largest first) to handle nested backgrounds
  const candidates = nodes
    .filter((n) => {
      // Must be full-width
      if (!n.isFullWidth) return false;
      // Must be either: has background, has children, or is tall (>100px)
      return n.hasBg || n.hasChildren || n.height > 100;
    })
    .sort((a, b) => b.area - a.area);

  for (const candidate of candidates) {
    // Check if this candidate is already absorbed by another anchor
    if (candidate.assigned) continue;

    // Check if this candidate overlaps significantly with an existing anchor
    const overlapsExisting = anchors.some((anchor) => {
      const overlapRatio = verticalOverlapRatio(candidate, anchor);
      return overlapRatio > 0.8; // >80% overlap → skip, it's inside an existing anchor
    });

    if (overlapsExisting) continue;

    const anchor = {
      primary: candidate,
      members: [candidate],
      y: candidate.y,
      bottom: candidate.bottom,
    };

    candidate.assigned = true;
    anchors.push(anchor);
  }

  return anchors;
}

// ─── Phase 2: Absorption ───

/**
 * Absorb elements that vertically overlap with an anchor.
 */
function absorbOverlapping(anchor, nodes) {
  for (const node of nodes) {
    if (node.assigned) continue;

    // Calculate how much of the node's height overlaps with the anchor
    const overlapRatio = verticalOverlapRatio(node, anchor);

    if (overlapRatio >= OVERLAP_THRESHOLD) {
      anchor.members.push(node);
      node.assigned = true;
      // Expand anchor bounds if the absorbed element extends beyond
      if (node.y < anchor.y) anchor.y = node.y;
      if (node.bottom > anchor.bottom) anchor.bottom = node.bottom;
    }
  }
}

/**
 * Try to attach an orphan to the nearest anchor (by vertical proximity).
 */
function attachOrphanToNearestAnchor(orphan, anchors) {
  let bestAnchor = null;
  let bestDist = Infinity;

  for (const anchor of anchors) {
    // Distance: gap between orphan and anchor's Y range
    let dist;
    if (orphan.bottom <= anchor.y) {
      dist = anchor.y - orphan.bottom;
    } else if (orphan.y >= anchor.bottom) {
      dist = orphan.y - anchor.bottom;
    } else {
      dist = 0; // overlapping
    }

    if (dist < bestDist) {
      bestDist = dist;
      bestAnchor = anchor;
    }
  }

  if (bestAnchor && bestDist <= ORPHAN_PROXIMITY_PX) {
    bestAnchor.members.push(orphan);
    orphan.assigned = true;
    if (orphan.y < bestAnchor.y) bestAnchor.y = orphan.y;
    if (orphan.bottom > bestAnchor.bottom) bestAnchor.bottom = orphan.bottom;
  }
}

// ─── Phase 3: Orphan grouping ───

/**
 * Group remaining orphans by vertical proximity.
 */
function groupOrphansByProximity(orphans) {
  if (orphans.length === 0) return [];

  orphans.sort((a, b) => a.y - b.y);

  const groups = [[orphans[0]]];

  for (let i = 1; i < orphans.length; i++) {
    const prev = orphans[i - 1];
    const curr = orphans[i];
    const gap = curr.y - prev.bottom;

    // Use a generous threshold for orphans — they should be grouped unless far apart
    if (gap > ORPHAN_PROXIMITY_PX) {
      groups.push([curr]);
    } else {
      groups[groups.length - 1].push(curr);
    }
  }

  return groups;
}

// ─── Descriptor builders ───

function buildGroupDescriptor(anchor, pageWidth, index) {
  const members = anchor.members;
  const memberNodes = members.map((m) => m.node);

  const bboxes = members.map((m) => {
    const bb = m.node.absoluteBoundingBox;
    return { x: bb.x, y: bb.y, width: bb.width, height: bb.height };
  });

  const groupBounds = computeBoundingBox(bboxes);
  const containerNode = selectContainer(members, pageWidth);
  const background = containerNode ? extractBackground(containerNode) : null;
  const name = inferSectionName(memberNodes, containerNode, index);

  return {
    containerNode,
    memberNodes,
    bounds: groupBounds,
    background,
    name,
    nodeCount: memberNodes.length,
  };
}

function buildOrphanGroupDescriptor(orphanGroup, pageWidth, index) {
  const memberNodes = orphanGroup.map((o) => o.node);

  const bboxes = orphanGroup.map((o) => {
    const bb = o.node.absoluteBoundingBox;
    return { x: bb.x, y: bb.y, width: bb.width, height: bb.height };
  });

  const groupBounds = computeBoundingBox(bboxes);
  const containerNode = selectContainer(orphanGroup, pageWidth);
  const background = containerNode ? extractBackground(containerNode) : null;
  const name = inferSectionName(memberNodes, containerNode, index);

  return {
    containerNode,
    memberNodes,
    bounds: groupBounds,
    background,
    name,
    nodeCount: memberNodes.length,
  };
}

// ─── Helpers ───

/**
 * Calculate what fraction of node A's height overlaps with range B.
 */
function verticalOverlapRatio(a, b) {
  const overlapStart = Math.max(a.y, b.y);
  const overlapEnd = Math.min(a.bottom, b.bottom);
  const overlap = Math.max(0, overlapEnd - overlapStart);
  return a.height > 0 ? overlap / a.height : 0;
}

/**
 * Select the best container node from a list of annotated members.
 */
function selectContainer(members, pageWidth) {
  if (members.length === 1) return members[0].node;

  const scored = members.map((m) => ({
    node: m.node,
    score:
      (m.isFullWidth ? 100 : 0) +
      (m.hasBg ? 50 : 0) +
      (m.hasChildren ? 30 : 0) +
      (m.area / 1000000), // small tiebreaker for area
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored[0].node;
}

function hasVisibleBackground(node) {
  const fills = node.fills;
  if (!fills || !Array.isArray(fills)) return false;

  return fills.some((fill) => {
    if (fill.visible === false) return false;
    if (fill.type === 'SOLID') {
      const opacity = fill.opacity !== undefined ? fill.opacity : 1;
      return opacity > 0.05;
    }
    if (fill.type === 'IMAGE') return true;
    if (fill.type && fill.type.startsWith('GRADIENT_')) return true;
    return false;
  });
}

function inferSectionName(memberNodes, containerNode, index) {
  if (containerNode) {
    const name = containerNode.name || '';
    if (!isGenericName(name)) return name;
  }

  for (const node of memberNodes) {
    if (node.type === 'TEXT') {
      const style = node.style || {};
      const fontSize = style.fontSize || node.fontSize || 0;
      if (fontSize >= 20 && node.characters) {
        const text = node.characters.trim();
        return text.length > 60 ? text.slice(0, 57) + '...' : text;
      }
    }
    if (node.children) {
      const heading = findHeadingText(node.children);
      if (heading) return heading;
    }
  }

  for (const node of memberNodes) {
    if (!isGenericName(node.name)) return node.name;
  }

  return `Section ${index + 1}`;
}

function findHeadingText(children, depth = 0) {
  if (depth > 3) return null;

  for (const child of children) {
    if (child.type === 'TEXT') {
      const style = child.style || {};
      const fontSize = style.fontSize || child.fontSize || 0;
      if (fontSize >= 20 && child.characters) {
        const text = child.characters.trim();
        return text.length > 60 ? text.slice(0, 57) + '...' : text;
      }
    }
    if (child.children) {
      const found = findHeadingText(child.children, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

function isGenericName(name) {
  if (!name) return true;
  const lower = name.toLowerCase().trim();
  if (/^(frame|group|rectangle|ellipse|vector|line|image|instance|component)\s*\d*$/i.test(lower)) return true;
  if (/^\d+:\d+$/.test(lower)) return true;
  if (lower.length <= 2) return true;
  return false;
}
