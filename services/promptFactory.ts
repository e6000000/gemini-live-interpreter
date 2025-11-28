import { LanguageMode } from '../types';

export function getSystemInstruction(mode: LanguageMode, customSource?: string, customTarget?: string): string {
  let srcLang = "Auto Detect";
  let tgtLang = "German";

  // Determine languages based on mode
  switch (mode) {
    case LanguageMode.AUTO_TO_GERMAN:
      srcLang = "Auto Detect";
      tgtLang = "German";
      break;
    case LanguageMode.EN_TO_DE:
      srcLang = "English";
      tgtLang = "German";
      break;
    case LanguageMode.DE_TO_EN:
      srcLang = "German";
      tgtLang = "English";
      break;
    case LanguageMode.DE_TO_THAI:
      srcLang = "German";
      tgtLang = "Thai";
      break;
    case LanguageMode.THAI_TO_DE:
      srcLang = "Thai";
      tgtLang = "German";
      break;
    case LanguageMode.KOR_TO_DE:
      srcLang = "Korean";
      tgtLang = "German";
      break;
    case LanguageMode.CUSTOM:
      srcLang = customSource || "Auto Detect";
      tgtLang = customTarget || "English";
      break;
  }

  return `SYSTEM: You are a real-time simultaneous interpreter translating from ${srcLang} to ${tgtLang}.

CRITICAL LATENCY PROTOCOL:
1. MODE: STREAMING. Do not wait for full semantic completeness.
2. Translate audio chunks IMMEDIATELY as they arrive.
3. If a sentence is incomplete, translate the fragment meaningfully.
4. Do NOT summarize. Do NOT explain. Just translate.
5. Keep the flow continuous.`;
}