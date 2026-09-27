export class XrocketProvider {
  constructor(config) {
    this.token = config.token;
    this.baseUrl = config.baseUrl?.replace(/\/$/, "");
    this.createInvoicePath = config.createInvoicePath;
    this.priceUsd = config.priceUsd;
  }

  async createInvoice({ orderId, nickname }) {
    if (!this.token || !this.baseUrl) {
      throw new Error(
        "Xrocket is not configured. Set XROCKET_API_TOKEN and XROCKET_API_BASE_URL.",
      );
    }

    const response = await fetch(`${this.baseUrl}${this.createInvoicePath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: this.priceUsd.toFixed(2),
        currency: "USD",
        payload: orderId,
        description: `Аватарка для ${nickname}`,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || "Xrocket API error.");
    }

    const invoice = payload.result || payload.data || payload;
    const paymentUrl = invoice.payment_url || invoice.pay_url || invoice.url;
    const providerInvoiceId = invoice.id || invoice.invoice_id;
    if (!paymentUrl || !providerInvoiceId) {
      throw new Error(
        "Xrocket response format is not configured. Check its API documentation.",
      );
    }

    return {
      providerInvoiceId: String(providerInvoiceId),
      paymentUrl,
    };
  }
}