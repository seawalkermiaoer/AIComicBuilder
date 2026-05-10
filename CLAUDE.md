# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**AI Comic Builder** is an AI-driven comic/anime video generator — a full pipeline from script to animated video. Built with Next.js 16 (App Router), React 19, Drizzle ORM + SQLite, and multiple AI providers (OpenAI, Gemini, Kling, Seedance, Veo).

## Development Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Start dev server (localhost:3000)
pnpm build            # Production build
pnpm start            # Start production server
pnpm lint             # Run ESLint
pnpm drizzle-kit push  # Push schema changes to SQLite
```

Database defaults to `./data/aicomic.db`. FFmpeg is required for video assembly.

## Architecture

### Generation Pipeline

```
Script Input → Script Parse → Character Extract → Character Images
                                                   ↓
                                                Shot Split
                                                   ↓
                                   Frame Generation (keyframe or reference mode)
                                                   ↓
                                   Video Prompt Generation (per shot)
                                                   ↓
                                   Video Generation (per shot)
                                                   ↓
                                   Video Assembly + Subtitles
```

Each stage is a **task** that runs through an in-process task queue. Tasks are registered in `src/lib/pipeline/index.ts` and executed by a background worker (`src/lib/task-queue/worker.ts`).

### Key Directories

| Path | Purpose |
|------|---------|
| `src/app/[locale]/` | i18n pages (zh/en/ja/ko), dashboard, project editor |
| `src/app/api/` | REST API routes — projects, episodes, characters, shots, tasks, agents |
| `src/lib/pipeline/` | Pipeline step handlers (script-outline, character-extract, shot-split, frame-generate, video-generate, video-assemble) |
| `src/lib/ai/` | AI provider abstraction layer — `providers/` has per-provider impls (openai, gemini, seedance, kling, veo, etc.), `prompts/` has all prompt templates |
| `src/lib/task-queue/` | In-memory task queue with worker — `queue.ts` (enqueue/complete), `worker.ts` (handler dispatch) |
| `src/lib/db/` | Drizzle schema and DB connection |
| `src/stores/` | Zustand stores — project, episode, model, agent, prompt-template state |
| `agents/` | External agent configs (bailian, dify, coze platforms) |

### Data Model

Core tables in `src/lib/db/schema.ts`: **Project → Episode → Shot → ShotAsset** (unified asset table). Characters belong to projects and can be scoped to episodes. Shots belong to episodes and storyboard versions. Assets are versioned via `asset_version` + `is_active` pattern.

Two generation modes coexist on every shot:
- **keyframe** — generates first_frame + last_frame images, then interpolates to video
- **reference** — generates reference images (multi), then produces video from them

`shot_assets` table unifies both modes — the `type` column discriminates (`first_frame` / `last_frame` / `reference` / `keyframe_video` / `reference_video`).

### State Management

- **Frontend**: Zustand stores (`src/stores/`) hold project/episode/shot data. `project-store.ts` is the primary store with helpers like `getFirstFrameUrl()`, `hasKeyframePair()`, etc.
- **Backend**: In-memory task queue (`src/lib/task-queue/`). No external queue/broker — tasks are persisted to SQLite and polled by the worker.
- **Bootstrap**: `src/lib/bootstrap.ts` runs migrations, initializes AI providers, registers pipeline handlers, and starts the worker on server startup.

### AI Provider System

Providers are registered in `src/lib/ai/setup.ts` from env vars (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `SEEDANCE_API_KEY`). The provider factory (`src/lib/ai/provider-factory.ts`) resolves models per-project. Per-shot model selection is supported via the UI. External agents (Bailian/Dify/Coze) can be bound per-project via `agent_bindings` table.

### Prompt Template System

Prompt templates live in `src/lib/ai/prompts/registry.ts` with versioning stored in DB (`prompt_templates`, `prompt_versions`). Global and project-scoped templates. UI page at `/prompts` for editing.

## Important Patterns

- **Task-based execution**: All AI generation happens via tasks enqueued through the task queue. API routes enqueue tasks; the worker executes them.
- **Asset versioning**: Regenerating an asset creates a new row with incremented `asset_version` and flips the previous active row to `is_active=0`. History is preserved.
- **Staleness tracking**: `is_stale` flags on characters and shots indicate when upstream changes (e.g., character description updated) may require regeneration.
- **i18n**: Uses `next-intl`. Messages in `messages/` (zh/en/ja/ko). Locale prefix in URL via `[locale]/` route segment.
- **FFmpeg**: Video assembly uses `fluent-ffmpeg`. FFmpeg must be installed on the system. Subtitle burn-in requires `font-noto-cjk`.
