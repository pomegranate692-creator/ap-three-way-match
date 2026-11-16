// Phone-photo damage for the synthetic stress set. Deterministic: every random draw comes from a seeded PRNG.
import { createCanvas } from "@napi-rs/canvas";

export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Damage presets. rotateDeg/skew are maxima (sign is random); blurPx is measured on the final (downscaled) image. */
export const DAMAGE = {
  light: { rotateDeg: 0.8, skew: 0.01, scale: 0.85, blurPx: 0.5, shade: 0.08, shadow: 0, noise: 3, jpegQuality: 80, desk: false },
  medium: { rotateDeg: 2, skew: 0.03, scale: 0.6, blurPx: 1.0, shade: 0.18, shadow: 0.22, noise: 7, jpegQuality: 60, desk: false },
  heavy: { rotateDeg: 4, skew: 0.06, scale: 0.5, blurPx: 1.4, shade: 0.3, shadow: 0.42, noise: 12, jpegQuality: 40, desk: true },
};

export function degrade(page, level, seed) {
  const p = DAMAGE[level];
  const rnd = prng(seed);
  const sign = () => (rnd() < 0.5 ? -1 : 1);
  const rot = (sign() * (0.55 + 0.45 * rnd()) * p.rotateDeg * Math.PI) / 180;
  const skX = sign() * (0.5 + 0.5 * rnd()) * p.skew;
  const skY = sign() * (0.5 + 0.5 * rnd()) * p.skew * 0.6;
  const W = page.width, H = page.height;
  const pad = p.desk ? 130 : 0;
  const OW = W + pad * 2, OH = H + pad * 2;

  // 1. rotate + skew the page onto a "desk" (corners revealed by the rotation show the surface)
  const base = createCanvas(OW, OH);
  const b = base.getContext("2d");
  b.fillStyle = p.desk ? "#4f463d" : "#cfcbc4";
  b.fillRect(0, 0, OW, OH);
  b.translate(OW / 2, OH / 2);
  b.rotate(rot);
  b.transform(1, skY, skX, 1, 0, 0);
  b.shadowColor = "rgba(0,0,0,0.35)";
  b.shadowBlur = p.desk ? 28 : 8;
  b.drawImage(page, -W / 2, -H / 2);
  b.setTransform(1, 0, 0, 1, 0, 0);
  b.shadowColor = "transparent";

  // 2. uneven lighting (gradient across the sheet) and a soft cast shadow (hand / phone), both multiplicative
  b.globalCompositeOperation = "multiply";
  const ang = rnd() * Math.PI * 2;
  const cx = OW / 2, cy = OH / 2, r = Math.hypot(OW, OH) / 2;
  const g = b.createLinearGradient(cx - Math.cos(ang) * r, cy - Math.sin(ang) * r, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(1, `rgba(${Math.round(255 * (1 - p.shade))},${Math.round(250 * (1 - p.shade))},${Math.round(240 * (1 - p.shade))},1)`);
  b.fillStyle = g;
  b.fillRect(0, 0, OW, OH);
  if (p.shadow > 0) {
    const sx = OW * (0.2 + 0.6 * rnd()), sy = OH * (0.2 + 0.6 * rnd());
    const rg = b.createRadialGradient(sx, sy, OW * 0.04, sx, sy, OW * 0.55);
    rg.addColorStop(0, `rgba(40,40,45,${p.shadow * 1.6})`);
    rg.addColorStop(1, "rgba(255,255,255,1)");
    b.fillStyle = rg;
    b.fillRect(0, 0, OW, OH);
  }
  b.globalCompositeOperation = "source-over";

  // 3. low resolution (downscale), then blur at the final size
  const w = Math.round(OW * p.scale), h = Math.round(OH * p.scale);
  const small = createCanvas(w, h);
  const s = small.getContext("2d");
  s.imageSmoothingQuality = "high";
  s.drawImage(base, 0, 0, w, h);
  const out = createCanvas(w, h);
  const o = out.getContext("2d");
  o.filter = `blur(${p.blurPx}px)`;
  o.drawImage(small, 0, 0);
  o.filter = "none";

  // 4. sensor noise (luminance, gaussian)
  const img = o.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd()) * p.noise;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  o.putImageData(img, 0, 0);

  // 5. JPEG compression
  return {
    bytes: out.encodeSync("jpeg", p.jpegQuality),
    width: w, height: h,
    applied: { level, rotationDeg: +((rot * 180) / Math.PI).toFixed(2), skewX: +skX.toFixed(3), skewY: +skY.toFixed(3), scale: p.scale, blurPx: p.blurPx, lightingShade: p.shade, castShadow: p.shadow, noiseSigma: p.noise, jpegQuality: p.jpegQuality, deskBackground: p.desk },
  };
}
