# canopy-screen-builder

A drag-and-drop editor for control-system screens. Lay out widgets bound to
EPICS process variables on a canvas, set their properties, and save the result
as a screen IR document (`*.screen.json`) that
[canopy-screen-runtime](https://github.com/slaclab/canopy-screen-runtime)
renders.

- Widget palette, canvas with grid and snapping, component tree and property
  inspector, built on IBM's [Carbon](https://carbondesignsystem.com) components
- Several screens open at once, in tabs, with undo and redo
- Screen macros (`${P}:VAL`) and screen-level formulas
- Live preview against simulated PV data
- Save and open `*.screen.json`, validated against the screen IR schema from
  [`@slaclab/canopy-screen-ir`](https://www.npmjs.com/package/@slaclab/canopy-screen-ir)
- Import legacy EDM (`.edl`) and PyDM (`.ui`) screens through the converter API
  of a [Canopy](https://github.com/slaclab/canopy) backend
- Export a screen as React TSX (one way)

## Getting started

Requires Node.js and [pnpm](https://pnpm.io/installation).

```sh
pnpm install
pnpm dev
```

The editor works without a backend. Importing `.edl` and `.ui` files needs a
running Canopy: copy `.env.example` to `.env.local` and set
`VITE_CANOPY_BASE_URL` and `VITE_CANOPY_API_KEY` there.

## Development

| Command              | Description                                 |
| -------------------- | ------------------------------------------- |
| `pnpm dev`           | Start dev server at `http://localhost:5173` |
| `pnpm build`         | Type-check and build for production         |
| `pnpm preview`       | Preview production build locally            |
| `pnpm test`          | Run tests once                              |
| `pnpm test:watch`    | Run tests in watch mode                     |
| `pnpm test:coverage` | Run tests with coverage report              |
| `pnpm lint`          | Run ESLint                                  |
| `pnpm lint:fix`      | Run ESLint with auto-fix                    |
| `pnpm format`        | Format source files with Prettier           |
| `pnpm format:check`  | Check formatting without writing            |

## Documentation

The `docs/` directory contains a [Zensical](https://zensical.org) documentation site. To preview it locally:

```sh
uv sync
uv run zensical serve
```

Docs are automatically built and deployed to GitHub Pages on pushes to `main`.

## CI

These GitHub Actions workflows run on pull requests and pushes to `main`:

- **Lint & Format** — ESLint, Prettier, and TypeScript type-check
- **Test** — Vitest test suite
- **Build & Deploy Documentation** — builds the Zensical docs site and deploys to GitHub Pages
- **Build Image** — builds the Docker image; on `main`, pushes it to GHCR

## Deployment

The builder ships as the `ghcr.io/slaclab/canopy-screen-builder` image. Every
push to `main` publishes it as `:<short sha>` and `:latest`; pull requests
build it without pushing. It talks to a Canopy backend for the converter, so
run it next to one.

SLAC deploys the builder from an internal repository; this repository holds
only the generic pieces: the image and the notes below.

### The served app is not built like `pnpm dev`

Two things differ in the container, and both are load-bearing:

**It is served from a sub-path.** `BASE_PATH` (default `/screen-builder/`) is a
Docker build arg that sets Vite's `base`, so asset URLs are emitted with that
prefix, and it is also substituted into the nginx `location` blocks. It must
match the path your ingress or reverse proxy serves the app under; if the two
disagree, every asset 404s. `pnpm dev` leaves it `/`.

**The converter API key stays server-side.** Locally, `.env.local` sets
`VITE_CANOPY_API_KEY` and the browser sends `X-API-Key` itself. That is not
viable in a deployed build: Vite inlines `import.meta.env` values into the JS
bundle, so the key would be readable by anyone who loads the page. Instead the
image sets `VITE_CANOPY_BASE_URL` to a same-origin _path_
(`/screen-builder/canopy`), and the container's nginx proxies that to Canopy and
adds the key from a Kubernetes secret. There is deliberately no
`VITE_CANOPY_API_KEY` build arg.

### Running the image locally

```sh
docker build -t canopy-screen-builder .
docker run --rm -p 8080:8080 \
  -e CANOPY_UPSTREAM=http://host.docker.internal:8000 \
  -e CANOPY_API_KEY=dev \
  canopy-screen-builder
# http://localhost:8080/screen-builder/
```

Runtime environment variables:

| Variable          | Default                  | Description                                                                                                                                                                                    |
| ----------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BASE_PATH`       | `/screen-builder/`       | URL prefix, with trailing slash. Must match the value built into the image.                                                                                                                    |
| `CANOPY_UPSTREAM` | `http://canopy-api:8000` | Canopy base URL, no trailing slash. In Kubernetes use the fully qualified Service name (`canopy-api.<ns>.svc.cluster.local`); nginx's `resolver` ignores search domains, so a short name 502s. |
| `CANOPY_API_KEY`  | (empty)                  | Canopy read key that nginx attaches to converter requests.                                                                                                                                     |

The app serves even when Canopy is unreachable — nginx resolves the upstream per
request, so conversions return 502 while static content keeps working, rather
than the container failing to start.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues as described in
[SECURITY.md](SECURITY.md), not in public issues.

## License

See [LICENSE.md](LICENSE.md).
