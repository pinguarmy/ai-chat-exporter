/**
 * Minimal reader for the PDFs this extension writes with jsPDF (uncompressed
 * content streams, hex strings, no embedded fonts). It returns the text objects
 * in stream order exactly as the exporter wrote them, decoded through each
 * font's own mapping:
 *
 *   - Helvetica resources use WinAnsiEncoding (Windows-1252);
 *   - the CID text-layer font uses its ToUnicode CMap (`bfchar` entries).
 *
 * It exists so the regression checks do not depend on which Poppler data
 * packages a machine has (Poppler cannot read a predefined CJK CMap without
 * `poppler-data`). It deliberately does not reorder anything: text drawn from
 * right-to-left scripts is stored in visual order, as in Chrome's own PDFs.
 */

/** Decode one `<hex>` string with a font's ToUnicode map, or as Windows-1252. */
function decodeHexString(hex, toUnicode) {
  if (toUnicode) {
    let out = ''
    for (let index = 0; index + 4 <= hex.length; index += 4) {
      out += toUnicode.get(Number.parseInt(hex.slice(index, index + 4), 16)) ?? '�'
    }
    return out
  }
  const bytes = new Uint8Array(hex.match(/../g)?.map(pair => Number.parseInt(pair, 16)) ?? [])
  return new TextDecoder('windows-1252').decode(bytes)
}

/** Parse the `bfchar` section of a ToUnicode CMap into code -> string. */
function parseToUnicode(cmap) {
  const map = new Map()
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, source, target] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      let text = ''
      for (let index = 0; index + 4 <= target.length; index += 4) {
        text += String.fromCharCode(Number.parseInt(target.slice(index, index + 4), 16))
      }
      map.set(Number.parseInt(source, 16), text)
    }
  }
  return map
}

/**
 * @param {Buffer | Uint8Array} bytes
 * @returns {{ mode: number, font: string, cid: boolean, text: string }[]}
 *   Text-showing operations in file order. `mode` is the text render mode:
 *   3 = invisible (searchable layer over the browser raster), 0/2 = drawn.
 */
export function extractPdfTextObjects(bytes) {
  const raw = Buffer.from(bytes).toString('latin1')
  const objects = new Map()
  for (const match of raw.matchAll(/(\d+) 0 obj([\s\S]*?)endobj/g)) objects.set(match[1], match[2])

  const fonts = new Map()
  for (const [, name, objectNumber] of raw.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
    const body = objects.get(objectNumber) ?? ''
    const toUnicodeRef = body.match(/\/ToUnicode (\d+) 0 R/)?.[1]
    fonts.set(name, {
      cid: /\/Subtype \/Type0/.test(body),
      toUnicode: toUnicodeRef ? parseToUnicode(objects.get(toUnicodeRef) ?? '') : null
    })
  }

  const result = []
  for (const block of raw.matchAll(/(?<=\n)BT\n([\s\S]*?)\nET(?=\n)/g)) {
    const text = block[1]
    const name = text.match(/\/(F\d+) [\d.]+ Tf/)?.[1] ?? ''
    const mode = Number(text.match(/\n(\d) Tr\n/)?.[1] ?? 0)
    const font = fonts.get(name) ?? { cid: false, toUnicode: null }
    for (const [, hex] of text.matchAll(/<([0-9a-fA-F]*)> Tj/g)) {
      result.push({ mode, font: name, cid: font.cid, text: decodeHexString(hex, font.toUnicode) })
    }
  }
  return result
}
