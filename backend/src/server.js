import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import multer from "multer";
import { createDatabase } from "./db.js";
import { createWatermarkedPreview } from "./generator.js";
import { GenerationQueue } from "./queue.js";
import { CryptoBotProvider } from "./payments/cryptobot.js";
import { XrocketProvider } from "./payments/xrocket.js";
import { sendTelegramPhoto, validateTelegramInitData } from "./telegram.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "..");
const storageDir = path.resolve(process.env.STORAGE_DIR || path.join(backendRoot, "storage"));
const uploadsDir = path.join(storageDir, "uploads");
const resultsDir = path.join(storageDir, "results");
await Promise.all([
  fs.mkdir(uploadsDir, { recursive: true }),
  fs.mkdir(resultsDir, { recursive: true }),
]);

const config = {
  port: Number(process.env.PORT || 3000),
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  priceUsd: Number(process.env.PRICE_USD || 0.65),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024),
  providerName: process.env.PAYMENT_PROVIDER || "cryptobot",
};

const db = createDatabase(
  path.resolve(
    process.env.DATABASE_PATH || path.join(storageDir, "orders.sqlite"),
  ),
);

const paymentProvider =
  config.providerName === "xrocket"
    ? new XrocketProvider({
        token: process.env.XROCKET_API_TOKEN,
        baseUrl: process.env.XROCKET_API_BASE_URL,
        createInvoicePath: process.env.XROCKET_CREATE_INVOICE_PATH || "/invoices",
        priceUsd: config.priceUsd,
      })
    : new CryptoBotProvider({
        token: process.env.CRYPTOBOT_API_TOKEN,
        baseUrl: process.env.CRYPTOBOT_API_BASE_URL || "https://pay.crypt.bot/api",
        asset: process.env.CRYPTOBOT_ASSET || "USDT",
        priceUsd: config.priceUsd,
        expiresIn: Number(process.env.CRYPTOBOT_INVOICE_EXPIRES_IN || 3600),
      });

const queue = new GenerationQueue({
  db,
  resultsDir,
  botToken: config.botToken,
});

const app = express();
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Origin is not allowed."));
      }
    },
  }),
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes },
  fileFilter(_request, file, callback) {
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    callback(null, allowed.has(file.mimetype));
  },
});

app.get("/healthz", (_request, response) => {
  response.json({
    ok: true,
    provider: config.providerName,
    generator: process.env.GENERATOR_PROVIDER || "replicate",
  });
});

app.get("/api/template-preview", async (request, response) => {
  try {
    if (!request.query.path) {
      return response.status(400).json({ message: "path is required" });
    }
    const sourcePath = path.resolve(String(request.query.path));
    if (!sourcePath.startsWith(uploadsDir)) {
      return response.status(403).json({ message: "Invalid preview path." });
    }
    const preview = await createWatermarkedPreview(sourcePath);
    response.type("png").send(preview);
  } catch {
    response.status(404).json({ message: "Preview not found." });
  }
});

app.post(
  "/webhooks/cryptobot",
  express.raw({ type: "application/json" }),
  async (request, response) => {
    const rawBody = Buffer.isBuffer(request.body)
      ? request.body
      : Buffer.from("");
    const signature = request.get("crypto-pay-api-signature");
    if (
      !(paymentProvider instanceof CryptoBotProvider) ||
      !paymentProvider.verifyWebhook(rawBody, signature)
    ) {
      return response.status(401).json({ message: "Invalid webhook signature." });
    }

    try {
      const update = JSON.parse(rawBody.toString("utf8"));
      const invoice = update.payload;
      if (update.update_type !== "invoice_paid" || invoice?.status !== "paid") {
        return response.json({ ok: true });
      }

      const orderId = String(invoice.payload || "");
      const order = db.getOrder(orderId);
      if (!order) return response.status(404).json({ message: "Order not found." });
      if (
        order.provider_invoice_id &&
        order.provider_invoice_id !== String(invoice.invoice_id)
      ) {
        return response.status(409).json({ message: "Invoice mismatch." });
      }

      db.markPaid(orderId);
      queue.enqueue(orderId);
      return response.json({ ok: true });
    } catch (error) {
      console.error("CryptoBot webhook error", error);
      return response.status(400).json({ message: "Invalid webhook payload." });
    }
  },
);

app.use(express.json({ limit: "1mb" }));

app.post("/api/orders", upload.single("image"), async (request, response) => {
  try {
    const user = validateTelegramInitData(
      request.body.telegramInitData,
      config.botToken,
    );
    const nickname = String(request.body.nickname || "").trim();
    if (!/^[\p{L}\p{N} _@.#-]{1,20}$/u.test(nickname)) {
      return response.status(400).json({
        message: "Никнейм должен содержать от 1 до 20 допустимых символов.",
      });
    }
    if (!request.file) {
      return response.status(400).json({ message: "Изображение не загружено." });
    }

    const orderId = `order_${crypto.randomUUID()}`;
    const extension =
      request.file.mimetype === "image/png"
        ? "png"
        : request.file.mimetype === "image/webp"
          ? "webp"
          : "jpg";
    const imagePath = path.join(uploadsDir, `${orderId}.${extension}`);
    await fs.writeFile(imagePath, request.file.buffer);

    db.insertOrder({
      id: orderId,
      telegramUserId: String(user.id),
      nickname,
      imagePath,
      provider: config.providerName,
      createdAt: new Date().toISOString(),
    });

    try {
      const invoice = await paymentProvider.createInvoice({ orderId, nickname });
      db.setInvoice({
        id: orderId,
        invoiceId: invoice.providerInvoiceId,
        paymentUrl: invoice.paymentUrl,
      });
      return response.status(201).json({
        orderId,
        paymentUrl: invoice.paymentUrl,
      });
    } catch (error) {
      db.markFailed(orderId, error.message);
      await fs.rm(imagePath, { force: true });
      throw error;
    }
  } catch (error) {
    console.error("Create order error", error);
    return response.status(400).json({
      message: error.message || "Не удалось создать заказ.",
    });
  }
});

app.get("/api/orders/:id", async (request, response) => {
  const order = db.getOrder(request.params.id);
  if (!order) return response.status(404).json({ message: "Заказ не найден." });
  response.json({
    id: order.id,
    status: order.status,
    createdAt: order.created_at,
    completedAt: order.completed_at,
  });
});

// This route is intentionally not enabled as a payment confirmation path.
// Xrocket webhook signing/fields must be verified against the provider's docs
// before accepting money as paid.
app.post("/webhooks/xrocket", (_request, response) => {
  response.status(501).json({
    message:
      "Xrocket webhook adapter needs the exact API/webhook specification before activation.",
  });
});

const miniAppPath = path.resolve(backendRoot, "..", "mini-app");
app.use("/mini-app", express.static(miniAppPath));

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError || error.message === "File too large") {
    return response.status(413).json({ message: "Файл слишком большой." });
  }
  console.error("Unhandled server error", error);
  response.status(500).json({ message: "Внутренняя ошибка сервера." });
});

app.listen(config.port, () => {
  console.log(`Avatar Editor API listening on :${config.port}`);
  for (const order of db.listPaidOrders()) queue.enqueue(order.id);
});

async function shutdown() {
  db.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);