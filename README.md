# bozelli.ca

Personal consulting website for **José Carlos Bozelli Jr., PhD** — scientific consultant in lipid biology, lipidomics, and omics data science.

**Live:** [bozelli.ca](https://bozelli.ca)

---

## About

Four-page bilingual website (English / Portuguese) built with semantic HTML, CSS, and vanilla JavaScript. No frameworks, no dependencies, no build step — designed to be fast, maintainable, and easy to update without tooling.

---

## Stack

| Layer | Technology |
|---|---|
| Markup | HTML5 |
| Styling | CSS3 with custom properties |
| Behaviour | Vanilla JS — language toggle, scroll animations, counter animation |
| Hosting | GitHub Pages |
| DNS | Cloudflare |
| Fonts | Google Fonts (Cormorant Garamond, DM Mono, Outfit) |
| Booking | Calendly inline embed |
| Analytics | Google Analytics |

---

## Pages

| File | Content |
|---|---|
| `index.html` | Home — hero, services preview, stats strip, about strip, CTA |
| `services.html` | Full service descriptions, who I work with, engagement models |
| `about.html` | Bio, credentials, approach statements |
| `contact.html` | Calendly booking embed, contact details |

---

## Structure

```
bozelli.ca/
├── index.html
├── services.html
├── about.html
├── contact.html
├── assets/
│   ├── img/
│   │   └── profile.jpg
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── main.js
└── README.md
```

---

## Bilingual system

Every content element carries both language versions as data attributes:

```html
<p data-en="English text" data-pt="Portuguese text">English text</p>
```

The `setLang()` function in `main.js` swaps all `data-en` / `data-pt` values on language toggle and persists preference via `localStorage`. Browser language is detected on first load.

---

## Updating content

Find the English phrase using Ctrl+F / Cmd+F in the HTML file. Edit the text inside the quotes for both `data-en` and `data-pt`, and update the visible default text (between `>` and `</tag>`) to match `data-en`.

**Rule:** visible default text must always match `data-en` exactly.

---

## License

© José Carlos Bozelli Jr. All rights reserved.