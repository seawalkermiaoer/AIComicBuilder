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
