import Database from "better-sqlite3";

export function createDatabase(databasePath) {
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      telegram_user_id TEXT NOT NULL,
      nickname TEXT NOT NULL,
      image_path TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_invoice_id TEXT UNIQUE,
      payment_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      result_path TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      paid_at TEXT,
      processing_started_at TEXT,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);
  `);

  const statements = {
    insert: db.prepare(`
      INSERT INTO orders (
        id, telegram_user_id, nickname, image_path, provider, status, created_at
      ) VALUES (
        @id, @telegramUserId, @nickname, @imagePath, @provider, 'pending', @createdAt
      )
    `),
    get: db.prepare("SELECT * FROM orders WHERE id = ?"),
    pendingPaid: db.prepare(`
      SELECT * FROM orders
      WHERE status = 'paid'
      ORDER BY paid_at ASC
    `),
    setInvoice: db.prepare(`
      UPDATE orders
      SET provider_invoice_id = @invoiceId, payment_url = @paymentUrl
      WHERE id = @id
    `),
    markPaid: db.prepare(`
      UPDATE orders
      SET status = 'paid', paid_at = COALESCE(paid_at, @paidAt)
      WHERE id = ? AND status IN ('pending', 'paid')
    `),
    markProcessing: db.prepare(`
      UPDATE orders
      SET status = 'processing', processing_started_at = @startedAt
      WHERE id = ? AND status IN ('paid', 'processing')
    `),
    markCompleted: db.prepare(`
      UPDATE orders
      SET status = 'completed', result_path = @resultPath, completed_at = @completedAt
      WHERE id = ?
    `),
    markFailed: db.prepare(`
      UPDATE orders
      SET status = 'failed', error = @error
      WHERE id = ?
    `),
  };

  return {
    insertOrder(order) {
      statements.insert.run(order);
    },
    getOrder(id) {
      return statements.get.get(id);
    },
    listPaidOrders() {
      return statements.pendingPaid.all();
    },
    setInvoice({ id, invoiceId, paymentUrl }) {
      statements.setInvoice.run({ id, invoiceId, paymentUrl });
    },
    markPaid(id, paidAt = new Date().toISOString()) {
      return statements.markPaid.run(id, paidAt).changes > 0;
    },
    markProcessing(id, startedAt = new Date().toISOString()) {
      return statements.markProcessing.run(id, startedAt).changes > 0;
    },
    markCompleted(id, resultPath, completedAt = new Date().toISOString()) {
      statements.markCompleted.run({ id, resultPath, completedAt });
    },
    markFailed(id, error) {
      statements.markFailed.run({ id, error: String(error).slice(0, 2000) });
    },
    close() {
      db.close();
    },
  };
}