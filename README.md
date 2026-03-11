# figma-to-avada

Convert Figma designs into Avada (WordPress) shortcodes using AI.

**You design in Figma. AI builds the Avada page.**

---

## What it does

This tool takes a Figma design file and converts it into working Avada Fusion Builder shortcodes — ready to paste into WordPress. No manual shortcode writing, no drag-and-drop rebuilding.

The pipeline:

1. **Extracts** structured data from your Figma file via API (layout, typography, colors, images, spacing)
2. **Downloads** all images, compresses them to WebP (max 150KB), and prepares them for WordPress upload
3. **Generates** a detailed "brief" per section — a JSON representation of every visible element
4. **AI generates** Avada shortcodes from the brief using Claude Code, matching the original design

### Real example

**Figma design:**

![Figma design](images/figma-screen.jpg)

**Avada result (generated shortcodes pasted into WordPress):**

![Avada result](images/avada.jpg)

### What to expect

The AI-generated output gets you **~70% of the way there** — but that 70% is the part that takes 95% of the time when done manually. Structure, containers, columns, typography, colors, image placement, responsive stacking — all handled automatically.

The remaining 30% is fine-tuning: pixel-perfect spacing adjustments, animation tweaks, hover states, and edge cases that require a human eye. You paste the shortcodes, review in Avada's visual builder, and polish the details.

**This is not a "push button, get perfect site" tool.** It's a productivity multiplier that eliminates the tedious structural work so you can focus on the creative adjustments.

## Requirements

