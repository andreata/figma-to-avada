# Avada Generatore — Workflow AI-Assisted

## Progetto

Pipeline Figma → Avada Fusion Builder shortcodes per WordPress.
Estrae dati strutturati e immagini da Figma, poi Claude genera shortcode sezione per sezione.

## Setup

1. Configurare `.env`:
   ```
   FIGMA_TOKEN=figd_...
   FIGMA_FILE_KEY=PXJb87...
   FIGMA_PAGE_NAME=Sito Istituzionale
   FIGMA_FRAME_NAME=DIMSPORT - Home Black
   WP_BASE_URL=https://example.com/wp-content/uploads/2026/02/
   WP_SITE_URL=https://example.com
   WP_USER=your_username
   WP_APP_PASSWORD=xxxx xxxx xxxx xxxx
   ```
2. Eseguire `npm start` per estrarre dati e scaricare immagini
3. Caricare le immagini da `output/{sito}/{pagina}/images/` su WordPress
4. Eseguire `npm run sync-ids` per risolvere gli ID reali dalla media library WP
5. (Opzionale) Caricare PDF della pagina in `input/pdf/`

## Per generare shortcode

Chiedere: "genera gli shortcode per [nome sezione / tutta la pagina]"

Claude legge:
- `output/{sito}/{pagina}/brief/sections/*.json` — dati strutturati per sezione (albero nodi Figma completo)
- `output/{sito}/{pagina}/brief/images.json` — mappa immagini (hash → filename → WP URL)
- `base_di_conoscenza_shortcode_wordpress/` — esempi reali di shortcode Avada
- `input/pdf/` — PDF visivo della pagina (se presente)

E genera shortcode Avada validi in `output/{sito}/{pagina}/shortcode/`.

Il nome sito/pagina viene dal `FIGMA_FRAME_NAME` (es. `"DIMSPORT - Home Black"` → `dimsport/home-black`).

## Regole shortcode Avada

### Struttura
- `[fusion_builder_container]` → `[fusion_builder_row]` → `[fusion_builder_column]` → elementi
- Ogni container ha UN solo `fusion_builder_row`
- `type="flex"` su tutti i container
- `first="true"` / `last="true"` su ogni colonna per marcare inizio/fine riga
- `type_small="1_1"` per responsive mobile (colonne impilate)
- NO commenti HTML tra tag shortcode (il parser Avada li rifiuta)
- Frazioni colonna: `1_1`, `1_2`, `1_3`, `2_3`, `1_4`, `3_4`, `1_5`, `2_5`, `3_5`, `1_6`, `5_6`
- Inner nesting: `[fusion_builder_row_inner]` + `[fusion_builder_column_inner]` (max 1 livello)

### Formattazione contenuto (CRITICO)
- **TUTTO su singola riga** — MAI newline/righe vuote dentro gli shortcode
- **`fusion_text`**: contenuto wrappato in `<p>` inline, attaccato al tag
  - CORRETTO: `[fusion_text ...]<p>Testo qui.</p>[/fusion_text]`
  - SBAGLIATO: `[fusion_text ...]\n\nTesto\n\n[/fusion_text]` → genera `<div>&nbsp;</div>`
- **`fusion_title`**: contenuto inline senza `<p>`, attaccato al tag
  - CORRETTO: `[fusion_title ...]TITOLO[/fusion_title]`
  - SBAGLIATO: `[fusion_title ...]\nTITOLO\n[/fusion_title]`

### Animazioni (CRITICO)
- **`animation_delay` in SECONDI DECIMALI** — Avada interpreta il valore come secondi
  - CORRETTO: `animation_delay="0.2"` (200ms di ritardo)
  - SBAGLIATO: `animation_delay="200"` (= 200 SECONDI, elementi invisibili per minuti!)
  - Valori comuni: `"0"`, `"0.1"`, `"0.2"`, `"0.3"`, `"0.4"`, `"0.5"`

