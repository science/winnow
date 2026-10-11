// Vitest setup: the free tier runs with no network. Tests that need a fetch
// inject a stub (fetchFn deps) or vi.stubGlobal their own.
globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
  throw new Error(`unit tests must not reach the network: ${String(input instanceof Request ? input.url : input)}`);
};
