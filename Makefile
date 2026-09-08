PORT ?= 8080

.PHONY: help install serve stop test test-e2e test-all playwright

.DEFAULT_GOAL := help

help:
	@echo "Bihar Police Notebook — development"
	@echo ""
	@echo "  make install     Install npm devDependencies"
	@echo "  make serve       Serve editor/ at http://127.0.0.1:$(PORT)/ (restarts any running server)"
	@echo "  make stop        Kill whatever is listening on port $(PORT)"
	@echo "  make test        Unit tests (Vitest)"
	@echo "  make test-e2e    E2E tests (Playwright; starts its own server)"
	@echo "  make test-all    Unit + e2e"
	@echo "  make playwright  Install Playwright Chromium (first-time e2e)"
	@echo ""
	@echo "Override port: make serve PORT=3000"

install:
	npm install

serve: stop
	cd editor && python3 -m http.server $(PORT)

stop:
	@pids=$$(lsof -ti tcp:$(PORT) -sTCP:LISTEN); \
	if [ -n "$$pids" ]; then \
		echo "Stopping process on port $(PORT) (pid $$pids)"; \
		kill $$pids 2>/dev/null || true; \
		for i in 1 2 3 4 5 6 7 8 9 10; do \
			sleep 0.2; \
			lsof -ti tcp:$(PORT) -sTCP:LISTEN >/dev/null || break; \
		done; \
		kill -9 $$pids 2>/dev/null || true; \
	fi

test:
	npm test

# Browser resolution on macOS:
# 1. Cursor agents export PLAYWRIGHT_BROWSERS_PATH to an ephemeral sandbox cache
#    with no browsers in it, so always prefer the user's install. `?=` did not
#    do this — an inherited env var already counts as defined.
# 2. Playwright reads Apple Silicon off os.cpus(), which is empty in a sandboxed
#    shell; it then resolves a chrome-mac-x64 build that was never downloaded.
ifeq ($(shell uname),Darwin)
export PLAYWRIGHT_BROWSERS_PATH := $(HOME)/Library/Caches/ms-playwright
ifeq ($(shell uname -m)-$(shell node -p 'require("os").cpus().length' 2>/dev/null),arm64-0)
export PLAYWRIGHT_HOST_PLATFORM_OVERRIDE := mac$(shell sw_vers -productVersion | cut -d. -f1)-arm64
endif
endif

test-e2e:
	npm run test:e2e

test-all: test test-e2e

playwright:
	npx playwright install chromium
