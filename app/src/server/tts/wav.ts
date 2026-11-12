import "server-only";

// WAV helpers (Uint8Array-based).

/** Wrap raw PCM s16le in a 44-byte RIFF/WAVE header. */
export function pcm16ToWav(pcm: Uint8Array, sampleRate: number, channels = 1): Uint8Array {
  const out = new Uint8Array(44 + pcm.byteLength);
  const v = new DataView(out.buffer);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  w(0, "RIFF");
  v.setUint32(4, 36 + pcm.byteLength, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, pcm.byteLength, true);
  out.set(pcm, 44);
  return out;
}


export function isWav(b: Uint8Array): boolean {
  return b.byteLength > 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WAVE";
}

/** Parse the fmt/data chunks of a PCM WAV. Returns null for non-PCM / malformed files. */
export function wavInfo(b: Uint8Array): { sampleRate: number; channels: number; bits: number; dataOffset: number; dataBytes: number; durationSec: number } | null {
  if (!isWav(b)) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 12;
  let sampleRate = 0, channels = 0, bits = 0;
  while (o + 8 <= b.byteLength) {
    const id = String.fromCharCode(...b.subarray(o, o + 4));
    let size = v.getUint32(o + 4, true);
    if (id === "fmt ") {
      channels = v.getUint16(o + 10, true);
      sampleRate = v.getUint32(o + 12, true);
      bits = v.getUint16(o + 22, true);
    } else if (id === "data") {
      // Streaming encoders sometimes write 0 / 0xFFFFFFFF as size — clamp to the buffer.
      if (size === 0 || o + 8 + size > b.byteLength) size = b.byteLength - (o + 8);
      const bytesPerSec = sampleRate * channels * (bits / 8) || 1;
      return { sampleRate, channels, bits, dataOffset: o + 8, dataBytes: size, durationSec: size / bytesPerSec };
    }
    o += 8 + size + (size % 2);
  }
  return null;
}

/** Parse "audio/L16;codec=pcm;rate=24000" style mime types. */
export function rateFromMime(mime: string | undefined, fallback = 24000): number {
  const m = mime?.match(/rate=(\d+)/i);
  return m ? Number(m[1]) : fallback;
}
