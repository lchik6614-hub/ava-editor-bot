# Avatar Editor backend

Express backend for the Telegram Mini App. It creates one invoice for one
avatar, accepts a signed CryptoBot webhook, then runs an inpainting job and
sends the final PNG to the Telegram user.

## Important image rule

The uploaded image is treated as the clean source. The server can make a
watermarked preview with `createWatermarkedPreview`, but that preview is never
sent to the inpainting model and never used as the paid result.

The paid pipeline is:

```text
clean upload
  -> inpainting removes the old "ВАШ НИК" area
  -> Sharp renders the exact paid nickname
  -> Telegram receives PNG without @avaeditorbot
```

The final image does not composite a watermark.

## Local run

```bash
cd backend
cp .env.example .env
npm install
npm start
```

Set at least these values in `.env`:

```env
TELEGRAM_BOT_TOKEN=replace_after_rotation
CRYPTOBOT_API_TOKEN=replace_after_rotation
REPLICATE_API_TOKEN=replace_after_rotation
```

The server intentionally refuses to validate Telegram requests when
`TELEGRAM_BOT_TOKEN` is empty and refuses generation when the Replicate token is
missing. Real keys must live in Pterodactyl environment variables or a secrets
manager, never in this repository.

## CryptoBot webhook

Set the webhook URL in CryptoBot to:

```text
https://YOUR_API_DOMAIN/webhooks/cryptobot
```

The handler verifies `crypto-pay-api-signature`, checks the invoice payload and
status, and is idempotent: repeated paid webhooks do not create a second order.

## Xrocket

The invoice adapter is isolated in `src/payments/xrocket.js`, but the webhook
route deliberately returns `501` until the exact Xrocket API/webhook format is
confirmed. Do not mark an order paid from an unsigned or guessed Xrocket
payload.

## Pterodactyl

Use a Node.js 20+ egg. Upload `backend/` and install dependencies:

```bash
npm install --omit=dev
npm start
```

The server needs a persistent writable `storage/` directory. Configure the
panel's startup command as `npm start`, expose the chosen port, and put the VPS
HTTPS reverse proxy in front of it. `PUBLIC_BASE_URL` should be the public API
URL; payment providers cannot call a private panel address.