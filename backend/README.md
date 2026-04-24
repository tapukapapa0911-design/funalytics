# Live Data Version Backend

This backend lives entirely inside `live-data-version/` and powers the live NAV layer for the Funalytics live app.

## Features

- Daily AMFI NAV ingestion
- MongoDB bulk upserts keyed by `schemeCode`
- Retry + logging
- `mfapi.in` fallback if AMFI fails completely
- REST API for the live frontend
- Daily cron at `10:30 PM IST`

## Setup

1. Copy `.env.example` to `.env`
2. Set `MONGODB_URI`
3. Install dependencies:
   - `npm install`
4. Start:
   - `npm run dev`

## Endpoints

- `GET /health`
- `GET /funds`
- `GET /fund/:schemeCode`
- `GET /search?q=keyword`
- `GET /meta/last-updated`

## Frontend hook

To make `live-data-version/index.html` use this backend first, add before app scripts:

```html
<script>
  window.LIVE_CONFIG = {
    backendApiBase: "http://localhost:4000"
  };
</script>
```
