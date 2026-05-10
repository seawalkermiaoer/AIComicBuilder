# HappyHorse Video Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Alibaba Cloud Bailian's HappyHorse video generation model (I2V, R2V, T2V) as a new VideoProvider.

**Architecture:** Single `HappyHorseProvider` class implementing `VideoProvider`, auto-dispatching to the correct DashScope endpoint based on input parameters. Registered in provider-factory and setup.

**Tech Stack:** TypeScript, native `fetch`, DashScope REST API, Node.js `fs`

---

### Task 1: Create HappyHorseProvider class

**Files:**
- Create: `src/lib/ai/providers/happyhorse.ts`

- [ ] **Step 1: Write the HappyHorseProvider class**

Create `src/lib/ai/providers/happyhorse.ts` with the complete implementation:

```typescript
import type { VideoProvider, VideoGenerateParams, VideoGenerateResult } from "../types";
import fs from "node:fs";
import path from "node:path";
import { id as genId } from "@/lib/id";

// Convert a local file path to a data: URL; http(s) URLs are returned as-is
function toImageUrl(imagePathOrUrl: string): string {
  if (imagePathOrUrl.startsWith("http://") || imagePathOrUrl.startsWith("https://")) {
    return imagePathOrUrl;
  }
  const ext = path.extname(imagePathOrUrl).toLowerCase().replace(".", "");
  const mime =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : "image/png";
  const base64 = fs.readFileSync(imagePathOrUrl, { encoding: "base64" });
  return `data:${mime};base64,${base64}`;
}

// Normalise ratio to one of the values accepted by HappyHorse
function normaliseRatio(ratio: string): string {
  const supported = ["16:9", "9:16", "1:1", "4:3", "3:4"];
  return supported.includes(ratio) ? ratio : "16:9";
}

// Clamp duration to HappyHorse limits (3-15s)
function clampDuration(duration: number): number {
  return Math.max(3, Math.min(15, duration));
}

interface DashScopeTaskOutput {
  task_status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  video_url?: string;
  message?: string;
}

interface DashScopeSubmitResponse {
  output?: { task_id?: string };
  message?: string;
}

interface DashScopeTaskResponse {
  output?: DashScopeTaskOutput;
}

export class HappyHorseProvider implements VideoProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private uploadDir: string;

  constructor(params?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    uploadDir?: string;
  }) {
    this.apiKey = params?.apiKey || process.env.HAPPYHORSE_API_KEY || process.env.DASHSCOPE_API_KEY || "";
    this.baseUrl = (
      params?.baseUrl ||
      process.env.HAPPYHORSE_BASE_URL ||
      "https://dashscope.aliyuncs.com/api/v1"
    ).replace(/\/+$/, "");
    this.model = params?.model || process.env.HAPPYHORSE_MODEL || "happyhorse-1.0";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    let body: Record<string, unknown>;

    if ("firstFrame" in params && params.firstFrame) {
      body = this.buildI2VBody(params);
    } else if (params.initialImage) {
      body = this.buildR2VBody(params);
    } else {
      body = this.buildT2VBody(params);
    }

    console.log(
      `[HappyHorse] Submitting task: model=${body.model}, ratio=${params.ratio}`
    );

    const submitRes = await fetch(
      `${this.baseUrl}/services/aigc/video-generation/video-synthesis`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "X-DashScope-Async": "enable",
        },
        body: JSON.stringify(body),
      }
    );

    if (!submitRes.ok) {
      const errText = await submitRes.text().catch(() => "");
      throw new Error(`HappyHorse submit failed: ${submitRes.status} ${errText}`);
    }

    const submitResult = (await submitRes.json()) as DashScopeSubmitResponse;
    const taskId = submitResult.output?.task_id;
    if (!taskId) {
      throw new Error(
        `HappyHorse: no task_id in response: ${JSON.stringify(submitResult)}`
      );
    }

    console.log(`[HappyHorse] Task submitted: ${taskId}`);

    const videoUrl = await this.pollForResult(taskId);

    // Download and persist video
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) {
      throw new Error(`HappyHorse: failed to download video (${videoRes.status})`);
    }
    const buffer = Buffer.from(await videoRes.arrayBuffer());
    const filename = `${genId()}.mp4`;
    const dir = path.join(this.uploadDir, "videos");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);

    console.log(`[HappyHorse] Saved to ${filepath}`);
    return { filePath: filepath };
  }

  // ── Body builders ──────────────────────────────────────────────────────────

  private buildI2VBody(
    params: VideoGenerateParams & { firstFrame: string }
  ): Record<string, unknown> {
    if ("lastFrame" in params && params.lastFrame) {
      console.warn(
        "[HappyHorse] Keyframe mode detected, but HappyHorse does not support " +
        "first+last frame interpolation. Using first frame only; last frame ignored."
      );
    }

    return {
      model: this.model,
      input: {
        prompt: params.prompt,
        first_frame_image: toImageUrl(params.firstFrame),
      },
      parameters: {
        resolution: "720P",
        duration: clampDuration(params.duration || 5),
        aspect_ratio: normaliseRatio(params.ratio),
      },
    };
  }

  private buildR2VBody(
    params: VideoGenerateParams & { initialImage: string }
  ): Record<string, unknown> {
    const imagesUrl: string[] = [toImageUrl(params.initialImage)];

    if (params.referenceImages && params.referenceImages.length > 0) {
      for (const refImg of params.referenceImages) {
        imagesUrl.push(toImageUrl(refImg));
      }
    }

    return {
      model: `${this.model}-r2v`,
      input: {
        prompt: params.prompt,
        images_url: imagesUrl,
      },
      parameters: {
        resolution: "720P",
        duration: clampDuration(params.duration || 5),
        aspect_ratio: normaliseRatio(params.ratio),
        enable_audio: true,
      },
    };
  }

  private buildT2VBody(params: VideoGenerateParams): Record<string, unknown> {
    return {
      model: `${this.model}-t2v`,
      input: {
        prompt: params.prompt,
      },
      parameters: {
        resolution: "720P",
        duration: clampDuration(params.duration || 5),
        aspect_ratio: normaliseRatio(params.ratio),
        enable_audio: true,
      },
    };
  }

  // ── Polling ────────────────────────────────────────────────────────────────

  private async pollForResult(taskId: string): Promise<string> {
    const maxAttempts = 120;   // 10 min
    const interval = 5_000;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, interval));

      const res = await fetch(`${this.baseUrl}/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (!res.ok) {
        console.warn(`[HappyHorse] Poll ${i + 1}: HTTP ${res.status}, retrying…`);
        continue;
      }

      const result = (await res.json()) as DashScopeTaskResponse;
      const status = result.output?.task_status ?? "UNKNOWN";
      console.log(`[HappyHorse] Poll ${i + 1}: status=${status}`);

      if (status === "SUCCEEDED") {
        const videoUrl = result.output?.video_url;
        if (!videoUrl) {
          throw new Error(
            `HappyHorse: SUCCEEDED but no video_url in response: ${JSON.stringify(result)}`
          );
        }
        return videoUrl;
      }

      if (status === "FAILED") {
        throw new Error(
          `HappyHorse generation failed: ${result.output?.message ?? "unknown error"}`
        );
      }

      // PENDING / RUNNING → keep polling
    }

    throw new Error("HappyHorse generation timed out after 10 minutes");
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit src/lib/ai/providers/happyhorse.ts`
Expected: No errors (may need path aliases resolved via full project check)

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/providers/happyhorse.ts
git commit -m "feat: add HappyHorse video provider (I2V/R2V/T2V)"
```

