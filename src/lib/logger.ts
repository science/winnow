// Tree-shaking logger (wolfechat pattern): debug/info are compiled out of
// production builds via the statically-evaluated import.meta.env.DEV check;
// warn/error always ship.

/* eslint-disable no-console */
export const log = {
  debug: (...args: unknown[]): void => {
    if (import.meta.env.DEV) console.debug("[winnow]", ...args);
  },
  info: (...args: unknown[]): void => {
    if (import.meta.env.DEV) console.info("[winnow]", ...args);
  },
  warn: (...args: unknown[]): void => {
    console.warn("[winnow]", ...args);
  },
  error: (...args: unknown[]): void => {
    console.error("[winnow]", ...args);
  },
};
