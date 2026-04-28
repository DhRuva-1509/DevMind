# DevMind

> **DevMind** is an AI-powered VS Code extension that acts as an intelligent coding companion, detecting deprecated API usage, explaining merge conflicts, generating PR summaries, surfacing tribal knowledge from past reviews, and letting you pin live documentation directly into your AI context, all without leaving your editor.

---

## Table of Contents

- [Overview](#overview)
- [Problem Statement](#problem-statement)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Dependencies](#dependencies)
- [Installation and Setup](#installation-and-setup)
- [Project Structure](#project-structure)
- [Agent AI Design Patterns](#agent-ai-design-patterns)
- [User Manual](#user-manual)
- [Acknowledgement](#acknowledgement)

---

## Overview

DevMind is a multi-agent VS Code extension built on Azure OpenAI, Azure AI Search, Azure Cosmos DB, and the Model Context Protocol (MCP). It bundles six purpose-built AI agents behind a unified chat interface and a set of editor commands, so developers can get actionable intelligence, deprecation warnings, conflict explanations, PR summaries, historic code-review feedback, and live documentation context, without switching tools or losing focus.

Each agent is independently activatable via a keyboard shortcut or the Command Palette, and all AI interactions are routed through a lightweight classifier that maps your natural language input to the right agent automatically.

---

## Problem Statement

Modern JavaScript and TypeScript projects evolve fast. Libraries ship breaking changes, APIs are silently deprecated, merge conflicts pile up, and institutional knowledge from code reviews lives and dies in pull request comment threads. Developers waste hours:

- Manually checking changelogs to find out if an API they are using has been renamed or removed in their current library version.
- Deciphering cryptic merge conflicts with no context about what either branch was trying to achieve.
- Writing PR descriptions from scratch even when the diff tells most of the story.
- Re-learning lessons that were already discovered in past PRs because that knowledge is buried in GitHub comments.
- Switching back and forth between documentation sites and the editor every time they need to check an API signature.

DevMind solves all five pain points from inside VS Code, backed by Azure AI infrastructure that keeps your data in your own cloud tenant.

---

## Features

### Version Guard
Scans open JavaScript/TypeScript files and flags deprecated or removed API calls based on the exact library versions installed in your `package.json`. It crawls and indexes official library documentation into Azure AI Search, then uses Azure OpenAI (GPT-4o) to match your code against those docs and produce inline warnings with one-click quick fixes.

- Triggered automatically on file save or manually via `Cmd+Shift+V`
- Configurable confidence threshold (default 0.7) to control warning noise
- Inline diagnostics with suggested replacement code that can be applied directly
- Feature toggle to disable without uninstalling

### PR Summary Agent
Generates a structured Markdown summary for any GitHub pull request list of changed files, detected code patterns, and linked issues using Azure AI Foundry's agent service. Handles large PRs by chunking the diff and merging partial summaries. Results are cached in Cosmos DB and automatically refreshed when the PR is updated.

### Conflict Explainer
Parses git merge conflict markers in the active file and explains the *intent* behind each conflicting side using GPT-4o. Includes a suggested resolution strategy in plain English. Uses a reflection loop (up to two retries) to ensure the explanation meets a minimum confidence threshold before showing it to you. It never resolves conflicts automatically you stay in control.

- Navigate conflicts with `Alt+]` / `Alt+[`
- Trigger explanations with `Cmd+Shift+E`

### Nitpick Fixer
Runs your project's configured linters (ESLint, Prettier, etc.) on the `src` directory, collects auto-fixable issues, applies them, presents a diff for your review, and with your confirmation — stages and commits the changes. Telemetry is written to Cosmos DB.

- Triggered via `Cmd+Shift+N`
- Auto-commit is configurable and requires explicit confirmation

### Tribal Knowledge Agent
Indexes all PR review comments from your GitHub repository into Azure AI Search. When you open a PR or change a file, it searches that index for past comments that are semantically similar to your current changes and surfaces them as contextual warnings. Warnings link back to the original PR so you can read the full discussion.

- Sync the index with `Cmd+Shift+K`
- Configurable sensitivity threshold to tune how aggressively past feedback is surfaced

### Live Source Agent
Lets you pin any documentation URL or PDF and inject its content as additional context into every subsequent AI chat message. Pages are crawled, chunked, embedded, and stored in a temporary Azure AI Search session. Pinned sources appear in the status bar.

- Pin a URL or PDF with `Cmd+Shift+I`
- Unpin or list pinned sources via the Command Palette
- Token budget cap prevents context overflow (default 2,000 tokens per query)
- Up to five simultaneous pinned sources

### Chat & Routing Agent
A unified chat panel (`Cmd+Shift+D`) accepts natural language questions and automatically routes them to the correct agent using a GPT-4o classifier. You do not need to know which agent handles what — just ask.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Editor | VS Code Extension API (TypeScript) |
| Language model | Azure OpenAI — GPT-4o |
| Embeddings | Azure OpenAI — text-embedding-3-small |
| Vector search | Azure AI Search |
| Agent orchestration | Azure AI Foundry (Agent Service) |
| Database / cache | Azure Cosmos DB (NoSQL) |
| Blob storage | Azure Blob Storage |
| Secrets | Azure Key Vault |
| Observability | Azure Monitor OpenTelemetry |
| GitHub integration | Octokit REST + Model Context Protocol (MCP) |
| HTML crawling | Cheerio + Axios |
| Token counting | Tiktoken |
| Infrastructure | Azure Bicep |

---

## Dependencies

### Runtime dependencies

| Package | Purpose |
|---|---|
| `@azure/ai-projects` | Azure AI Foundry agent execution |
| `@azure/core-auth` | Azure credential types |
| `@azure/cosmos` | Cosmos DB client |
| `@azure/identity` | DefaultAzureCredential / managed identity |
| `@azure/keyvault-secrets` | Key Vault secret resolution |
| `@azure/monitor-opentelemetry` | Telemetry export to Azure Monitor |
| `@azure/search-documents` | Azure AI Search index and query client |
| `@azure/storage-blob` | Blob Storage for raw documentation pages |
| `@modelcontextprotocol/sdk` | MCP server/client for GitHub tool calls |
| `@octokit/rest` | GitHub REST API client |
| `axios` | HTTP client for documentation crawling |
| `cheerio` | HTML parsing and text extraction |
| `dotenv` | Environment variable loading |
| `openai` | Azure OpenAI chat completions and embeddings |
| `tiktoken` | Accurate token estimation |

### Development dependencies

| Package | Purpose |
|---|---|
| `typescript` | Language compiler |
| `eslint` + `eslint-plugin-prettier` | Linting |
| `prettier` | Code formatting |
| `mocha` + `chai` + `sinon` | Unit testing |
| `@vscode/test-electron` | VS Code integration testing |
| `ts-node` | TypeScript execution for scripts |

---

## Installation and Setup

### Prerequisites

- **Node.js** >= 18
- **VS Code** >= 1.109.0
- An **Azure subscription** with the following services provisioned (see `infra/` for Bicep templates):
  - Azure OpenAI (GPT-4o deployment + embedding deployment)
  - Azure AI Search
  - Azure Cosmos DB (NoSQL)
  - Azure Blob Storage
  - Azure Key Vault
  - Azure AI Foundry project (for PR Summary Agent)

### 1. Clone the repository

```bash
git clone git@github.com:DhRuva-1509/DevMind.git
cd devmind
```

### 2. Install dependencies

```bash
npm install
```

### 3. Provision Azure infrastructure

```bash
cd infra
bash deploy.sh
```

The Bicep templates in `infra/modules/` create all required Azure resources. Edit `infra/parameters/dev.bicepparam` to set your resource names, SKUs, and capacity values before deploying.

> **Note:** Azure AI Search can be deployed to a different region than your other resources (useful when capacity is constrained). Set the `searchLocation` parameter in `dev.bicepparam` to override the region for AI Search independently of the main `location` parameter.

### 4. Configure environment variables

Create a `.env` file in the project root (next to `package.json`):

```env
AZURE_OPENAI_ENDPOINT=https://<your-resource>.openai.azure.com
AZURE_SEARCH_ENDPOINT=https://<your-search>.search.windows.net
AZURE_KEYVAULT_URL=https://<your-vault>.vault.azure.net
AZURE_COSMOS_ENDPOINT=https://<your-cosmos>.documents.azure.com:443/
AZURE_STORAGE_CONNECTION_STRING=<your-storage-connection-string>
AZURE_FOUNDRY_PROJECT_ENDPOINT=<your-foundry-project-endpoint>
GITHUB_TOKEN=<your-github-personal-access-token>
```

Alternatively, point `devmind.azure.keyVaultUrl` in VS Code settings to your Key Vault and store secrets there. `DefaultAzureCredential` is used for authentication, so local development works with `az login`.

### 5. Configure VS Code settings

Open VS Code settings (`Cmd+,`) and search for `DevMind`. The following settings are available:

| Setting | Default | Description |
|---|---|---|
| `devmind.versionGuard.enabled` | `true` | Enable or disable Version Guard |
| `devmind.versionGuard.minConfidence` | `0.7` | Minimum confidence (0–1) to surface a warning |
| `devmind.versionGuard.topK` | `8` | Documentation chunks retrieved per analysis query |
| `devmind.versionGuard.projectId` | `""` | Scopes the documentation index (defaults to workspace folder name) |
| `devmind.azure.openaiEndpoint` | `""` | Azure OpenAI endpoint URL |
| `devmind.azure.searchEndpoint` | `""` | Azure AI Search endpoint URL |
| `devmind.azure.keyVaultUrl` | `""` | Azure Key Vault URL for secret resolution |

### 6. Build and run

```bash
# Compile TypeScript
npm run compile

# Watch mode (recompiles on save)
npm run watch
```

Press `F5` in VS Code to launch the **Extension Development Host** with DevMind loaded.

### 7. Run tests

```bash
# All unit tests
npm test

# Unit tests only
npm run test:unit

# VS Code integration tests
npm run test:vscode
```

---

## Project Structure

```
devmind/
├── infra/                              # Azure Bicep IaC
│   ├── main.bicep                      # Root module (all resources)
│   ├── deploy.sh                       # Deployment script
│   ├── modules/
│   │   ├── openai.bicep
│   │   ├── search.bicep
│   │   ├── cosmos.bicep
│   │   ├── storage.bicep
│   │   ├── keyvault.bicep
│   │   └── loganalytics.bicep
│   └── parameters/
│       └── dev.bicepparam
├── src/
│   ├── extension.ts                    # Extension entry point — wires all agents and commands
│   ├── functions/
│   │   └── pr-webhook/                 # Azure Function webhook for PR events
│   └── services/
│       ├── agents/                     # Version Guard agent + code pattern extractor
│       ├── azure/                      # Azure service wrappers
│       │   ├── auth/                   # Credential helpers
│       │   ├── blob/                   # Blob Storage client
│       │   ├── cosmos/                 # Cosmos DB client
│       │   ├── foundry/                # AI Foundry agent runner
│       │   ├── keyvault/               # Key Vault secret client
│       │   ├── openai/                 # OpenAI completions + embeddings
│       │   └── search/                 # AI Search index + query client
│       ├── conflict-explainer/         # ConflictExplainerAgent
│       ├── conflict-explainer-ui/      # CodeLens, hover, and panel for conflicts
│       ├── conflict-parser/            # Git conflict marker parser
│       ├── crawler/                    # Static documentation crawler
│       ├── dynamic-doc-crawler/        # Dynamic (depth-first) documentation crawler
│       ├── linter/                     # ESLint + Prettier integration
│       ├── live-source-agent/          # LiveSourceAgent — pin docs into AI context
│       ├── mcp/                        # GitHub and terminal MCP clients
│       ├── nitpick-fixer/              # NitpickFixerAgent
│       ├── nitpick-fixer-ui/           # Nitpick diff panel and UI
│       ├── parser/                     # package.json dependency parser
│       ├── pr-comment/                 # GitHub PR comment poster
│       ├── pr-comment-exporter/        # PR comment export for tribal knowledge
│       ├── pr-context/                 # PR context extractor + reflection service
│       ├── pr-summary/                 # PRSummaryAgent
│       ├── pr-summary-panel/           # PR summary webview panel
│       ├── prompt-templates/           # Versioned prompt template service
│       ├── routing/                    # RoutingAgentService — intent classifier
│       ├── search/                     # Documentation index service
│       ├── temp-index-manager/         # Temporary AI Search session manager
│       ├── tribal-knowledge-agent/     # TribalKnowledgeAgent
│       ├── tribal-knowledge-indexer/   # PR comment indexer for tribal knowledge
│       └── ui/                         # Version Guard panel + diagnostics UI
├── package.json
├── tsconfig.json
└── esbuild.js
```

---

## Agent AI Design Patterns

DevMind is built around two foundational agentic design patterns. Understanding them helps explain why the system behaves the way it does and how its agents stay accurate under varied conditions.

---

### Routing Pattern — Chat Interface

**Where:** `src/services/routing/routing.agent.service.ts`

The chat panel accepts unconstrained natural language input. Rather than hard-coding keyword triggers, DevMind feeds every message to a lightweight GPT-4o classifier that outputs a structured route label and a confidence score.

```
User message
     │
     ▼
┌─────────────────────────┐
│   LLM Classifier        │  ← GPT-4o, system prompt listing 5 routes
│   (single LLM call)     │
└────────────┬────────────┘
             │  { route, confidence }
             ▼
     confidence ≥ 0.5?
      ┌──────┴──────┐
     Yes            No
      │              │
      ▼              ▼
 Dispatch agent   "unknown" fallback
                  (help message shown)
```

**Possible routes:** `version-guard` · `pr-summary` · `conflict-explainer` · `nitpick-fixer` · `live-source-agent` · `unknown`

The classifier is intentionally narrow — it uses at most 50 output tokens and returns raw JSON. A confidence threshold of 0.5 (configurable) prevents low-certainty classifications from triggering the wrong agent; anything below falls through to a friendly help message listing all available commands with examples.

---

### Reflection Pattern — PR Summarizer

**Where:** `src/services/pr-context/pr.context.reflection.service.ts`

Extracting useful context from a large pull request is a noisy operation — diffs can be enormous, commits sparse, and pattern detection unreliable on the first pass. The PR context service wraps extraction in a reflection loop that validates the output against a set of quality checks and retries with tighter constraints if any check fails.

```
              extractFn(tokenBudget)
                      │
                      ▼
           ┌──────────────────────┐
           │  Quality Checks      │
           │  1. Token budget     │  ← total tokens ≤ budget
           │  2. Field presence   │  ← files, diffs, commits non-empty
           │  3. Pattern coverage │  ← ≥ 1 code pattern detected
           └──────────┬───────────┘
                      │
              All checks pass?
              ┌────────┴────────┐
             Yes               No
              │                 │
              ▼                 ▼
         Return context    Retries left?
                           ┌─────┴──────┐
                          Yes           No
                           │             │
                           ▼             ▼
                   budget × 0.75    Return best-effort
                   → retry          (qualityFlag: 'degraded')
```

**Retry budget progression (default 2 retries):**

| Attempt | Token budget |
|---------|-------------|
| 1       | 6,000       |
| 2       | 4,500       |
| 3       | 3,375       |

Progressively shrinking the budget forces the extractor to be more selective on each retry, pruning noise rather than simply re-running the same extraction. If all attempts are exhausted, the service returns the last result with a `qualityFlag: 'degraded'` marker and logs the failure reasons to Cosmos DB — the summarizer still runs, just with reduced context.

This pattern is also used by the **Conflict Explainer** (`src/services/conflict-explainer/conflict.explainer.agent.ts`), where the validation errors from one LLM attempt are fed back into the next prompt as explicit feedback, allowing the model to self-correct its explanation before the result is shown to you.

---

## User Manual

### Version Guard

**Purpose:** Detects deprecated or removed API calls in your JS/TS files based on the library versions declared in your `package.json`.

**Before first use:** Index at least one library's documentation.

1. Open the Command Palette (`Cmd+Shift+P`) and run **DevMind: Index Library**.
2. Enter the library name (e.g. `@tanstack/react-query`). DevMind will crawl the official docs and store them in Azure AI Search.
3. Open any TypeScript or JavaScript file that imports the library.
4. Press `Cmd+Shift+V` (Windows: `Ctrl+Shift+V`) or run **DevMind: Analyze Current File** from the Command Palette.
5. Warnings appear as inline squiggles. Hover to read the explanation. Click the lightbulb to apply the suggested quick fix.

To see all indexed libraries, run **DevMind: Show Indexed Libraries** or press the shield icon in the status bar.

---

### PR Summary

**Purpose:** Generates a structured summary of a GitHub pull request.

1. Open the Command Palette and run **DevMind: Generate PR Summary**.
2. Enter the GitHub repository (`owner/repo`) and the PR number.
3. The summary panel opens with a Markdown summary including changed files, detected code patterns, and linked issues.
4. The summary is cached in Cosmos DB and refreshes automatically if the PR is updated.

---

### Conflict Explainer

**Purpose:** Explains what each side of a git merge conflict was trying to accomplish and suggests a resolution strategy.

1. Open a file that contains merge conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).
2. Press `Cmd+Shift+E` (Windows: `Ctrl+Shift+E`) or run **DevMind: Explain Conflicts in File**.
3. The conflict panel opens, showing the intent of each side and a plain-English resolution strategy for every conflict block in the file.
4. Navigate between conflicts using `Alt+]` (next) and `Alt+[` (previous).
5. Use the standard VS Code conflict resolution UI to accept, reject, or edit — DevMind never applies a resolution for you.

---

### Nitpick Fixer

**Purpose:** Runs all configured linters, applies auto-fixable issues, shows you a diff, and (optionally) commits the result.

1. Press `Cmd+Shift+N` (Windows: `Ctrl+Shift+N`) or run **DevMind: Fix Nitpicks**.
2. DevMind runs ESLint and Prettier over your `src` directory.
3. A diff panel appears showing all applied changes.
4. Confirm to stage and commit the fixes with a standard commit message, or dismiss to discard.

---

### Tribal Knowledge Agent

**Purpose:** Indexes all important decisions, architecture decisions, and tribal knowledge embedded across your GitHub repository's PR review comments into Azure AI Search. When you open a PR or change a file, it searches that index for past decisions and context that are semantically similar to your current changes and surfaces them as contextual warnings — so critical knowledge that lives only in old PR threads never gets lost or repeated. Warnings link back to the original PR so you can read the full discussion.

**Sync the knowledge base first:**

1. Press `Cmd+Shift+K` (Windows: `Ctrl+Shift+K`) or run **DevMind: Sync Tribal Knowledge**.
2. DevMind fetches all important decisions, architecture decisions, and tribal knowledge from your GitHub repository's PR review comments and indexes them in Azure AI Search.

**Analyze current code:**

1. Run **DevMind: Analyze Tribal Knowledge** from the Command Palette.
2. DevMind searches the index for past decisions and context semantically similar to your current changes.
3. Matching warnings appear in the Problems panel, each linking back to the original PR thread for the full discussion.
4. Tune the sensitivity threshold to control how aggressively past knowledge is surfaced.

---

### Live Source Agent

**Purpose:** Pin any documentation URL or PDF so its content is injected as additional context into every AI query you make in the chat panel.

**Pin a URL:**

1. Press `Cmd+Shift+I` (Windows: `Ctrl+Shift+I`) or run **DevMind: Pin Documentation**.
2. Choose **URL** and enter a valid `http` or `https` address (e.g. `https://tanstack.com/query/v5`).
3. DevMind crawls the page (and linked pages up to the configured depth), chunks and embeds the content, and stores it in a temporary Azure AI Search session.
4. The status bar updates to show the pinned source label.

**Pin a PDF:**

1. Run **DevMind: Pin Documentation** and choose **PDF**.
2. Select the PDF file from the file picker.
3. DevMind parses and indexes the PDF content the same way.

**Manage sources:**

- Run **DevMind: Show Pinned Sources** to list all active pins.
- Run **DevMind: Unpin Documentation** to remove a source.
- Up to five sources can be pinned simultaneously. Pinning a sixth requires unpinning an existing one first.

---

### Chat

**Purpose:** Ask any question in natural language and DevMind will route it to the right agent automatically.

1. Press `Cmd+Shift+D` (Windows: `Ctrl+Shift+D`) or run **DevMind: Open Chat**.
2. Type your question. Examples:
   - *"Is `useQuery` still valid in my version of react-query?"* → routes to Version Guard
   - *"Explain this merge conflict"* → routes to Conflict Explainer
   - *"Summarise PR #42"* → routes to PR Summary
   - *"What did reviewers say about error handling in the past?"* → routes to Tribal Knowledge
3. The routing agent classifies your intent and delegates to the appropriate agent. The response appears in the chat panel.

---

## Acknowledgement

DevMind was designed and built by **Dhruva Patil**.

### Special Thanks

A heartfelt thank you to **Dr. Tushar Sharma**, this project was built under his supervision, and his guidance and support throughout were invaluable.

The project builds on the following platforms and open-source projects:

- [Microsoft Azure](https://azure.microsoft.com/) — OpenAI, AI Search, Cosmos DB, Blob Storage, Key Vault, AI Foundry, and Monitor
- [VS Code Extension API](https://code.visualstudio.com/api) — editor integration framework
- [Model Context Protocol](https://modelcontextprotocol.io/) — standardised tool-call interface for AI agents
- [Octokit](https://github.com/octokit/rest.js) — GitHub REST API client
- [Cheerio](https://cheerio.js.org/) — HTML parsing for documentation crawling
- [Tiktoken](https://github.com/openai/tiktoken) — token counting for prompt budget management
- [Mocha](https://mochajs.org/) + [Chai](https://www.chaijs.com/) + [Sinon](https://sinonjs.org/) — testing framework

Special thanks to the open-source community whose tooling makes building production-grade VS Code extensions approachable.
