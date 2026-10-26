# Text to STL

A free, in-browser tool that turns text into 3D-printable STL files.

- Pick from 16 bundled open-source fonts (or upload your own `.ttf` / `.otf`)
- Set letter height, thickness, letter spacing and line spacing in millimetres
- Flat, chamfered or rounded letter edges
- Optional base plate (square, rounded or pill) with an optional keychain hole
- Live 3D preview, then download a binary STL (units: mm, lying flat, Z up)
- "Separate letters & plate" downloads two aligned STLs for 2-color printing

Everything runs client-side (three.js + opentype.js); there is no server.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

## Fonts

Bundled fonts in `public/fonts/` come from [Google Fonts](https://github.com/google/fonts) and are licensed under the SIL Open Font License or Apache 2.0.
