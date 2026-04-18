# Sharing FundPulse

FundPulse can be shared in two ways.

## Option 1: Send One File

Use this file:

```txt
dist/FundPulse-Standalone.html
```

It includes the UI, styles, app logic, and workbook data in one file. The receiver can open it directly in a browser.

Best for:
- Sending over WhatsApp, email, Google Drive, or USB.
- Quick demos.
- Offline access.

Limitations:
- Browser security may restrict install/PWA behavior from a local file.
- Updated workbook uploads still need the importer workflow.

## Option 2: Host Online

Upload the whole app folder contents to a static hosting service:

```txt
index.html
manifest.webmanifest
sw.js
assets/
src/
```

Recommended free hosts:
- Netlify
- Vercel
- GitHub Pages
- Cloudflare Pages

After hosting, share the public URL. Anyone can open it on Android, iPhone, laptop, or tablet.

Best for:
- Public sharing.
- Add to Home Screen support.
- Cleaner mobile access.

## Android / iOS Install

After hosting online:

Android:
1. Open the public URL in Chrome.
2. Tap the browser menu.
3. Choose `Add to Home screen` or `Install app`.

iPhone:
1. Open the public URL in Safari.
2. Tap Share.
3. Choose `Add to Home Screen`.

## Updating Data

When you get a newer workbook with the same sheet structure, regenerate the data:

```powershell
python scripts/import_workbook.py "C:\path\to\updated-dashboard.xlsx"
python scripts/build_standalone.py
```

Then share the new `dist/FundPulse-Standalone.html` or re-upload the hosted app folder.
