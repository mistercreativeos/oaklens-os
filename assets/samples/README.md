# Sample frames — CC0 (public domain)

Neutral placeholder photographs that ship **in the repo** so a fresh fork's
homepage, archive, and wall render real images with zero configuration (no
private R2 / CDN required). The live instance uses its own CDN; these are the
template defaults.

## License

These frames are original photographs by the project owner, who owns full
rights and **dedicates them to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)**. You may use,
modify, and redistribute them for any purpose, including in your own fork, with
no attribution required.

## Format

- `sample-hero-*.webp` — the front-page (folio) hero image.
- `sample-00-*.webp` … `sample-NN-*.webp` — archive / wall / recent-work frames.
- Each in three widths: `-480w`, `-1024w`, `-2048w` (the site's variant sizes).
- All EXIF / GPS / camera metadata is stripped (converted with `sharp`).

## How they render

`site.config.example.js` points `folioHero.image` at `sample-hero`. The archive
and wall fallback sample data reference `sample-NN` filenames; the worker's
`/api/cdn` handler falls back to `/assets/samples/<file>` on an R2 miss
(`worker.js`), so a fork with no CDN serves these through the normal image
pipeline. The CC0 sample field note (`posts/fn-sample.md` — the Field Notes /
homepage fallback) uses `sample-03` as its hero the same way. Swap in your own
frames + `data/*.json` when you have them.