---

### Task 2: Register HappyHorse in provider-factory

**Files:**
- Modify: `src/lib/ai/provider-factory.ts`

- [ ] **Step 1: Add import and case for happyhorse**

In `src/lib/ai/provider-factory.ts`, add the import at the top (after line 8, alongside other provider imports):

```typescript
import { HappyHorseProvider } from "./providers/happyhorse";
```

Add the `"happyhorse"` case to `createVideoProvider()` (inside the switch, before the `default` case at line 101):

```typescript
    case "happyhorse":
      return new HappyHorseProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
```

The final `createVideoProvider` switch should look like:

```typescript
export function createVideoProvider(config: ProviderConfig, uploadDir?: string): VideoProvider {
  switch (config.protocol) {
    case "seedance":
      return new SeedanceProvider({ ... });
    case "gemini":
      return new VeoProvider({ ... });
    case "kling":
      return new KlingVideoProvider({ ... });
    case "wan":
      return new WanVideoProvider({ ... });
    case "ucloud-seedance":
      return new UCloudSeedanceProvider({ ... });
    case "happyhorse":
      return new HappyHorseProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    default:
      throw new Error(`Unsupported video protocol: ${config.protocol}`);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/provider-factory.ts
git commit -m "feat: register HappyHorse in video provider factory"
```

