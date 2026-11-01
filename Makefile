# Music Story Studio — dev commands. Run `make help`.
SHELL := /bin/bash
RUN_DIR := .run
BACKEND_PORT ?= 8000
WEB_PORT ?= 3000

.PHONY: help setup dev start stop restart logs test lint build clean update-ytdlp

help:
	@grep -E '^[a-z-]+:' Makefile | cut -d: -f1 | tr '\n' ' '; echo

setup: ## Install toolchain deps (macOS: Homebrew) and project deps
	@command -v ffmpeg >/dev/null || brew install ffmpeg
	@command -v pnpm >/dev/null || brew install pnpm
	@command -v uv >/dev/null || brew install uv
	@command -v yt-dlp >/dev/null || brew install yt-dlp
	@test -f .env || cp .env.example .env
	cd backend && uv sync --python 3.12
	@if [ -f package.json ]; then pnpm install; fi

dev: ## Run API + web in the foreground (Ctrl-C to stop)
	@trap 'kill 0' INT TERM; \
	(cd backend && uv run uvicorn app.main:app --reload --port $(BACKEND_PORT)) & \
	(if [ -d apps/web ]; then pnpm --filter web dev --port $(WEB_PORT); fi) & \
	wait

start: ## Run API (+ web) in the background
	@mkdir -p $(RUN_DIR)
	@cd backend && nohup uv run uvicorn app.main:app --port $(BACKEND_PORT) > ../$(RUN_DIR)/api.log 2>&1 & echo $$! > $(RUN_DIR)/api.pid
	@if [ -d apps/web ]; then nohup pnpm --filter web start --port $(WEB_PORT) > $(RUN_DIR)/web.log 2>&1 & echo $$! > $(RUN_DIR)/web.pid; fi
	@echo "started (logs: make logs)"

stop:
	@for f in $(RUN_DIR)/*.pid; do [ -f $$f ] && kill $$(cat $$f) 2>/dev/null; rm -f $$f; done; echo stopped

restart: stop start

logs:
	@tail -n 50 -f $(RUN_DIR)/*.log

test:
	cd backend && uv run pytest -q
	@if [ -d apps/web ]; then pnpm -r --if-present test; fi

lint:
	cd backend && uv run ruff check .
	@if [ -d apps/web ]; then pnpm -r --if-present lint; fi

build:
	@if [ -d apps/web ]; then pnpm -r --if-present build; fi

clean:
	rm -rf $(RUN_DIR) backend/.venv backend/.pytest_cache node_modules apps/*/node_modules apps/web/.next

update-ytdlp: ## yt-dlp breaks often; keep it fresh
	cd backend && uv lock --upgrade-package yt-dlp && uv sync
