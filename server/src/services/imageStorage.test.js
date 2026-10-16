import { jest } from "@jest/globals";
import { storeProductImage } from "./imageStorage.js";

const cloudinaryVariables = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET"
];

function validPng() {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(1, 16);
  buffer.writeUInt32BE(1, 20);
  return buffer;
}

describe("product image storage", () => {
  const originalEnvironment = new Map();
  const originalFetch = globalThis.fetch;
  const originalNodeEnvironment = process.env.NODE_ENV;

  beforeAll(() => {
    for (const variable of cloudinaryVariables) {
      originalEnvironment.set(variable, process.env[variable]);
    }
  });

  afterAll(() => {
    for (const [variable, value] of originalEnvironment) {
      if (value === undefined) delete process.env[variable];
      else process.env[variable] = value;
    }
    if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnvironment;
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    process.env.NODE_ENV = "development";
    process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
    process.env.CLOUDINARY_API_KEY = "test-key";
    process.env.CLOUDINARY_API_SECRET = "test-secret";
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ secure_url: "https://res.cloudinary.com/test/image/upload/test.png" })
    });
  });

  test("uses Cloudinary whenever credentials are configured", async () => {
    const imageUrl = await storeProductImage({
      buffer: validPng(),
      mimetype: "image/png",
      productId: "product-123"
    });

    expect(imageUrl).toBe(
      "https://res.cloudinary.com/test/image/upload/test.png"
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch.mock.calls[0][0]).toContain(
      "api.cloudinary.com/v1_1/test-cloud/image/upload"
    );
  });

  test("requires Cloudinary credentials for production uploads", async () => {
    process.env.NODE_ENV = "production";
    for (const variable of cloudinaryVariables) delete process.env[variable];

    await expect(
      storeProductImage({
        buffer: validPng(),
        mimetype: "image/png",
        productId: "product-123"
      })
    ).rejects.toThrow("Cloudinary must be configured");
  });
});
