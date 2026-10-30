// Generates a 1024x1024 app icon PNG for Sile (folder + arrows glyph on gradient).
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const S = 1024;
const px = new Uint8Array(S * S * 4);

function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// rounded-square signed distance (centered)
function roundedSDF(x, y, half, r) {
  const qx = Math.abs(x) - (half - r);
  const qy = Math.abs(y) - (half - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

// Supersample 3x3
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < 3; sy++) {
      for (let sx = 0; sx < 3; sx++) {
        const fx = x + (sx + 0.5) / 3;
        const fy = y + (sy + 0.5) / 3;
        // canvas coords: center
        const cx = fx - S / 2;
        const cy = fy - S / 2;

        // background gradient rounded square, corner radius 224
        const bgSDF = roundedSDF(cx, cy, S / 2 - 8, 224);
        const bgA = 1 - smoothstep(-1.5, 1.5, bgSDF);
        // gradient: top-left #7C4DFF -> bottom-right #00B8D4
        const t = (cx + cy + S) / (2 * S);
        const br = lerp(124, 0, t);
        const bg = lerp(77, 184, t);
        const bb = lerp(255, 212, t);

        // white folder shape
        // folder body: rect from -280..280 x, -140..240 y, radius 40
        const bodySDF = roundedSDF(cx, cy - 50, 280, 40);
        const bodyA = 1 - smoothstep(-1.5, 1.5, bodySDF);
        // folder tab: rect -280..-80 x, -220..-140 y
        const tabSDF = roundedSDF(cx + 180, cy + 180, 200, 30);
        const tabA = 1 - smoothstep(-1.5, 1.5, tabSDF);
        const folderA = Math.max(bodyA, tabA);

        // arrow: up arrow through folder (cut a circle where arrow meets? keep simple: arrow on top)
        // arrow shaft: rect -36..36 x, -60..230 y
        const shaftA = 1 - smoothstep(-1.5, 1.5, roundedSDF(cx, cy - 60, 36, 18) * 0 + (Math.max(Math.abs(cx) - 36, Math.abs(cy + 60 - 145) - 145)));
        // simpler: shaft via plain rect
        const shaft = (Math.abs(cx) <= 36) && (cy >= -75 && cy <= 215) ? 1 : 0;
        // arrow head: triangle centered at y=-75..-245
        let head = 0;
        if (cy <= -75 && cy >= -255) {
          const w = 150 * ((-75 - cy) / 180);
          if (Math.abs(cx) <= w) head = 1;
        }
        const arrowA = Math.max(shaft, head);

        // colors
        const isArrow = arrowA > 0.5;
        const isFolder = folderA > 0.5 && !isArrow;
        let rr = br, gg = bg, bb2 = bb, alpha = bgA;
        if (isFolder) { rr = 255; gg = 255; bb2 = 255; alpha = Math.max(alpha, folderA); }
        if (isArrow) { rr = 255; gg = 255; bb2 = 255; alpha = Math.max(alpha, arrowA * bgA > 0 ? 1 : 0); alpha = bgA > 0 ? Math.max(alpha, 1) : alpha; }

        r += rr; g += gg; b += bb2; a += alpha;
      }
    }
    const i = (y * S + x) * 4;
    px[i] = Math.round(r / 9);
    px[i + 1] = Math.round(g / 9);
    px[i + 2] = Math.round(b / 9);
    px[i + 3] = Math.round((a / 9) * 255);
  }
}

// Encode PNG
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0; // filter none
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync("app-icon.png", png);
console.log("app-icon.png written", png.length, "bytes");
