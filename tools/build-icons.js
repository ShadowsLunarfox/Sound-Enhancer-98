import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const palette = { ".": [0,0,0,0], K: [30,30,30,255], W: [255,255,255,255], S: [215,215,215,255], G: [128,128,128,255], T: [0,128,128,255] };
const sprite = [
  "................", "..............T.", ".......KKK..T.T.", "......KKWK..T..T", ".....KKSWK...T.T", "..KKKKSSWK.T.T.T", "..KWWKSSWK..TT.T", "..KSSKSSWK..TT.T", "..KSGKSSWK..TT.T", "..KGGKSSWK.T.T.T", "..KKKKSSWK...T.T", ".....KKSWK..T..T", "......KKWK..T.T.", ".......KKK....T.", "................", "................"
];
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function chunk(type, body) {
  const name = Buffer.from(type);
  const content = Buffer.concat([name, body]);
  let crc = 0xffffffff;
  for (const byte of content) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const result = Buffer.alloc(body.length + 12);
  result.writeUInt32BE(body.length); content.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, body.length + 8);
  return result;
}
mkdirSync(new URL("../icons/", import.meta.url), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const color = palette[sprite[Math.floor(y * 16 / size)][Math.floor(x * 16 / size)]];
    color.forEach((channel, i) => { pixels[y * (size * 4 + 1) + 1 + x * 4 + i] = channel; });
  }
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
  writeFileSync(new URL(`../icons/icon${size}.png`, import.meta.url), png);
}
console.log("Built 16, 32, 48, and 128px extension icons.");
