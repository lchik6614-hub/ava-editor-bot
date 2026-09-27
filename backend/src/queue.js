import fs from "node:fs/promises";
import path from "node:path";
import { generateAvatar } from "./generator.js";
import { sendTelegramPhoto } from "./telegram.js";

export class GenerationQueue {
  constructor({ db, resultsDir, botToken }) {
    this.db = db;
    this.resultsDir = resultsDir;
    this.botToken = botToken;
    this.pending = [];
    this.running = false;
  }

  enqueue(orderId) {
    if (!this.pending.includes(orderId)) this.pending.push(orderId);
    void this.drain();
  }

  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length) {
        const orderId = this.pending.shift();
        await this.process(orderId);
      }
    } finally {
      this.running = false;
    }
  }

  async process(orderId) {
    const order = this.db.getOrder(orderId);
    if (!order || !["paid", "processing"].includes(order.status)) return;

    this.db.markProcessing(orderId);
    const outputPath = path.join(this.resultsDir, `${order.id}.png`);
    try {
      await generateAvatar({
        sourcePath: order.image_path,
        nickname: order.nickname,
        outputPath,
      });
      const image = await fs.readFile(outputPath);
      await sendTelegramPhoto({
        botToken: this.botToken,
        chatId: order.telegram_user_id,
        imageBuffer: image,
        filename: `${order.nickname}.png`,
        caption: `Готово! Ваша аватарка для @${order.nickname} без водяного знака.`,
      });
      this.db.markCompleted(orderId, outputPath);
    } catch (error) {
      this.db.markFailed(orderId, error.message);
      console.error(`[generation:${orderId}]`, error);
    }
  }
}