# Text to STL

A free, in-browser tool that turns text into 3D-printable STL files.

- Pick from 16 bundled open-source fonts (or upload your own `.ttf` / `.otf`)
- Set letter height, thickness, letter spacing and line spacing in millimetres
- Flat, chamfered or rounded letter edges
- Optional base plate: **Outline** (follows the shape of the letters like a sticker border, offset with clipper-lib), square, rounded or pill, with an optional keychain hole
- Optional second layer under the plate for a stepped border, with its own thickness, border width and preview colour
- Text on the plate can be raised (embossed) or cut in (engraved) to a chosen depth; engraved plates are built as one watertight solid via 2D boolean ops (polygon-clipping)
- Live 3D preview, then download a binary STL (units: mm, lying flat, Z up)
- "Separate letters & plate" downloads two aligned STLs for 2-color printing (for engraved plates: the plate plus letter inlays that fill the engraving)

Everything runs client-side (three.js + opentype.js); there is no server.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

## Fonts

Bundled fonts in `public/fonts/` come from [Google Fonts](https://github.com/google/fonts) and are licensed under the SIL Open Font License or Apache 2.0.
