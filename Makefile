PORT ?= 8080

.PHONY: help install serve test test-e2e test-all playwright

.DEFAULT_GOAL := help

help:
	@echo "Bihar Police Notebook — development"
	@echo ""
	@echo "  make install     Install npm devDependencies"
	@echo "  make serve       Serve editor/ at http://127.0.0.1:$(PORT)/"
	@echo "  make test        Unit tests (Vitest)"
	@echo "  make test-e2e    E2E tests (Playwright; starts its own server)"
	@echo "  make test-all    Unit + e2e"
	@echo "  make playwright  Install Playwright Chromium (first-time e2e)"
	@echo ""
	@echo "Override port: make serve PORT=3000"

install:
	npm install

serve:
	cd editor && python3 -m http.server $(PORT)

test:
	npm test

test-e2e:
	npm run test:e2e

test-all: test test-e2e

playwright:
	npx playwright install chromium
