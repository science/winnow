// Background event page. Sole job: the toolbar button opens (or focuses)
// the winnow feed tab. Keep this file import-free — it is built as a
// standalone entry and must not share chunks with the page bundle.

declare const browser: {
  action: { onClicked: { addListener: (cb: () => void) => void } };
  runtime: { getURL: (path: string) => string };
  tabs: {
    query: (q: { url: string }) => Promise<Array<{ id?: number; windowId?: number }>>;
    create: (props: { url: string }) => Promise<unknown>;
    update: (id: number, props: { active: boolean }) => Promise<unknown>;
  };
  windows: { update: (id: number, props: { focused: boolean }) => Promise<unknown> };
};

const FEED_URL = browser.runtime.getURL("feed.html");

browser.action.onClicked.addListener(() => {
  void (async () => {
    const existing = await browser.tabs.query({ url: FEED_URL + "*" });
    const tab = existing[0];
    if (tab?.id !== undefined) {
      await browser.tabs.update(tab.id, { active: true });
      if (tab.windowId !== undefined) {
        await browser.windows.update(tab.windowId, { focused: true });
      }
    } else {
      await browser.tabs.create({ url: FEED_URL });
    }
  })();
});
