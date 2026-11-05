# EED SWApps React Template

A template repository for React projects in the EED Software Applications Group at SLAC National Accelerator Laboratory.

## What's included

- **React 19** with **TypeScript**
- **Vite** for fast dev server and builds
- **Vitest** + **React Testing Library** for unit/integration tests
- **ESLint** + **Prettier** + **Husky** pre-commit hooks for consistent code style
- **Zensical** (MkDocs-based) documentation site with GitHub Pages deployment
- GitHub Actions workflows for lint, type-check, test, and docs deployment

## Getting started

### Create a new project from this template

Click **Use this template** on GitHub, or clone and reinitialize:

```sh
git clone https://github.com/slaclab/eed-swapps-react-template.git my-app
cd my-app
git remote remove origin
```

### After cloning, update the project name

1. `package.json` — update `name` and `description`
2. `index.html` — update `<title>`
3. `pyproject.toml` — update `name` and `description`
4. `zensical.toml` — update `site_name`, `site_description`, `repo_name`, `repo_url`, and the social link

### Install dependencies

Requires [pnpm](https://pnpm.io/installation).

```sh
pnpm install
```

`@slaclab/canopy-screen-ir` comes from the public npm registry (0.3.0 and later), so no token or `.npmrc` is needed.

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
- **Build image and deploy dev** — builds the Docker image; on `main`, pushes it
  to GHCR and dispatches a dev deployment (see below)

## Deployment

Dev is deployed continuously: every push to `main` builds
`ghcr.io/slaclab/canopy-screen-builder`, then dispatches
[`slaclab/swapps-deployment`](https://github.com/slaclab/swapps-deployment),
which owns the Kubernetes manifests and Argo CD syncs them. Pull requests build
the image without pushing or deploying.

```text
https://dev.example.org/screen-builder
```

The dispatch needs `APP_ID` and `APP_PRIVATE_KEY` repository secrets; see
`docs/authentication.md` in `swapps-deployment` for the values and setup.

### The served app is not built like `pnpm dev`

Two things differ in the container, and both are load-bearing:

**It is served from a sub-path.** `BASE_PATH` (default `/screen-builder/`) is a
Docker build arg that sets Vite's `base`, so asset URLs are emitted with that
prefix, and it is also substituted into the nginx `location` blocks. It must
match the ingress path in `swapps-deployment`; if the two disagree, every asset
404s. `pnpm dev` leaves it `/`.

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
