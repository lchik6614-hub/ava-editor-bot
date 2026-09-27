import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function dataUri(buffer, mime = "image/png") {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function maskSvg(width, height) {
  const x = envNumber("TEXT_MASK_X", 95);
  const y = envNumber("TEXT_MASK_Y", 825);
  const maskWidth = envNumber("TEXT_MASK_WIDTH", 835);
  const maskHeight = envNumber("TEXT_MASK_HEIGHT", 175);
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="black"/>
      <rect x="${x}" y="${y}" width="${maskWidth}" height="${maskHeight}" fill="white"/>
    </svg>
  `);
}

function nicknameSvg(nickname, width, height) {
  const x = envNumber("TEXT_X", 95);
  const y = envNumber("TEXT_Y", 825);
  const textWidth = envNumber("TEXT_WIDTH", 835);
  const textHeight = envNumber("TEXT_HEIGHT", 175);
  const fontSize = envNumber("TEXT_FONT_SIZE", 112);
  const family = escapeXml(process.env.TEXT_FONT_FAMILY || "Arial");
  const fill = escapeXml(process.env.TEXT_FILL || "#f4f7fb");
  const stroke = escapeXml(process.env.TEXT_STROKE || "#273247");
  const strokeWidth = envNumber("TEXT_STROKE_WIDTH", 5);

  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <style>
        .nickname {
          font-family: "${family}";
          font-size: ${fontSize}px;
          font-weight: 900;
          letter-spacing: 1px;
          paint-order: stroke fill;
          stroke: ${stroke};
          stroke-width: ${strokeWidth}px;
          stroke-linejoin: round;
        }
      </style>
      <text
        x="${x + textWidth / 2}"
        y="${y + textHeight * 0.72}"
        text-anchor="middle"
        class="nickname"
        fill="${fill}"
      >${escapeXml(nickname)}</text>
    </svg>
  `);
}

async function inpaintWithReplicate(sourceBuffer, maskBuffer) {
  const token = process.env.REPLICATE_API_TOKEN;
  const model = process.env.REPLICATE_MODEL;
  if (!token || !model) {
    throw new Error(
      "Replicate is not configured. Set REPLICATE_API_TOKEN and REPLICATE_MODEL.",
    );
  }

  const [owner, modelName] = model.split("/");
  if (!owner || !modelName) {
    throw new Error("REPLICATE_MODEL must have the form owner/model.");
  }

  const response = await fetch(
    `https://api.replicate.com/v1/models/${owner}/${modelName}/predictions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({
        input: {
          image: dataUri(sourceBuffer, "image/jpeg"),
          mask: dataUri(maskBuffer),
          prompt:
            "Restore the original background behind the removed lettering. Preserve the character, composition, lighting, colors and texture. Do not add any letters, words, logos, watermark or typography.",
          output_format: "png",
        },
      }),
    },
  );
  const prediction = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(prediction.detail || "Replicate prediction failed.");
  }

  let current = prediction;
  const timeout = Date.now() + envNumber("REPLICATE_TIMEOUT_MS", 180000);
  while (current.status === "starting" || current.status === "processing") {
    if (Date.now() > timeout) {
      throw new Error("Replicate prediction timed out.");
    }
    await new Promise((resolve) =>
      setTimeout(resolve, envNumber("REPLICATE_POLL_INTERVAL_MS", 1500)),
    );
    const poll = await fetch(current.urls?.get, {
      headers: { Authorization: `Bearer ${token}` },
    });
    current = await poll.json().catch(() => ({}));
  }

  if (current.status !== "succeeded") {
    throw new Error(current.error || "Replicate prediction did not succeed.");
  }

  const outputUrl = Array.isArray(current.output)
    ? current.output[0]
    : current.output;
  if (!outputUrl) throw new Error("Replicate returned no image.");
  const outputResponse = await fetch(outputUrl);
  if (!outputResponse.ok) throw new Error("Could not download generated image.");
  return Buffer.from(await outputResponse.arrayBuffer());
}

export async function createWatermarkedPreview(sourcePath) {
  const source = await fs.readFile(sourcePath);
  const metadata = await sharp(source).metadata();
  const width = metadata.width || 1024;
  const height = metadata.height || 1024;
  const watermark = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <text x="${width - 32}" y="42" text-anchor="end"
        font-family="Arial" font-size="25" font-weight="700"
        fill="#ffffff" fill-opacity="0.82"
        stroke="#111827" stroke-width="2" paint-order="stroke"
      >@avaeditorbot</text>
    </svg>
  `);
  return sharp(source).composite([{ input: watermark }]).png().toBuffer();
}

export async function generateAvatar({ sourcePath, nickname, outputPath }) {
  const source = await fs.readFile(sourcePath);
  const metadata = await sharp(source).metadata();
  const width = metadata.width || 1024;
  const height = metadata.height || 1024;
  const mask = maskSvg(width, height);

  // The paid result never uses createWatermarkedPreview and never composites
  // a watermark. The only added text is the exact customer nickname.
  const restored = await inpaintWithReplicate(source, mask);
  await sharp(restored)
    .composite([{ input: nicknameSvg(nickname, width, height) }])
    .png()
    .toFile(outputPath);
}