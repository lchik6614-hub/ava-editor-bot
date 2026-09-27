import crypto from "node:crypto";

export class CryptoBotProvider {
  constructor(config) {
    this.token = config.token;
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.asset = config.asset;
    this.priceUsd = config.priceUsd;
    this.expiresIn = config.expiresIn;
  }

  async request(method, path, body) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Crypto-Pay-API-Token": this.token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error?.name || payload.error || "CryptoBot API error.");
    }
    return payload.result;
  }

  async createInvoice({ orderId, nickname }) {
    const invoice = await this.request("POST", "/createInvoice", {
      asset: this.asset,
      amount: this.priceUsd.toFixed(2),
      description: `Аватарка для ${nickname}`,
      payload: orderId,
      expires_in: this.expiresIn,
    });

    return {
      providerInvoiceId: String(invoice.invoice_id),
      paymentUrl: invoice.bot_invoice_url || invoice.mini_app_invoice_url,
    };
  }

  verifyWebhook(rawBody, signature) {
    if (!signature) return false;
    const secret = crypto.createHash("sha256").update(this.token).digest();
    const expected = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");
    return timingSafeEqual(expected, signature);
  }
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}