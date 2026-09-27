# Ava Editor Bot

## Pterodactyl: one-command startup

Upload and extract the ZIP so the server root contains:

```text
index.js
package.json
backend/
mini-app/
```

Set the Pterodactyl startup command to:

```bash
npm start
```

Set the install command to:

```bash
npm install --omit=dev
```

Copy `.env.example` to `.env`, fill in the newly rotated secrets, then press
Start. The API will listen on `PORT=3000`, and the Mini App will be available
from the same server at:

```text
https://YOUR_DOMAIN/mini-app/
```

Use that exact HTTPS URL in BotFather as the Mini App URL. Because the frontend
and backend share the same origin, no API URL needs to be hardcoded into
`mini-app/index.html`.

CryptoBot webhook:

```text
https://YOUR_DOMAIN/webhooks/cryptobot
```

The final paid image has no `@avaeditorbot` watermark. The watermark exists
only in the free preview layer.