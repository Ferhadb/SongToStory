# Contributing

1. Fork and clone, then run `make setup`.
2. Create a branch: `git checkout -b my-change`.
3. Make your change with tests where it makes sense.
4. Run `make lint test` and make sure both pass.
5. Open a pull request describing what changed and why.

## Project layout

- `backend/` – FastAPI app (`app/`) and pytest suite (`tests/`). Style: ruff, 100-column lines.
- `apps/web/` – Next.js editor. Tests live next to the code (`*.test.ts`).
- `packages/compositions/` – shared Remotion compositions; changes here affect both preview and export.

## Reporting bugs

Open an issue with the link type you pasted (not the link itself if private), what you expected, and the console/API log output.
