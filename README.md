# Atelier — Fragrance Studio Demo

Atelier is a polished, responsive fragrance-discovery dashboard built with vanilla HTML, CSS, and JavaScript. It is intentionally lightweight: there is no build step, backend, account system, external API, or dependency to install.

## Features

- Search across fictional fragrance names, brands, families, moods, and notes.
- Filter by mood and scent family, with a clear-all action.
- Browse featured fragrances or expand to the full sample catalogue.
- Open accessible fragrance detail dialogs from cards or keyboard controls.
- Save and remove fragrances from a personal collection; saved items persist in local browser storage.
- Explore note shortcuts for Bergamot, Iris, Sandalwood, Musk, Vanilla, and Vetiver.
- Add multiple scent-journal entries through a keyboard-friendly form; entries persist locally.
- Responsive desktop, tablet, and mobile layouts with useful empty states and visible sample-data labelling.
- Navigation controls connect to the discover, collection, note library, and journal sections of the demo.

## Run locally

Open `index.html` directly in a modern browser, or serve the folder locally:

```bash
python -m http.server 8000
```

Then visit <http://localhost:8000>. A local server is recommended because browser storage and dialog behavior are more consistent from an origin than from a `file://` URL.

## Project structure

```text
index.html   Semantic page structure, navigation, cards, dialogs, and forms
styles.css   Sage & Ivory visual system, responsive layout, and component states
app.js       Fictional catalogue, filtering, collection state, dialogs, and journal state
README.md    Setup, feature, structure, and limitation notes
LICENSE      MIT license
```

## Limitations

This is a front-end demo only. All fragrance names, brands, descriptions, notes, ratings, and journal content are fictional sample data. Saved fragrances and journal entries use `localStorage` in the current browser and are not synced between devices or users. There is no real product catalogue, authentication, checkout, analytics, or API integration.

The project is independent of Ravenn and contains no proprietary source code, real product data, credentials, API keys, or private assets.

## License

MIT. See `LICENSE`.
