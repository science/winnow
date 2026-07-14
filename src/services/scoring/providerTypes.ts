import type { Profile, Video } from "../../lib/types";

export interface RawScore {
  videoId: string;
  score: number;
  reason: string;
  clickbait: boolean;
}

/** One structured-output call scoring one batch. Implemented per provider. */
export type ScoreBatchFn = (
  videos: Video[],
  profile: Profile,
  apiKey: string,
) => Promise<RawScore[]>;

export type ProviderErrorKind =
  | "auth" // 401/403 — abort the run, the key is wrong
  | "rate" // 429 — retryable
  | "server" // 5xx — retryable
  | "network" // fetch failure — retryable
  | "bad_request" // other 4xx — a bug, fail fast (house retry policy)
  | "bad_response"; // malformed/unparseable body — a bug, fail fast

export class ProviderError extends Error {
  kind: ProviderErrorKind;
  constructor(kind: ProviderErrorKind, message: string) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
  }
}

export function isRetryable(err: unknown): boolean {
  return err instanceof ProviderError && (err.kind === "rate" || err.kind === "server" || err.kind === "network");
}

/** Map an HTTP status to the error taxonomy. */
export function kindFromStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate";
  if (status >= 500) return "server";
  return "bad_request";
}
