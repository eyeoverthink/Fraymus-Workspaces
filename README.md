# Fraymus Workspaces / Nodular

The runnable application is **[`nodular-workspace`](nodular-workspace)**.
It includes the agent hub, MCP interoperability, native fleet skills, integrations,
automations, time audit/weekend tracker, creative Idea Finder, a user-controlled
browser/screenshot workflow, and the native Mega content draft chain.

**[Read the complete app guide](nodular-workspace/README.md)** for setup, real local
text/vision models, every page, approval boundaries, integrations, deployment,
storage/privacy, tests and troubleshooting.

```powershell
Set-Location .\nodular-workspace
npm ci --legacy-peer-deps
npm run models:configure
npm run models:test
npm run dev:all
```

Model configuration requires an already running Ollama with compatible installed
text/tool and vision models. It preserves selections in a local ignored `.env`;
no credentials or model weights belong in Git. Without models, explicitly labeled
offline functionality remains available. Open `http://localhost:5173`.

## Find the complete source on GitHub

Active implementation branch:
[`eyeoverthink-fleet-skills-automations`](https://github.com/eyeoverthink/Fraymus-Workspaces/tree/eyeoverthink-fleet-skills-automations).
Pushing that branch does **not** merge it into the default branch.
Use GitHub's branch selector to view it, or clone that branch:

```powershell
git clone --branch eyeoverthink-fleet-skills-automations https://github.com/eyeoverthink/Fraymus-Workspaces.git
```

All maintained application source is under `nodular-workspace`. Root-level ZIPs,
HTML prototypes and duplicate TypeScript files are historical inputs, not the
current runnable application. They are not substitutes for the app's package,
server or entrypoint.

**Safety:** local open mode is not safe for direct public exposure. Read the
authentication, data-retention and public-output warnings in the app guide before
deployment. Provider connections and rendered/published outputs are never claimed
merely because their names appear in a prompt or uploaded package.
