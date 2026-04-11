# bozelli.ca

Personal consulting website for **José Carlos Bozelli Jr., PhD** — scientific consultant in lipid biology, lipidomics, and omics data science.

**Live:** [bozelli.ca](https://bozelli.ca)

---

## About

Single-page bilingual website (English / Portuguese) built with semantic HTML, CSS, and vanilla JavaScript. No frameworks, no dependencies, no build step — designed to be fast, maintainable, and easy to update without tooling.

---

## Stack

| Layer | Technology |
|---|---|
| Markup | HTML5 |
| Styling | CSS3 with custom properties |
| Behaviour | Vanilla JS (language toggle, localStorage) |
| Hosting | GitHub Pages |
| Fonts | Google Fonts (Cormorant Garamond, DM Mono, Outfit) |
| Booking | Calendly inline embed |

---

## Structure

```
bozelli.ca/
├── index.html        # Complete site — content, styles, and scripts
├── assets/
│   ├── img/          # Images
│   ├── css/          # Future CSS extraction
│   └── js/           # Future JS extraction
└── README.md
```

All content is currently colocated in `index.html`. This is intentional for a single-page site at this stage — straightforward to deploy, edit, and maintain without a build pipeline.

---

## Bilingual system

Every content element carries both language versions as data attributes:

```html
<p data-en="English text" data-pt="Portuguese text">English text</p>
```

A small vanilla JS function swaps all `data-en` / `data-pt` values on language toggle and persists the user's preference via `localStorage`. No external i18n library required.

---

## Updating content

Edit the `data-en` and `data-pt` attribute values in `index.html` directly. Save and push — GitHub Pages reflects changes within ~60 seconds.

---

## License

© José Carlos Bozelli Jr. All rights reserved.