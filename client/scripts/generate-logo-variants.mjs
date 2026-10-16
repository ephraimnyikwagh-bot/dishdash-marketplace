import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const publicDirectory = resolve(scriptDirectory, "../public");
const { data, info } = await sharp(resolve(publicDirectory, "logo.png"))
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

function makeVariant(darkText) {
  const output = Buffer.from(data);
  for (let offset = 0; offset < output.length; offset += info.channels) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const sourceAlpha = data[offset + 3];
    const brightness = Math.max(red, green, blue);
    const alpha = Math.round((brightness * sourceAlpha) / 255);
    const grayscale = brightness - Math.min(red, green, blue) < 25;
    output[offset] = darkText && grayscale ? 10 : Math.min(255, Math.round((red * 255) / (brightness || 1)));
    output[offset + 1] = darkText && grayscale ? 10 : Math.min(255, Math.round((green * 255) / (brightness || 1)));
    output[offset + 2] = darkText && grayscale ? 10 : Math.min(255, Math.round((blue * 255) / (brightness || 1)));
    output[offset + 3] = alpha;
  }
  return sharp(output, { raw: info })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 })
    .png()
    .toBuffer();
}

await Promise.all([
  makeVariant(true).then((png) => sharp(png).toFile(resolve(publicDirectory, "logo-light.png"))),
  makeVariant(false).then((png) => sharp(png).toFile(resolve(publicDirectory, "logo-dark.png")))
]);
