// Device boundary: camera, microphone, audio playback, local storage.
// Screens and features import from "@/platform" only. Today the web implementation backs it; a
// Capacitor build can provide another object with the same shape (no native project yet).
import * as media from "./web/media";
import { startMic, type MicHandle } from "./web/mic";
import { playWav, stopAll as stopWav, unlockAudio, type Playback } from "./web/playWav";
import { speak, speechSupported, stopSpeech, unlockSpeech, type SpeechVoice } from "./web/speech";
import { storage } from "./web/storage";

export interface Platform {
  /** React hook: front camera → { status: MediaStatus, stream, retry }. */
  useCamera: (enabled: boolean) => { status: media.MediaStatus; stream: MediaStream | null; retry: () => void };
  /** 16kHz mono Float32 20ms frames. Throws MediaAccessError. */
  startMic: (onFrame: (frame: Float32Array) => void) => Promise<MicHandle>;
  /** Current permission without prompting. */
  queryPermission: (device: media.MediaDevice) => Promise<PermissionState | "unknown">;
  /** Shows the permission prompt now and releases the device. "live" = allowed. */
  requestPermission: (device: media.MediaDevice) => Promise<media.MediaStatus>;
  audio: {
    play: typeof playWav;
    /** On-device voice (Web Speech today; a Capacitor TTS plugin later) for when /api/tts fails. Lower quality: say so in the UI. */
    speak: typeof speak;
    /** false = speak() will reject; show the question as text only. */
    canSpeak: () => boolean;
    /** Stops both play() and speak(). */
    stopAll: () => void;
    unlock: () => void;
  };
  storage: typeof storage;
}

export const platform: Platform = {
  useCamera: media.useCamera,
  startMic,
  queryPermission: media.queryPermission,
  requestPermission: media.requestPermission,
  audio: {
    // One voice at a time across both paths.
    play: (src, opts) => (stopSpeech(), playWav(src, opts)),
    speak: (text, voice, opts) => (stopWav(), speak(text, voice, opts)),
    canSpeak: speechSupported,
    stopAll: () => (stopWav(), stopSpeech()),
    unlock: () => (unlockAudio(), unlockSpeech()),
  },
  storage,
};

export const useCamera = platform.useCamera;
export { MediaAccessError, mediaErrorText } from "./web/media";
export { rms } from "./web/mic";
export type { MediaStatus } from "./web/media";
export type { MicHandle, Playback, SpeechVoice };
