# Repository Guidelines

## Project Structure & Module Organization

This project contains a Chinese VitePress handbook and shared Docker tooling. Pages live in `docs/`; theme components in `docs/.vitepress/theme/`; scenario manifests in `scenarios/`; experiment sources in `labs/`. Node ESM helpers live in `scripts/lib/`, the CLI in `bin/`, and focused tests in `tests/`. Actions evidence belongs in `evidence/`.

## Build, Test, and Development Commands

Use Node.js 22.16+. Run `npm ci`, then `npm run docs:dev` for port 5178. `npm run docs:build` regenerates the portable scenario catalog and builds documentation. `npm run check:manifests` checks scenarios and local links. `npm test` runs Node's test runner with fixture processes, without Docker.

Use `node bin/hello-docker.mjs plan --manifest scenarios/container-basics.json` for offline plans. Container execution and publication belong to Linux GitHub Actions runners.

## Coding Style & Naming Conventions

Use two-space indentation, ESM imports, camelCase functions, PascalCase Vue components, and lowercase kebab-case routes/scenario IDs. Preserve Chinese explanations. Shared CSS and Chinese controls are copied from hello-world's canonical design templates; independent builds must not import files from the parent repository.

## Testing Guidelines

Test argument escaping, pinned images, source/output hashing, failed assertions, deadlines, cleanup, and publication boundaries. Fixtures must never be published as verified evidence. Historical evidence remains tied to its captured source. No coverage threshold is configured.

## Commit & Pull Request Guidelines

Use descriptive `feat:`, `fix:`, `docs:`, or `chore:` subjects. Explain affected scenarios, validations, and limitations; include screenshots for interface changes. Scope bot commits to approved evidence directories and generated pages. Preserve unrelated work.

## Execution Permissions

Before remote publication, Actions dispatch, large downloads, isolated environments, full or multi-browser testing, or substantial additional workloads, explain scope, expected time/resources, and remote effects; obtain explicit permission. Notification or silence is not approval. Prefer existing environments and directly relevant lightweight checks.
