// ─── Avada element shortcode renderers ───
// Each renderer takes an element from layout.json and returns shortcode markup.
// IMPORTANT: No HTML comments in output — Avada's parser rejects them.

import { attrs, formatCornerRadius } from './shortcode-generator.js';

/**
 * Render a single element as Avada shortcode.
 * Returns null for elements that can't be represented (shapes, icons).
 */
export function renderElement(element) {
  switch (element.type) {
    case 'text':
      return renderText(element);
    case 'image':
      return renderImage(element);
    case 'button':
      return renderButton(element);
    case 'shape':
      return renderShape(element);
    default:
      // Icons, containers, unknown elements: skip silently
      return null;
  }
}

// ─── Text ───

function renderText(el) {
  const style = el.style || {};
  const tag = el.tag || 'p';

  // Headings: use fusion_title
  if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') {
    const size = tag.charAt(1);
    const titleAttrs = {
      title_type: 'text',
      style_type: 'default',
      content_align: style.textAlign || 'left',
      size: size,
    };
    if (style.fontSize) titleAttrs.font_size = `${style.fontSize}px`;
    if (style.color) titleAttrs.text_color = style.color;
    if (style.letterSpacing) titleAttrs.letter_spacing = `${style.letterSpacing}px`;

    const content = sanitizeContent(el.content || '');
    return `[fusion_title ${attrs(titleAttrs)}]${content}[/fusion_title]`;
  }

  // Paragraphs/spans: use fusion_text with inline HTML
  const textAttrs = {};
  if (style.fontSize) textAttrs.font_size = `${style.fontSize}px`;
  if (style.lineHeightPx && style.fontSize) {
    const ratio = (style.lineHeightPx / style.fontSize).toFixed(2);
    textAttrs.line_height = ratio;
  }

  const inlineStyles = [];
  if (style.color) inlineStyles.push(`color: ${style.color}`);
  if (style.textAlign && style.textAlign !== 'left') inlineStyles.push(`text-align: ${style.textAlign}`);
  if (style.fontWeight && style.fontWeight !== 400) inlineStyles.push(`font-weight: ${style.fontWeight}`);
  if (style.fontFamily) inlineStyles.push(`font-family: ${style.fontFamily}`);
  if (style.letterSpacing) inlineStyles.push(`letter-spacing: ${style.letterSpacing}px`);

  const styleAttr = inlineStyles.length > 0 ? ` style="${inlineStyles.join('; ')}"` : '';
  const content = sanitizeContent(el.content || '');

  return `[fusion_text ${attrs(textAttrs)}]<p${styleAttr}>${content}</p>[/fusion_text]`;
}

// ─── Image ───

function renderImage(el) {
  const imageAttrs = {
    image_id: '',
    lightbox: 'no',
    link_target: '_self',
    hide_on_mobile: 'small-visibility,medium-visibility,large-visibility',
    align: 'none',
    hover_type: 'none',
    style_type: 'none',
  };

  const radius = formatCornerRadius(el.cornerRadius);
  if (radius) imageAttrs.borderradius = radius;

  // Set max_width from Figma bounds
  if (el.bounds?.width) {
    imageAttrs.max_width = `${Math.round(el.bounds.width)}px`;
  }

  const hash = el.figmaImageHash || 'unknown';
  const placeholder = `https://placeholder.figma/${hash}`;
  return `[fusion_imageframe ${attrs(imageAttrs)}]${placeholder}[/fusion_imageframe]`;
}

// ─── Button ───

function renderButton(el) {
  const style = el.style || {};
  const buttonAttrs = {
    link: '#',
    target: '_self',
    color: 'custom',
    stretch: 'default',
    hide_on_mobile: 'small-visibility,medium-visibility,large-visibility',
  };

  if (style.color) buttonAttrs.accent_color = style.color;
  if (el.background) {
    buttonAttrs.button_gradient_top_color = el.background;
    buttonAttrs.button_gradient_bottom_color = el.background;
  }
  if (el.cornerRadius) buttonAttrs.border_radius = `${el.cornerRadius}`;
  if (style.fontSize) buttonAttrs.font_size = `${style.fontSize}px`;

  const text = sanitizeContent(el.text || 'Button');
  return `[fusion_button ${attrs(buttonAttrs)}]${text}[/fusion_button]`;
}

// ─── Shape ───

function renderShape(el) {
  const bounds = el.bounds || {};
  const bgColor = el.background?.color;

  // Thin shapes → separator
  if (bounds.height && bounds.height <= 5 && bgColor) {
    const sepAttrs = {
      style_type: 'single solid',
      border_size: `${Math.max(1, Math.round(bounds.height))}`,
      border_color: bgColor,
      hide_on_mobile: 'small-visibility,medium-visibility,large-visibility',
    };
    return `[fusion_separator ${attrs(sepAttrs)} /]`;
  }

  // Decorative shapes: skip (return null)
  return null;
}

// ─── Helpers ───

function sanitizeContent(text) {
  return text
    .replace(/\[/g, '&#91;')
    .replace(/\]/g, '&#93;')
    .replace(/\n+$/, '')  // trim trailing newlines
    .replace(/\n/g, '<br/>');  // convert internal newlines to <br/>
}
