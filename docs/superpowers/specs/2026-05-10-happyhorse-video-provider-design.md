# HappyHorse Video Provider — Design Spec

**Date**: 2026-05-10
**Status**: Draft

## Goal

Integrate Alibaba Cloud Bailian's HappyHorse (欢乐马) video generation model as a new `VideoProvider` in the AI Comic Builder pipeline. Support all three HappyHorse modes: 首帧图生视频 (I2V), 参考生视频 (R2V), and 文生视频 (T2V).

## Architecture

### New File

`src/lib/ai/providers/happyhorse.ts` — single `HappyHorseProvider` class implementing `VideoProvider`.

Auto-dispatches to the correct mode based on input parameters:

| Input | Mode | Model | DashScope Endpoint |
|-------|------|-------|---------------------|
| `firstFrame` (+ `lastFrame`) | 首帧图生视频 (I2V) | `happyhorse-1.0` | POST `/services/aigc/video-generation/video-synthesis` |
| `initialImage` (± `referenceImages`) | 参考生视频 (R2V) | `happyhorse-1.0-r2v` | POST `/services/aigc/video-generation/video-synthesis` |
| no images | 文生视频 (T2V) | `happyhorse-1.0-t2v` | POST `/services/aigc/video-generation/video-synthesis` |

Polling: `GET /tasks/{taskId}` every 5s, max 120 attempts (10 min).

### Files Modified

- `src/lib/ai/provider-factory.ts` — add `"happyhorse"` case to `createVideoProvider()`
- `src/lib/ai/setup.ts` — register default video provider when `HAPPYHORSE_API_KEY` (or `DASHSCOPE_API_KEY`) is set
- `src/lib/ai/types.ts` — no changes needed

### Env Vars

| Var | Default | Purpose |
|-----|---------|---------|
| `HAPPYHORSE_API_KEY` | `DASHSCOPE_API_KEY` | DashScope API key |
| `HAPPYHORSE_BASE_URL` | `https://dashscope.aliyuncs.com/api/v1` | DashScope endpoint |
| `HAPPYHORSE_MODEL` | `happyhorse-1.0` | Default model variant |

## Request Body Formats

### I2V (首帧图生视频)

```json
{
  "model": "happyhorse-1.0",
  "input": {
    "prompt": "...",
    "first_frame_image": "https://... or data:image/...;base64,..."
  },
  "parameters": {
    "resolution": "720P",
    "duration": 5,
    "aspect_ratio": "16:9"
  }
}
```

### R2V (参考生视频)

```json
{
  "model": "happyhorse-1.0-r2v",
  "input": {
    "prompt": "...",
    "images_url": ["https://...", "data:image/...;base64,..."]
  },
  "parameters": {
    "resolution": "720P",
    "duration": 5,
    "aspect_ratio": "16:9",
    "enable_audio": true
  }
}
```

### T2V (文生视频)

```json
{
  "model": "happyhorse-1.0-t2v",
  "input": {
    "prompt": "..."
  },
  "parameters": {
    "resolution": "720P",
    "duration": 5,
    "aspect_ratio": "16:9",
    "enable_audio": true
  }
}
```

### Common Headers

```
Content-Type: application/json
Authorization: Bearer $API_KEY
X-DashScope-Async: enable
```

## Key Constraint: No Keyframe Support

HappyHorse does NOT support 首尾帧插值 (first+last frame interpolation). When the pipeline sends a keyframe-mode request (with both `firstFrame` and `lastFrame`):

- Send `first_frame_image` + prompt to the I2V endpoint
- Log a warning that `lastFrame` is being ignored
- Do NOT throw an error — gracefully degrade

## Implementation Details

### Constructor

```ts
constructor(params?: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  uploadDir?: string;
})
```

Falls back to env vars: `HAPPYHORSE_API_KEY` → `DASHSCOPE_API_KEY`, `HAPPYHORSE_BASE_URL` → `https://dashscope.aliyuncs.com/api/v1`, `HAPPYHORSE_MODEL` → `happyhorse-1.0`.

### Image URL Conversion

Local file paths converted to `data:image/{mime};base64,{base64}` format. HTTP(S) URLs passed through as-is. MIME types: jpg/jpeg → `image/jpeg`, png → `image/png`, webp → `image/webp`.

### Ratio Mapping

HappyHorse accepts: `16:9`, `9:16`, `1:1`, `4:3`, `3:4`. Unsupported ratios default to `16:9`.

### Resolution

Fixed at `720P` (cheaper, faster). HappyHorse also supports `1080P` but at significantly higher cost.

### Duration

Clamped to 3-15s range (HappyHorse limits). Default 5s.

### Polling Response Format

```json
{
  "output": {
    "task_status": "SUCCEEDED" | "FAILED" | "PENDING" | "RUNNING",
    "video_url": "https://...",
    "message": "..."
  }
}
```

## Error Handling

- Submit fails (HTTP non-200): throw with status + response body
- Submit returns no `task_id`: throw with response body
- Poll returns `FAILED`: throw with error message from API
- Poll returns `SUCCEEDED` but no `video_url`: throw
- Download fails (HTTP non-200): throw
- Timeout after 120 polls (10 min): throw
- Keyframe mode: log warning about last frame being dropped, do NOT error

## Testing

No unit tests for video providers exist in this codebase. Follow the same pattern — no tests added.

Manual verification:
1. Configure provider in UI settings
2. Run a shot through the pipeline in each mode (I2V, R2V, T2V)
3. Verify video is generated and saved to `./uploads/videos/`

## Files Summary

| Action | File |
|--------|------|
| Create | `src/lib/ai/providers/happyhorse.ts` |
| Modify | `src/lib/ai/provider-factory.ts` |
| Modify | `src/lib/ai/setup.ts` |
