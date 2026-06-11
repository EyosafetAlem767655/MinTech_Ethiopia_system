import sharp from "sharp";

/**
 * 64-bit difference hash (dHash). Robust against resizing/re-encoding, so
 * resubmitted or duplicated claim photos hash to (nearly) the same value.
 */
export async function perceptualHash(image: Buffer): Promise<string> {
  const { data } = await sharp(image)
    .grayscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hash = "";
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = data[row * 9 + col];
      const right = data[row * 9 + col + 1];
      hash += left > right ? "1" : "0";
    }
  }
  // 64 bits → 16 hex chars
  return BigInt("0b" + hash).toString(16).padStart(16, "0");
}

export function hammingDistance(a: string, b: string): number {
  const x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let count = 0;
  let v = x;
  while (v) {
    count += Number(v & 1n);
    v >>= 1n;
  }
  return count;
}

/** Distance ≤ 8 of 64 bits ≈ same photo re-shot/re-encoded/cropped slightly. */
export const DUPLICATE_THRESHOLD = 8;
