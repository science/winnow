// Reviewed constant (like model IDs). If YouTube retires this client
// version, the live e2e spec and scripts/transcript-diag.ts surface it.
// Import-free so the extension-tier tests can read the same value.
export const ANDROID_CLIENT = {
  clientName: "ANDROID",
  clientVersion: "20.10.38",
  androidSdkVersion: 30,
} as const;
