import "server-only";
import { z } from "zod";
import { gemini, MODELS } from "../ai";

/** Optional body of POST /api/stt/token: domain terms from the session's wiki (Live `customVocabulary`). */
export const SttTokenIn = z.object({ vocabulary: z.array(z.string().trim().min(1).max(40)).max(60).optional() });

const liveConfig = (vocabulary: string[] = []) => ({
  inputAudioTranscription: { languageCodes: ["ko-KR"], ...(vocabulary.length ? { customVocabulary: [...new Set(vocabulary)] } : {}) },
});

/** Single-use Gemini Live token (30 min) so the browser streams audio without seeing the API key.
 *  The config (incl. vocabulary) is locked into the token; the client must connect with the same model and config. */
export async function mintLiveToken(vocabulary?: string[]): Promise<{ token: string; model: string; expiresAt: string; config: ReturnType<typeof liveConfig> }> {
  const config = liveConfig(vocabulary);
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const tok = await gemini().authTokens.create({
    config: {
      httpOptions: { apiVersion: "v1alpha" },
      uses: 1, // one Live session per token; the client mints a new one on reconnect
      expireTime: expiresAt,
      newSessionExpireTime: new Date(Date.now() + 2 * 60_000).toISOString(),
      liveConnectConstraints: { model: MODELS.geminiTranscribeLive, config },
    },
  });
  if (!tok.name) throw new Error("ephemeral token missing in response");
  return { token: tok.name, model: MODELS.geminiTranscribeLive, expiresAt, config };
}
