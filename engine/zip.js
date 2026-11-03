/* YouScope — zip.js
 * Minimal ZIP reader for Takeout exports (stored + deflate), browser & Node.
 * Depends on fflate's inflateSync when available; falls back to DecompressionStream
 * in browsers, and Node zlib elsewhere.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YSZip = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // find End of Central Directory
  function findEocd(buf) {
    const min = Math.max(0, buf.length - 65557);
    for (let i = buf.length - 22; i >= min; i--) {
      if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) return i;
    }
    return -1;
  }

  async function inflateRaw(data) {
    if (typeof fflate !== 'undefined' && fflate.inflateSync) {
      return fflate.inflateSync(data); // sync path (bundled)
    }
    if (typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('deflate-raw');
      const stream = new Blob([data]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    if (typeof require === 'function') {
      const zlib = require('zlib');
      return new Uint8Array(zlib.inflateRawSync(Buffer.from(data)));
    }
    throw new Error('No inflate implementation available');
  }

  /**
   * Read a Takeout zip. Returns [{name, text}] for text entries (html/csv/json),
   * skipping media binaries. onFile(name, index, total) for progress.
   */
  async function readTakeoutZip(buf, onFile) {
    buf = new Uint8Array(buf);
    const eocd = findEocd(buf);
    if (eocd < 0) throw new Error('Not a zip file (no End-of-Central-Directory found).');
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let entryCount = dv.getUint16(eocd + 10, true);
    let ptr = dv.getUint32(eocd + 16, true);

    // ZIP64 support: EOCD may carry 0xFFFF/0xFFFFFFFF placeholders → zip64 locator
    const z64loc = eocd - 20;
    if (z64loc >= 0 && dv.getUint32(z64loc, true) === 0x07064b50) {
      const z64eocd = Number(dv.getBigUint64(z64loc + 8, true));
      if (dv.getUint32(z64eocd, true) === 0x06064b50) {
        entryCount = Number(dv.getBigUint64(z64eocd + 32, true));
        ptr = Number(dv.getBigUint64(z64eocd + 48, true));
      }
    }

    const files = [];
    for (let i = 0; i < entryCount; i++) {
      if (dv.getUint32(ptr, true) !== 0x02014b50) break; // central dir header
      const method = dv.getUint16(ptr + 10, true);
      let compSize = dv.getUint32(ptr + 20, true);
      let uncompSize = dv.getUint32(ptr + 24, true);
      const nameLen = dv.getUint16(ptr + 28, true);
      const extraLen = dv.getUint16(ptr + 30, true);
      const commentLen = dv.getUint16(ptr + 32, true);
      let localOff = dv.getUint32(ptr + 42, true);
      const name = new TextDecoder().decode(buf.subarray(ptr + 46, ptr + 46 + nameLen));

      // parse zip64 extra field (id 0x0001) for any placeholder values
      if (compSize === 0xFFFFFFFF || uncompSize === 0xFFFFFFFF || localOff === 0xFFFFFFFF || extraLen > 0) {
        let ep = ptr + 46 + nameLen;
        const epEnd = ep + extraLen;
        while (ep + 4 <= epEnd) {
          const hid = dv.getUint16(ep, true);
          const hsz = dv.getUint16(ep + 2, true);
          if (hid === 0x0001) {
            let hp = ep + 4;
            if (uncompSize === 0xFFFFFFFF && hp + 8 <= epEnd) { uncompSize = Number(dv.getBigUint64(hp, true)); hp += 8; }
            if (compSize === 0xFFFFFFFF && hp + 8 <= epEnd) { compSize = Number(dv.getBigUint64(hp, true)); hp += 8; }
            if (localOff === 0xFFFFFFFF && hp + 8 <= epEnd) { localOff = Number(dv.getBigUint64(hp, true)); hp += 8; }
          }
          ep += 4 + hsz;
        }
      }
      ptr += 46 + nameLen + extraLen + commentLen;

      if (localOff >= buf.length || localOff + 30 > buf.length) continue;
      // local header: skip name+extra there too (may differ)
      if (dv.getUint32(localOff, true) !== 0x04034b50) continue;
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      if (dataStart + compSize > buf.length) continue;
      const comp = buf.subarray(dataStart, dataStart + compSize);

      onFile && onFile(name, i, entryCount);
      if (/\.(html?|csv|json|txt)$/i.test(name) && compSize > 0) {
        let bytes;
        if (method === 0) bytes = comp;
        else if (method === 8) bytes = await inflateRaw(comp);
        else continue;
        files.push({ name, text: new TextDecoder('utf-8').decode(bytes) });
      }
    }
    return files;
  }

  return { readTakeoutZip };
});
