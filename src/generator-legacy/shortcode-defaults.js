// ─── Avada Fusion Builder default attributes ───
// Only structurally required attributes — Avada applies defaults for omitted ones.

export const CONTAINER_DEFAULTS = {
  type: 'flex',
  hundred_percent: 'no',
  hundred_percent_height: 'no',
  equal_height_columns: 'no',
  hide_on_mobile: 'small-visibility,medium-visibility,large-visibility',
  status: 'published',
  border_style: 'solid',
};

export const COLUMN_DEFAULTS = {
  spacing: '4%',
  center_content: 'no',
  border_style: 'solid',
  hover_type: 'none',
  target: '_self',
  hide_on_mobile: 'small-visibility,medium-visibility,large-visibility',
};

export const COLUMN_INNER_DEFAULTS = {
  ...COLUMN_DEFAULTS,
};
