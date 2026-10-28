# Nodular Workspace - common tasks. Needs Node 22+ and npm (make is optional: every target is a thin wrapper over npm scripts).
.PHONY: help install dev server build typecheck test test-mcp test-media agents mcp-check token docker clean

help:
	@echo "make install    - npm ci --legacy-peer-deps"
	@echo "make dev        - API :3001 + Vite :5173"
	@echo "make server     - API only (serves dist/ if built)"
	@echo "make build      - production UI build"
	@echo "make typecheck  - tsc --noEmit"
	@echo "make test       - boot a temp server, run all e2e suites (mock LLM)"
	@echo "make test-mcp   - MCP client bridge test (fake MCP server)"
	@echo "make test-media - real HyperFrames render (needs Chrome + FFmpeg)"
	@echo "make agents     - list agent manifests in agents/"
	@echo "make mcp-check  - print the MCP endpoint + how to mint a token"
	@echo "make docker     - build + run via docker compose"

install:
	npm ci --legacy-peer-deps

dev:
	npm run dev:all

server:
	npm run server

build:
	npm run build

typecheck:
	npx tsc --noEmit

test: typecheck
	npm test

test-mcp:
	npx tsx scripts/test-mcp.ts

test-media:
	npx tsx scripts/test-media.ts

agents:
	@node -e "for (const f of require('fs').readdirSync('agents')) { const t=require('fs').readFileSync('agents/'+f,'utf8'); console.log(f.padEnd(28), (/^role: (.*)$$/m.exec(t)||[])[1]||'') }"

mcp-check:
	@echo "MCP endpoint : http://localhost:3001/mcp  (POST, Authorization: Bearer <token>)"
	@echo "OAuth token  : http://localhost:3001/oauth/token (client_credentials)"
	@echo "Mint a token : open the app -> Connect tab, or set MCP_ADMIN_TOKEN (24+ chars) in .env"

docker:
	docker compose up --build -d

clean:
	npm run clean
