# ChatGPT layout markup in PDF exports

## Why tags appeared

ChatGPT API text is authoritative for message order and branch selection. The exporter previously treated component markup such as `<grid columns={3}>` as ordinary Markdown. Escaping it was safe, but made the component source visible in preview and PDF. The PDF downloader did not introduce those tags.

## Supported static subset

ChatGPT assistant messages now render standalone, balanced raw `grid`, `grid-item`, `box`, `caption` and `title` blocks as inert HTML in preview and PDF. This restores the reported three-column status cards without evaluating JSX, compiling components or loading ChatGPT scripts.

- `grid` accepts `columns` from 1 to 4 and `gap` from 0 to 8.
- `box` accepts `padding` and `gap` from 0 to 8, `radius` of `none/sm/md/lg`, and `background` of `surface-primary/surface-secondary`.
- `title` accepts `size` of `sm/md/lg/xl` and `color` of `default/secondary`.
- Integers may use braces or quotes. String values must be quoted. Spacing uses a local 4px scale, not a verified ChatGPT design token mapping.
- Source blocks must begin on their own line. Blank lines terminate a candidate. Each block is limited to 64,000 characters, 1,000 tokens and bounded nesting. Messages above 256,000 characters use the original text renderer.

Recognized candidate blocks with unknown tags, attributes, JSX expressions or malformed structure are escaped as literal source, without converting their Markdown into images or links. Messages above the overall size limit bypass recognition and retain the previous Markdown behavior. Initial indentation may already have been trimmed by upstream content filtering, so fenced code is the reliable way to retain a leading layout example as source. A complete grid followed by an orphan `</box>` renders the grid and leaves the orphan visible, rather than silently deleting source. Ordinary code fences, including unverified candidate UI fence labels, remain code. User messages and other providers keep their previous behavior. Markdown and archive content are unchanged.

This is not a full ChatGPT UI runtime or a pixel-perfect page clone. Buttons, charts, stateful widgets, arbitrary HTML/CSS, exact theme tokens and unknown transport envelopes are not supported. The supplied fragment did not establish whether the actual provider message uses a dedicated UI code fence. No logged-in provider session or original failing PDF was inspected in this investigation.

## Verification

`tests/static-chatgpt-ui.test.ts` covers the supplied card structure, orphan closing tags, preview/PDF parity, code examples, provider/role boundaries, dangerous attributes and parser limits. `npm run test:browser` additionally renders three columns in the built Chromium extension, downloads a real PDF and verifies that Markdown still contains the original source. Set `STATIC_UI_ARTIFACT_DIR` to save the PDF and preview screenshot.

On 2026-10-22, `npm run test:coverage` passed 97 files / 1,131 tests with the existing core coverage gate; `npm run lint` passed; `npm audit --omit=dev` reported zero vulnerabilities; the separate feedback backend suite passed 12 tests. The built Chromium smoke passed, including real Markdown/PDF downloads. The saved one-page PDF was rasterized with macOS PDFKit and visually inspected: all three grey rounded cards and Chinese labels/values were present. No original failing PDF or logged-in provider export was tested.

The local checkout was fast-forwarded from `d760b04` to GitHub main `9e6dea0` before implementation. The old revision remains recoverable through `archive/local-before-ui-pdf-20261022`; it is not a separate obsolete source directory. The Documents project path is a symlink to the canonical Projects checkout, not a duplicate copy.