- **Node.js** >= 18
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** (CLI) — the AI that generates shortcodes
- **Figma account** — with a [Personal Access Token](https://www.figma.com/developers/api#access-tokens)
- **WordPress site** with [Avada theme](https://avada.com/) installed
- **sharp** (installed automatically) — for image compression

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/andreata/figma-to-avada.git
cd figma-to-avada
npm install
```

### 2. Configure

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

```env
# Figma
FIGMA_TOKEN=figd_...              # Your Figma Personal Access Token
FIGMA_FILE_KEY=PXJb87...          # From the Figma file URL
FIGMA_PAGE_NAME=Page Name         # Figma page containing the frame
FIGMA_FRAME_NAME=My Homepage      # The frame to convert

# WordPress
WP_BASE_URL=https://example.com/wp-content/uploads/2026/02/
WP_SITE_URL=https://example.com
WP_USER=your_username
WP_APP_PASSWORD=xxxx xxxx xxxx xxxx   # Generate in WP → Users → App Passwords
```

**Where to find the Figma file key:**
```
https://www.figma.com/design/PXJb87ShOr13Tz9KGqJ7et/My-Project
                              ^^^^^^^^^^^^^^^^^^^^^^^^
                              This is your FIGMA_FILE_KEY
```

### 3. Extract data from Figma

```bash
npm start
```

This will:
- Fetch the Figma file (cached after first run)
- Detect sections automatically
- Download all images as compressed WebP
- Generate structured briefs per section
- Download SVG icons

### 4. Upload images to WordPress

Upload all images from the output folder to your WordPress media library:

```
output/{site}/{page}/images/*.webp
output/{site}/{page}/images/*.svg
```

Then sync the WordPress media IDs:

```bash
npm run sync-ids
```

### 5. Generate shortcodes with Claude

Open [Claude Code](https://docs.anthropic.com/en/docs/claude-code) in the project directory and ask:

```
Generate the shortcodes for the entire page
```

Claude reads the briefs, the knowledge base, and the PDF reference (if present), then generates Avada shortcodes in `output/{site}/{page}/shortcode/`.

### 6. Paste into WordPress

Copy the generated shortcodes → WordPress → Avada Builder → toggle **Code View** → Paste → Save → Done.

## How it works

### Pipeline overview

```
┌─────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Figma   │────▶│  Extract  │────▶│  Brief   │────▶│  Claude  │
│  API     │     │  + Images │     │  (JSON)  │     │  Code    │
└─────────┘     └──────────┘     └──────────┘     └──────────┘
                                                        │
                                                        ▼
                                                  ┌──────────┐
                                                  │  Avada   │
                                                  │ Shortcode│
                                                  └──────────┘
```

### What gets extracted

For each section, the tool produces a JSON brief containing:

- **Node tree** — full hierarchy of Figma elements (frames, groups, text, images, vectors, instances)
- **Typography** — font family, size, weight, color, line height, letter spacing
- **Colors** — fills, strokes, backgrounds (solid, gradient, image)
- **Layout** — Auto Layout mode, gap, padding, alignment
- **Images** — downloaded as WebP with hash-to-filename mapping and WordPress URLs
- **Bounds** — position and size of every element

### Output structure

```
output/
├── {site}/
│   └── {page}/
│       ├── brief/
│       │   ├── page-brief.json          # All sections combined
│       │   ├── sections/
│       │   │   ├── 01-hero.json         # Individual section briefs
│       │   │   ├── 02-features.json
│       │   │   └── ...
│       │   └── images.json              # Image map (hash → filename → WP URL → media ID)
│       ├── images/
│       │   ├── hero-bg.webp             # Compressed images (max 150KB)
│       │   ├── logo.svg                 # SVG icons
│       │   └── ...
│       └── shortcode/
│           └── pagina-completa.txt      # Generated Avada shortcodes
└── cache/
    └── {fileKey}.json                   # Cached Figma API response
```

The `{site}` and `{page}` slugs are derived from `FIGMA_FRAME_NAME`. For example:
- `"DIMSPORT - Home Black"` → `dimsport/home-black`
- `"Homepage"` → `homepage/index`

### Knowledge base

The `base_di_conoscenza_shortcode_wordpress/` directory contains real-world Avada shortcode examples that Claude uses as reference:

| File | Content |
|------|---------|
| `widget.md` | Complete product page example |
| `es_footer.md` | Footer with menu and social links |
| `es_header.md` | Header / navigation |
| `es_layout_prodotto.md` | WooCommerce product layout |
| `es_layout_archivio_prodotti.md` | Product archive grid |
| `es_layout_post.md` | Blog post layout |
| `contenitori_e_colonne.md` | Container/row/column reference |
| `form.md` | Form elements |
| `off_canvas.md` | Off-canvas menu |

### Visual reference (optional)

Place a PDF export of your Figma page in `input/pdf/` for Claude to use as visual reference when generating shortcodes. This helps with layout decisions that aren't obvious from the JSON data alone.

## Supported Avada elements

The AI generates shortcodes for all major Avada elements:

- **Layout** — Containers (flex), rows, columns (responsive fractions), inner rows/columns
- **Text** — Titles (h1-h6), text blocks, separators
- **Media** — Images (with `image_id` for WP media library), galleries, videos
- **Interactive** — Buttons, CTAs, social links, menus
- **Data** — Checklists, counters, progress bars, pricing tables
- **Commerce** — WooCommerce product grids, upsells, post cards
- **Responsive** — Mobile/tablet column stacking via `type_small="1_1"`

## Tips for best results

- **Use Auto Layout in Figma** — the extractor reads padding, gap, and direction to understand the structure
- **Name your layers** — meaningful names like "hero-section" or "features-grid" help Claude generate cleaner code
- **Design on a 12-column grid** — maps cleanly to Avada's fraction system (1/6, 1/4, 1/3, 1/2, etc.)
- **Keep fonts on Google Fonts** — Claude will set the correct `fusion_font_family` parameters
- **One frame = one page** — each `FIGMA_FRAME_NAME` produces one set of shortcodes

## Multiple pages

To convert multiple pages from the same Figma file:

1. Change `FIGMA_FRAME_NAME` in `.env`
2. Run `npm start` again
3. Upload new images to WordPress
4. Run `npm run sync-ids`
5. Ask Claude to generate shortcodes

Each page gets its own output directory. The Figma API cache is shared.

## Limitations

- Complex animations beyond Avada's built-in options (fade, slide, zoom) are not converted
- Mega menus require manual WordPress configuration
- Dynamic content (conditional logic, dynamic data sources) must be set up in WordPress
- SVG icons require a separate Figma API call that may be rate-limited — re-run `npm start` later to retry
- The Figma API has rate limits per file — if you hit them, duplicate the file in Figma and update the file key

## Project structure

```
├── src/
│   ├── index.js                 # Main entry point (fetch + brief + images)
│   ├── figma-client.js          # Figma API client with retry and rate-limit handling
│   ├── brief-extractor.js       # Walks Figma nodes, produces JSON briefs
│   ├── image-fetcher.js         # Downloads and compresses images to WebP
│   ├── wp-client.js             # WordPress REST API client (media ID sync)
│   ├── sync-wp-ids.js           # Standalone script for syncing WP media IDs
│   ├── parser/
│   │   ├── section-grouper.js   # Anchor-based section detection
│   │   ├── section-detector.js  # Raw section group extraction
│   │   ├── layout-detector.js   # Auto Layout analysis
│   │   ├── node-classifier.js   # Node type classification
│   │   ├── fraction-snapper.js  # Column width → Avada fraction mapping
│   │   └── spacing-extractor.js # Padding/margin extraction
│   ├── utils/
│   │   ├── paths.js             # Site/page slug derivation
│   │   ├── image-converter.js   # WebP conversion with adaptive quality
│   │   └── geometry.js          # Bounding box utilities
│   └── generator-legacy/        # Deprecated deterministic generator
├── base_di_conoscenza_shortcode_wordpress/  # Avada shortcode examples
├── input/pdf/                   # PDF visual references (optional)
├── output/                      # Generated output (gitignored)
├── CLAUDE.md                    # AI instructions and Avada rules
├── .env.example                 # Environment template
└── package.json
```

## Don't want to do it yourself?

We also offer this as a done-for-you service. Send us your Figma file, we deliver a fully configured Avada site.

**[Request a conversion →](https://megify.ai/figma-to-avada/)**

Pricing starts at €299 for a full page. Includes responsive configuration and WordPress deployment.

## Don't use Avada?

If you don't use Avada, you might be interested in these:

- **[AI Website Generator](https://megify.ai/sito-web-ai/)** — Generate a complete WordPress site from a text description. No Figma needed.
- **[AI Ecommerce Generator](https://megify.ai/ecommerce-ai/)** — Generate a WooCommerce store with products, payments and shipping configured.
- **[WordPress vs Wix vs Squarespace](https://megify.ai/wordpress-vs-wix-vs-squarespace/)** — Technical comparison of the major platforms in 2026.
- **[How Much Does a WordPress Site Cost](https://megify.ai/quanto-costa-sito-wordpress/)** — Real pricing breakdown: DIY vs freelancer vs agency vs AI.
- **[AI Business Launcher](https://megify.ai/business-launcher/)** — Find your niche and generate a business blueprint with AI.

---

## About

Built by the team behind [Megify](https://megify.ai) — an AI platform that generates [WordPress sites](https://megify.ai/sito-wordpress-ai/) and [ecommerce stores](https://megify.ai/ecommerce-ai/) from text descriptions. Based in Italy.

## License

MIT — use it however you want.