### Immagini
- **`image_id="NNN|full"`** su `fusion_imageframe` — lega alla media library WP per srcset responsive
- Gli ID reali si ottengono con `npm run sync-ids` (query WP REST API) → salvati in `images.json` come `wpMediaId`
- Se `wpMediaId` è presente in images.json, usarlo. Altrimenti omettere `image_id` (Avada usa l'URL diretto)
- **URL con `-scaled`**: WP aggiunge `-scaled` alle immagini grandi → usare `filename-scaled.webp`
- **`aspect_ratio="2-1"`** su immagini panoramiche/full-width

### Colonne
- **`background_blend_mode="overlay"`** e **`hover_type="none"`** su colonne con immagini
- **`spacing_left`/`spacing_right`** per respiro nei layout asimmetrici
- **`loop_animation="once"`** sui titoli (non `"off"`)
- Non includere attributi con valore vuoto (`type_medium=""`, `dimension_spacing=""` ecc.)

## Elementi Avada principali

- `[fusion_title]` — titoli (h1-h6), contenuto inline
- `[fusion_text]` — paragrafi con `<p>` inline
- `[fusion_imageframe]` — immagini (sempre con `image_id`)
- `[fusion_button]` — bottoni CTA
- `[fusion_separator]` — linee divisorie
- `[fusion_menu]` — menu WordPress
- `[fusion_social_links]` — icone social
- `[fusion_checklist]` — liste con icone

## File importanti

- `.env` — configurazione Figma e WordPress
- `output/{sito}/{pagina}/brief/page-brief.json` — brief completo (tutte le sezioni)
- `output/{sito}/{pagina}/brief/sections/` — brief individuali per sezione
- `output/{sito}/{pagina}/brief/images.json` — mappa immagini con URL WordPress (.webp)
- `output/{sito}/{pagina}/images/` — immagini WebP (max 150KB) + icone SVG
- `output/{sito}/{pagina}/shortcode/` — shortcode generati
- `output/cache/` — cache API Figma (condivisa tra pagine)
- `base_di_conoscenza_shortcode_wordpress/` — knowledge base con esempi shortcode reali
  - `widget.md` — esempio completo di pagina prodotto (molto dettagliato)
  - `es_footer.md` — esempio footer con menu e social
  - `es_layout_prodotto.md` — layout pagina prodotto WooCommerce
- `input/pdf/` — PDF pagine Figma per riferimento visivo

## Formato brief sezione

Ogni file in `output/brief/sections/` contiene:
```json
{
  "index": 0,
  "name": "Nome Sezione",
  "bounds": { "x": 0, "y": 0, "width": 1512, "height": 820 },
  "background": { "type": "image", "imageHash": "...", "filename": "hero-bg.webp" },
  "nodeCount": 45,
  "nodeTree": [
    {
      "type": "FRAME",
      "name": "container",
      "bounds": { ... },
      "fills": [{ "type": "SOLID", "color": "#000000" }],
      "layout": { "mode": "VERTICAL", "gap": 20 },
      "children": [
        { "type": "TEXT", "characters": "Titolo", "style": { "fontSize": 48, "color": "#FFFFFF" } },
        { "type": "INSTANCE", "componentId": "123:456", "children": [...] }
      ]
    }
  ]
}
```

## Note operative

- Le immagini sono compresse in WebP (max 150KB) e usano URL WordPress finali (`WP_BASE_URL` + filename). Caricare i file da `output/{sito}/{pagina}/images/` su WordPress nella stessa directory.
- Il brief preserva TUTTI i nodi Figma visibili — non solo testo e immagini, ma anche vettori, istanze componenti, forme decorative.
- Per sezioni dinamiche (griglie prodotti, blog, carousel): usare shortcode Avada dinamici come `[fusion_tb_woo_upsells]`, `[fusion_post_cards]`, etc.
- Ogni progetto puo' avere piu' pagine: cambiare `FIGMA_FRAME_NAME` in `.env` e rieseguire `npm start`.
