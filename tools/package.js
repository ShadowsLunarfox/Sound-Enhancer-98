import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";

const root = new URL("../", import.meta.url);
const files = ["manifest.json", "background.js", "shared.js", "offscreen.html", "offscreen.js", "audio-engine.js", "popup.html", "popup.css", "popup.js", "preview-api.js", "README.md", ...(await readdir(new URL("icons/", root))).map(file => `icons/${file}`)];
const table = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const entries = [], directory = [];
let offset = 0;
for (const file of files) {
  const name = Buffer.from(file);
  const body = await readFile(new URL(file, root));
  const compressed = deflateRawSync(body);
  let crc = 0xffffffff;
  for (const byte of body) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt16LE(33, 12);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt16LE(33, 14);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
  entries.push(local, name, compressed); directory.push(central, name);
  offset += local.length + name.length + compressed.length;
}
const directoryBody = Buffer.concat(directory);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directoryBody.length, 12); end.writeUInt32LE(offset, 16);
await mkdir(new URL("dist/", root), { recursive: true });
await writeFile(new URL("dist/sound-enhancer-98.zip", root), Buffer.concat([...entries, directoryBody, end]));
console.log(`Packaged ${files.length} extension files into dist/sound-enhancer-98.zip`);
