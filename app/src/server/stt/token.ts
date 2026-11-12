import "server-only";
import { gemini, MODELS } from "../ai";

/** Config locked into the token; the client must connect with the same model and config. */
const LIVE_CONFIG = { inputAudioTranscription: { languageCodes: ["ko-KR"] } };

/** Single-use Gemini Live token (30 min) so the browser streams audio without seeing the API key. */
export async function mintLiveToken(): Promise<{ token: string; model: string; expiresAt: string; config: typeof LIVE_CONFIG }> {
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const tok = await gemini().authTokens.create({
    config: {
      httpOptions: { apiVersion: "v1alpha" },
      uses: 1, // one Live session per token; the client mints a new one on reconnect
      expireTime: expiresAt,
      newSessionExpireTime: new Date(Date.now() + 2 * 60_000).toISOString(),
      liveConnectConstraints: { model: MODELS.geminiTranscribeLive, config: LIVE_CONFIG },
    },
  });
  if (!tok.name) throw new Error("ephemeral token missing in response");
  return { token: tok.name, model: MODELS.geminiTranscribeLive, expiresAt, config: LIVE_CONFIG };
}
