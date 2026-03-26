# Free Multi-Tool Backend (Node.js + Express)

Simple beginner-friendly backend for your Free Multi-Tool website.

## Endpoints

Health:
- `GET /health` -> `{ status: "ok" }`

Required tools:
- `POST /compress-image` (multipart/form-data: `file`, optional `quality`)
- `POST /resume-builder` (JSON body, returns a `.docx`)
- `POST /pdf-to-word` (multipart/form-data: `file`, returns a `.docx`)
- `POST /audio-cutter` (multipart/form-data: `file`, body: `start`, `end`, returns `.mp3`)

Extra PDF tools:
- `POST /pdf-merge` (multipart/form-data: `files[]`)
- `POST /pdf-split` (multipart/form-data: `file`, body: `fromPage`, `toPage`)
- `POST /compress-pdf` (multipart/form-data: `file`)
- `POST /pdf-to-images` -> `501` (needs extra rendering dependencies)

Frontend compatibility (your current UI uses these):
- `POST /api/convert` (multipart/form-data: `file`, `tool`, `quality`, `start`, `end`)
- `POST /api/subscribe` (JSON: `{ email }`)
- `POST /api/track` (JSON events; placeholder response)
- `POST /api/client-error` (JSON; placeholder response)

## Environment variables

Create `.env` (or set Render Environment Variables):
- `PORT` (default: `3000`)
- `CORS_ORIGIN` (default: `*`)
  - For production, set it to a comma-separated list of allowed origins
  - Example: `https://your-netlify-site.netlify.app,https://your-domain.com`

## Run locally

1. Install Node.js
2. In this folder:
   - `npm install`
   - `npm start`
3. Test:
   - `http://localhost:3000/health`

## Deploy to Render

Render: create a **Web Service**
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`
- Port: `3000`

After Render is deployed, update your frontend config:
- In your website `config.js`, set `window.FASTTOOLS_API_BASE = "https://YOUR-RENDER-SERVICE.onrender.com"`

