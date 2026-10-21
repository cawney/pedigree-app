# pedigree-app

Look at catalogs without using a bogged down app.

A fast, easy-to-use app for horse sale catalogs, built to compete with the
Equineline iPad app. Sale companies publish their catalogs as PDFs, usually one
pedigree page per hip. Pedigree keeps those catalogs on your device so you can
flip through them at the sale with no signal, mark them up, build a short list,
and send pages to anyone.

## Goals

1. **Compete with the Equineline iPad app.** iPad first, and it also works on
   iPhone, Android, and the web.
2. **Ease of use comes first.** If a more complex tool under the hood makes the
   app easier to use, we use that tool.
3. **Sharing never needs a login.** You export a page, a short list, or the
   whole book as a PDF and send it with Mail, Messages, or AirDrop. The person
   who receives it just gets a PDF.
4. **Catalogs are downloaded once and kept.** The server keeps every catalog
   it downloads, so anyone can come back later and add it to their library from
   the Available list.

## Features

| | Status |
| --- | --- |
| Add a catalog by link, from a PDF on the device, or from the shared Available list | ✅ |
| Catalogs saved on the device; they open with no internet | ✅ |
| Fast page viewer: swipe, tap the edges, pinch or double-tap to zoom, thumbnails, jump to page | ✅ |
| Remembers your page in every catalog | ✅ |
| Markup on any page: pen, highlighter, sticky notes, eraser, undo/redo; Apple Pencil pressure and palm rejection | ✅ |
| Short list: star any hip, then add a rating, tags (Vet, Inspect, your own), a private bid limit, and notes | ✅ |
| Smart filters: built-in ones (4★+, To vet…), plus search, catalog, rating, and tag filters you can save under a name | ✅ |
| Share one page, your short list (with a summary page), or the whole book as a PDF, with or without markup; short list as CSV | ✅ |
| Smart filters on horse details (sire, dam, sex, consignor) | Phase 4 |
| Jump straight to a hip number | Phase 4 |
| Optional account to sync across devices | Later |

## How it's built

```
server/   Rust (axum + SQLite). Downloads catalog PDFs, stores each one once, serves them.
app/      React + TypeScript + PDF.js, packaged for iOS/Android with Capacitor.
```

- **Server.** When a user pastes a link, the server downloads it. This avoids
  the cross-site download blocks browsers apply. Each link is checked first:
  it must be http or https, it can't point to a private network address, and
  the file must really be a PDF under the size limit. Files are stored by
  their SHA-256 hash, so a catalog is only kept once. Catalogs that users add
  stay *unlisted*, while catalogs an admin adds appear in the shared
  **Available** list.
- **App.** Catalogs are stored on the device: on iOS and Android in the app's
  private files, in a browser in IndexedDB. PDF.js reads only the parts of the
  file it needs, so a large catalog opens instantly. The pages before and
  after the current one are drawn ahead of time, so turning pages feels like
  a book.
- **Markup.** Tap **✎ Mark up** in the viewer. Marks are saved per page on the
  device, separate from the PDF, in page coordinates, so they stay sharp at
  any zoom and can be drawn into exported PDFs. Fingers draw until an Apple
  Pencil is first used. After that only the pencil draws, and fingers turn
  pages and zoom; the toolbar switches this back. In reading mode, tap a
  note to edit it.
- **Short list and sharing.** Tap ☆ on any page to add it to the short list
  and open its details panel. **Share** builds the PDF on the device with
  pdf-lib, drawing markup in at the exact on-screen position, then opens the
  share sheet (Mail, Messages, AirDrop) or downloads the file. Bid limits are
  left out of shared files unless you switch them on.

### Server API

| | |
| --- | --- |
| `GET /catalogs?company=&year=` | The Available list |
| `GET /catalogs/{id}` | One catalog's details |
| `GET /catalogs/{id}/file` | The PDF (supports byte ranges) |
| `POST /catalogs/fetch` `{"url": "..."}` | Download a catalog from a link |

## Running it

You need Rust (via [rustup](https://rustup.rs)) and Node 20+.

```sh
# 1. Server, on http://127.0.0.1:8080. Data goes to server/data/.
cd server
cargo run

# Add catalogs to the shared Available list (from a URL or a local PDF):
cargo run --bin admin -- add https://example.com/sale.pdf --company Keeneland --date 2026-09-08 --title "September Yearling Sale, Book 1"
cargo run --bin admin -- list --all
cargo run --bin admin -- edit <id> --title "New title"
cargo run --bin admin -- unlist <id>

# 2. App, on http://localhost:5173 (also reachable from a tablet on the same network)
cd app
npm install
npm run dev
```

Server settings (environment variables): `PEDIGREE_DATA_DIR` (default
`data`), `PEDIGREE_BIND` (default `127.0.0.1:8080`), and `PEDIGREE_MAX_PDF_MB`
(default 600). The app's dev server sends `/api` requests to the server. To
point it somewhere else, set `PEDIGREE_API`.

Tests: `cargo test` in `server/`, and `npm test` / `npm run typecheck` in `app/`.

### iPad / iPhone / Android builds

The app is packaged with [Capacitor](https://capacitorjs.com). Before the
first store build, set your own bundle id in `app/capacitor.config.ts`, and set
`VITE_API_URL` to the server's public address. The native apps can't use the
dev proxy.

```sh
cd app
npm run build
npx cap add android   # needs Android Studio / SDK
npx cap add ios       # needs a Mac with Xcode
npx cap sync
```

## Roadmap

1. ~~**Foundation:** server, library, viewer, offline storage~~ ✅
2. ~~**Markup:** draw, highlight, and add notes on pages, with Apple Pencil support. Saved separately from the PDF.~~ ✅
3. ~~**Short list + share:** flag hips, add notes and tags, export a PDF or CSV through the share sheet.~~ ✅
4. **Hip index + horse details:** the server reads each page for its hip number, sire, dam, sex, consignor, and so on. Then: jump to a hip, hip numbers filled in automatically, and smart filters on those details. Short list entries already have a place to store them.
5. **Later:** optional accounts and sync, sharing short lists with partners, finding new catalogs on sale-company sites automatically, App Store release through macOS CI.

## License

GPL-3.0. See [LICENSE](LICENSE).
