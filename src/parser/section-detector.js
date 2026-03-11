// ─── Section Detector ───
// Identifies the page frame and its top-level sections (→ Avada containers).
// Uses section-grouper to merge flat children into logical sections first.

import { extractPadding, extractBackground, extractBorderRadius } from './spacing-extractor.js';
import { detectRows } from './layout-detector.js';
import { detectDynamic } from './node-classifier.js';
import { groupIntoLogicalSections } from './section-grouper.js';

const SECTION_WIDTH_RATIO = 0.90; // >= 90% of page width = full-width section

/**
 * Find the target page (canvas) by name within the Figma document.
 *
 * @param {object} document - The Figma DOCUMENT node
 * @param {string} pageName - The page name to search for (case-insensitive)
 * @returns {object|null} The matching canvas node
 */
export function findPage(document, pageName) {
  if (!document.children) return null;

  const normalized = pageName.toLowerCase().trim();

  // Exact match first
  const exact = document.children.find(
    (page) => page.name.toLowerCase().trim() === normalized
  );
  if (exact) return exact;

  // Partial match fallback
  const partial = document.children.find(
    (page) => page.name.toLowerCase().trim().includes(normalized)
  );
  return partial || null;
}

/**
 * Find the target frame (website page) within a canvas page.
 *
 * @param {object} page - The Figma PAGE/CANVAS node
 * @param {string} frameName - The frame name to search for (case-insensitive)
 * @returns {object|null} The matching frame node
 */
export function findFrame(page, frameName) {
  if (!page.children) return null;

  const normalized = frameName.toLowerCase().trim();

  // Only look at direct children that are FRAMEs
  const frames = page.children.filter(
    (c) => c.type === 'FRAME' || c.type === 'COMPONENT' || c.type === 'SECTION'
  );

  // Exact match first
  const exact = frames.find(
    (f) => f.name.toLowerCase().trim() === normalized
  );
  if (exact) return exact;

  // Partial match fallback
  const partial = frames.find(
    (f) => f.name.toLowerCase().trim().includes(normalized)
  );
  return partial || null;
}

/**
 * List all available pages in the document.
 */
export function listPages(document) {
  if (!document.children) return [];
  return document.children.map((p) => ({ id: p.id, name: p.name }));
}

/**
 * List all frames (website pages) within a canvas page.
 */
export function listFrames(page) {
  if (!page.children) return [];
  return page.children
    .filter((c) => c.type === 'FRAME' || c.type === 'COMPONENT' || c.type === 'SECTION')
    .map((f) => ({
      id: f.id,
      name: f.name,
      width: f.absoluteBoundingBox?.width,
      height: f.absoluteBoundingBox?.height,
    }));
}

/**
 * Detect sections from the target frame (website page).
 *
 * FLOW:
 * 1. Group flat children into logical sections (section-grouper)
 * 2. For each group, create a section with rows/columns
 *
 * @param {object} frame - The Figma frame representing the website page
 * @returns {object[]} Array of section descriptors
 */
export function detectSections(frame) {
  const children = frame.children;
  if (!children || children.length === 0) return [];

  const frameBbox = frame.absoluteBoundingBox;
  const pageWidth = frameBbox ? frameBbox.width : 1440;

  // Step 1: Group flat children into logical sections
  console.log(`[Parser] Grouping ${children.length} children into logical sections...`);
  const groups = groupIntoLogicalSections(children, pageWidth);

  // Step 2: For each group, build a section descriptor
  const sections = [];

  for (const group of groups) {
    const section = buildSectionFromGroup(group, pageWidth);
    if (section) sections.push(section);
  }

  return sections;
}

/**
 * Get raw section groups with Figma node references preserved.
 * Used by the brief extractor for AI-assisted generation.
 *
 * @param {object} frame - The Figma frame representing the website page
 * @returns {object[]} Array of raw group descriptors with containerNode + memberNodes
 */
export function getRawSectionGroups(frame) {
  const children = frame.children;
  if (!children || children.length === 0) return [];

  const frameBbox = frame.absoluteBoundingBox;
  const pageWidth = frameBbox ? frameBbox.width : 1440;

  return groupIntoLogicalSections(children, pageWidth);
}

/**
 * Build a section descriptor from a grouped section.
 */
