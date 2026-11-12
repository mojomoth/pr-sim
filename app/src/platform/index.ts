// Device boundary: camera, microphone, audio playback, local storage.
// Screens and features import from "@/platform" only. Today the web implementation backs it; a
// Capacitor build can provide another object with the same shape (no native project yet).
import * as media from "./web/media";
import { startMic, type MicHandle } from "./web/mic";
import { playWav, stopAll, unlockAudio, type Playback } from "./web/playWav";
import { storage } from "./web/storage";

export interface Platform {
  /** React hook: front camera → { status: MediaStatus, stream, retry }. */
  useCamera: (enabled: boolean) => { status: media.MediaStatus; stream: MediaStream | null; retry: () => void };
  /** 16kHz mono Float32 20ms frames. Throws MediaAccessError. */
  startMic: (onFrame: (frame: Float32Array) => void) => Promise<MicHandle>;
  /** Current permission without prompting. */
  queryPermission: (device: media.MediaDevice) => Promise<PermissionState | "unknown">;
  audio: { play: typeof playWav; stopAll: () => void; unlock: () => void };
  storage: typeof storage;
}

export const platform: Platform = {
  useCamera: media.useCamera,
  startMic,
  queryPermission: media.queryPermission,
  audio: { play: playWav, stopAll, unlock: unlockAudio },
  storage,
};

export const useCamera = platform.useCamera;
export { MediaAccessError, mediaErrorText } from "./web/media";
export { rms } from "./web/mic";
export { StorageError } from "./web/storage";
export type { MediaDevice, MediaFailure, MediaStatus } from "./web/media";
export type { MicHandle, Playback };