---

### Task 3: Register HappyHorse as default video provider in setup.ts

**Files:**
- Modify: `src/lib/ai/setup.ts`

- [ ] **Step 1: Add HappyHorse import and default registration**

In `src/lib/ai/setup.ts`, add the import:

```typescript
import { HappyHorseProvider } from "./providers/happyhorse";
```

Add HappyHorse registration after the existing Seedance block (before `initialized = true`):

```typescript
  if (process.env.HAPPYHORSE_API_KEY || process.env.DASHSCOPE_API_KEY) {
    setDefaultVideoProvider(
      new HappyHorseProvider(),
      (uploadDir) => new HappyHorseProvider({ ...(uploadDir && { uploadDir }) }),
    );
  }
```

The final file should look like:

```typescript
import { setDefaultAIProvider, setDefaultVideoProvider } from "./index";
import { OpenAIProvider } from "./providers/openai";
import { GeminiProvider } from "./providers/gemini";
import { SeedanceProvider } from "./providers/seedance";
import { HappyHorseProvider } from "./providers/happyhorse";

let initialized = false;

export function initializeProviders() {
  if (initialized) return;

  if (process.env.OPENAI_API_KEY) {
    setDefaultAIProvider(
      new OpenAIProvider(),
      (uploadDir) => new OpenAIProvider({ ...(uploadDir && { uploadDir }) }),
    );
  } else if (process.env.GEMINI_API_KEY) {
    setDefaultAIProvider(
      new GeminiProvider(),
      (uploadDir) => new GeminiProvider({ ...(uploadDir && { uploadDir }) }),
    );
  }

  if (process.env.SEEDANCE_API_KEY) {
    setDefaultVideoProvider(
      new SeedanceProvider(),
      (uploadDir) => new SeedanceProvider({ ...(uploadDir && { uploadDir }) }),
    );
  }

  if (process.env.HAPPYHORSE_API_KEY || process.env.DASHSCOPE_API_KEY) {
    setDefaultVideoProvider(
      new HappyHorseProvider(),
      (uploadDir) => new HappyHorseProvider({ ...(uploadDir && { uploadDir }) }),
    );
  }

  initialized = true;
}
```

Note: This will override Seedance as default if both keys are present. The last `setDefaultVideoProvider` call wins. If the user has both `SEEDANCE_API_KEY` and `HAPPYHORSE_API_KEY`, HappyHorse becomes the default. This matches the existing pattern where provider order determines precedence.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/setup.ts
git commit -m "feat: register HappyHorse as default video provider when API key present"
```

---

### Task 4: Add HappyHorse model durations to model-limits.ts

**Files:**
- Modify: `src/lib/ai/model-limits.ts`

- [ ] **Step 1: Add HappyHorse model entries**

Add to `MODEL_MAX_DURATIONS` (after the wan2.6 entries, before the closing `};`):

```typescript
  "happyhorse-1.0": 15,
  "happyhorse-1.0-r2v": 15,
  "happyhorse-1.0-t2v": 15,
```

Add to `FAMILY_MAX_DURATIONS` (after the wan entry, before the closing `];`):

```typescript
  ["happyhorse", 15],
```

The relevant sections become:

```typescript
export const MODEL_MAX_DURATIONS: Record<string, number> = {
  // ... existing entries ...
  "wan2.6-r2v": 10,
  "wan2.6-r2v-flash": 10,
  "happyhorse-1.0": 15,
  "happyhorse-1.0-r2v": 15,
  "happyhorse-1.0-t2v": 15,
};

const FAMILY_MAX_DURATIONS: [string, number][] = [
  // ... existing entries ...
  ["wan", 15],
  ["happyhorse", 15],
];
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/ai/model-limits.ts
git commit -m "feat: add HappyHorse model duration limits"
```

---

### Task 5: Full build verification

**Files:**
- All modified files

- [ ] **Step 1: Run full type check**

Run: `pnpm exec tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 3: Run build**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 4: Final commit (if any lint/build fixes needed)**

```bash
git add -A
git commit -m "fix: address lint/build issues for HappyHorse integration"
```
