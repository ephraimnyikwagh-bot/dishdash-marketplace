import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const uploadsDirectory = fileURLToPath(new URL("../../uploads/", import.meta.url));
const allowedTypes = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

function cloudinaryConfiguration() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
    process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error(
      "CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET are required in production"
    );
  }
  return {
    cloudName: CLOUDINARY_CLOUD_NAME,
    apiKey: CLOUDINARY_API_KEY,
    apiSecret: CLOUDINARY_API_SECRET
  };
}

function hasCloudinaryConfiguration() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME ||
      process.env.CLOUDINARY_API_KEY ||
      process.env.CLOUDINARY_API_SECRET
  );
}

function isValidImage(buffer, mimetype) {
  if (mimetype === "image/jpeg") {
    return (
      buffer.length >= 4 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff &&
      buffer.at(-2) === 0xff &&
      buffer.at(-1) === 0xd9
    );
  }
  if (mimetype === "image/png") {
    return (
      buffer.length >= 24 &&
      buffer.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      ) &&
      buffer.toString("ascii", 12, 16) === "IHDR" &&
      buffer.readUInt32BE(16) > 0 &&
      buffer.readUInt32BE(20) > 0
    );
  }
  return (
    mimetype === "image/webp" &&
    buffer.length >= 16 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP" &&
    buffer.readUInt32LE(4) + 8 <= buffer.length
  );
}

function safeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
}

function cloudinarySignature(parameters, apiSecret) {
  const serialized = Object.keys(parameters)
    .sort()
    .map((key) => `${key}=${parameters[key]}`)
    .join("&");
  return createHash("sha1").update(`${serialized}${apiSecret}`).digest("hex");
}

async function uploadToCloudinary({ buffer, mimetype, productId, key }) {
  const config = cloudinaryConfiguration();
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = "dishdash/products";
  const publicId = safeSegment(key || `${productId}-${randomUUID()}`);
  const parameters = { folder, overwrite: "true", public_id: publicId, timestamp };
  const form = new FormData();
  form.set("file", new Blob([buffer], { type: mimetype }), `${publicId}.${allowedTypes[mimetype]}`);
  form.set("api_key", config.apiKey);
  form.set("timestamp", String(timestamp));
  form.set("folder", folder);
  form.set("public_id", publicId);
  form.set("overwrite", "true");
  form.set("signature", cloudinarySignature(parameters, config.apiSecret));

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/upload`,
    { method: "POST", body: form }
  );
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Cloudinary image upload failed (${response.status}): ${details}`);
  }
  const result = await response.json();
  if (!result.secure_url) throw new Error("Cloudinary did not return a secure image URL");
  return result.secure_url;
}

export function validateImageBuffer(buffer, mimetype) {
  return Boolean(allowedTypes[mimetype] && isValidImage(buffer, mimetype));
}

export async function storeProductImage({ buffer, mimetype, productId, key }) {
  if (!validateImageBuffer(buffer, mimetype)) {
    throw new Error("Uploaded file contents do not match a supported image type");
  }
  if (hasCloudinaryConfiguration()) {
    return uploadToCloudinary({ buffer, mimetype, productId, key });
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Cloudinary must be configured for product image uploads in production"
    );
  }

  const filename = `${safeSegment(key || `${productId}-${randomUUID()}`)}.${allowedTypes[mimetype]}`;
  await mkdir(uploadsDirectory, { recursive: true });
  await writeFile(path.join(uploadsDirectory, filename), buffer);
  return `/uploads/${filename}`;
}
