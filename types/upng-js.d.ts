declare module 'upng-js' {
  interface DecodedImage {
    width: number;
    height: number;
    depth: number;
    ctype: number;
    frames: Array<{
      rect: { x: number; y: number; width: number; height: number };
      delay: number;
      data: ArrayBuffer | null;
    }>;
    tabs: Record<string, unknown>;
    data: ArrayBuffer;
  }

  const UPNG: {
    /** Decode a PNG ArrayBuffer */
    decode(buffer: ArrayBuffer): DecodedImage;

    /** Convert decoded image frames to RGBA8 ArrayBuffers */
    toRGBA8(img: DecodedImage): ArrayBuffer[];

    /**
     * Encode RGBA8 frames into an optimized PNG.
     * @param imgs - Array of RGBA8 ArrayBuffers (one per frame)
     * @param w - Image width
     * @param h - Image height
     * @param cnum - Number of colors (0 = lossless, 256 = quantized like TinyPNG)
     * @param dels - Optional frame delays for APNG
     * @returns ArrayBuffer of the encoded PNG
     */
    encode(imgs: ArrayBuffer[], w: number, h: number, cnum: number, dels?: number[]): ArrayBuffer;
  };

  export default UPNG;
}
