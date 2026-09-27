import crypto from "node:crypto";

function timingSafeEqualHex(left, right) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function validateTelegramInitData(initData, botToken, maxAgeSeconds = 86400) {
  if (!initData || !botToken) {
    throw new Error("Telegram Web App authorization is not configured.");
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  if (!receivedHash || !Number.isInteger(authDate)) {
    throw new Error("Invalid Telegram initData.");
  }

  if (Math.floor(Date.now() / 1000) - authDate > maxAgeSeconds) {
    throw new Error("Telegram initData has expired.");
  }

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const expectedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (!timingSafeEqualHex(expectedHash, receivedHash)) {
    throw new Error("Telegram initData signature is invalid.");
  }

  let user;
  try {
    user = JSON.parse(params.get("user") || "{}");
  } catch {
    throw new Error("Telegram user data is invalid.");
  }

  if (!user.id) {
    throw new Error("Telegram user is missing.");
  }

  return user;
}

export async function sendTelegramPhoto({
  botToken,
  chatId,
  imageBuffer,
  filename,
  caption,
}) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption);
  form.append(
    "photo",
    new Blob([imageBuffer], { type: "image/png" }),
    filename,
  );

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendPhoto`,
    { method: "POST", body: form },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.description || "Telegram delivery failed.");
  }
}