function buildSectionFromGroup(group, pageWidth) {
  const { containerNode, memberNodes, bounds, background, name } = group;

  // If the group has a single node that already has children, use it directly
  // (this is the common case where a Figma section IS properly grouped)
  if (memberNodes.length === 1 && containerNode) {
    return buildSectionFromSingleNode(containerNode, pageWidth, name);
  }

  // Multiple nodes in this group: we need to create a synthetic section
  // The containerNode (if any) provides background/styling
  // All memberNodes contribute content

  const padding = containerNode ? extractPadding(containerNode) : { top: 0, right: 0, bottom: 0, left: 0 };
  const borderRadius = containerNode ? extractBorderRadius(containerNode) : 0;
  const isFullWidth = bounds.width >= pageWidth * SECTION_WIDTH_RATIO;

  // Content area
  const contentWidth = bounds.width - padding.left - padding.right;
  const contentX = bounds.x + padding.left;

  // Collect all nodes that should contribute to row detection.
  // If the container node has its own children, include those.
  // Also include other member nodes that are NOT the container.
  const contentNodes = collectContentNodes(containerNode, memberNodes);

  // Check for dynamic content across all member nodes
  const dynamic = detectDynamicInGroup(memberNodes);

  // Create a synthetic parent node for row detection
  const syntheticParent = {
    id: containerNode?.id || memberNodes[0]?.id || 'synthetic',
    name: name,
    type: 'FRAME',
    layoutMode: containerNode?.layoutMode || 'NONE',
    children: contentNodes,
    absoluteBoundingBox: bounds,
    paddingTop: padding.top,
    paddingRight: padding.right,
    paddingBottom: padding.bottom,
    paddingLeft: padding.left,
    fills: containerNode?.fills || [],
  };

  // Detect rows
  const rows = detectRows(syntheticParent, contentWidth, contentX);

  return {
    id: containerNode?.id || memberNodes[0]?.id || `section-${name}`,
    name,
    type: 'container',
    bounds,
    isFullWidth,
    background,
    borderRadius,
    padding,
    isDynamic: dynamic.isDynamic,
    dynamicHint: dynamic.hint,
    rows,
  };
}

/**
 * Build a section from a single Figma node (simple case).
 */
function buildSectionFromSingleNode(node, pageWidth, overrideName) {
  const bbox = node.absoluteBoundingBox;
  const padding = extractPadding(node);
  const background = extractBackground(node);
  const borderRadius = extractBorderRadius(node);
  const isFullWidth = bbox.width >= pageWidth * SECTION_WIDTH_RATIO;

  const contentWidth = bbox.width - padding.left - padding.right;
  const contentX = bbox.x + padding.left;

  const dynamic = node.children ? detectDynamic(node.children) : { isDynamic: false, hint: null };

  const rows = detectRows(node, contentWidth, contentX);

  return {
    id: node.id,
    name: overrideName || node.name,
    type: 'container',
    bounds: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
    isFullWidth,
    background,
    borderRadius,
    padding,
    isDynamic: dynamic.isDynamic,
    dynamicHint: dynamic.hint,
    rows,
  };
}

/**
 * Collect all content nodes from a group for row detection.
 * Avoids duplicating the container's own children.
 */
function collectContentNodes(containerNode, memberNodes) {
  const contentNodes = [];
  const containerChildren = containerNode?.children || [];

  // Add container's own children
  contentNodes.push(...containerChildren);

  // Add other member nodes that are NOT the container
  for (const node of memberNodes) {
    if (node === containerNode) continue;

    // If this node has children, add it as a sub-container
    // If it's a leaf node, add it directly
    contentNodes.push(node);
  }

  return contentNodes;
}

/**
 * Detect dynamic patterns across all member nodes.
 */
function detectDynamicInGroup(memberNodes) {
  // Check if the member nodes themselves form a dynamic pattern
  const result = detectDynamic(memberNodes);
  if (result.isDynamic) return result;

  // Check within each member's children
  for (const node of memberNodes) {
    if (node.children) {
      const childResult = detectDynamic(node.children);
      if (childResult.isDynamic) return childResult;
    }
  }

  return { isDynamic: false, hint: null };
}

/**
 * Determine the page width from the target frame.
 */
export function getPageWidth(frame) {
  return frame.absoluteBoundingBox?.width || 1440;
}
