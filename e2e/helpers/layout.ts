// Layout measurements for the phone-sized project (house rule: selectors
// live in helpers, never in specs).
import { expect, type Page } from "@playwright/test";

/** Smallest touch target that is comfortable to hit with a thumb. */
const MIN_TAP_PX = 40;

/** The page body must never scroll sideways: on a phone that is a broken page. */
export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow, "the page is wider than the screen").toBeLessThanOrEqual(0);
}

/** A card's text column must get the larger share of the card, or titles
 * clip after a few words. */
export async function expectCardTextHasRoom(page: Page): Promise<void> {
  const card = page.getByTestId("video-card").first();
  const cardBox = await card.boundingBox();
  const titleBox = await card.getByRole("heading").boundingBox();
  expect(cardBox && titleBox).toBeTruthy();
  expect(titleBox!.width / cardBox!.width, "the title column is squeezed by the thumbnail").toBeGreaterThanOrEqual(0.5);
}

async function expectTappable(page: Page, testId: string): Promise<void> {
  const box = await page.getByTestId(testId).first().boundingBox();
  expect(box, `${testId} is not on the page`).toBeTruthy();
  expect(box!.height, `${testId} is too short to tap reliably`).toBeGreaterThanOrEqual(MIN_TAP_PX);
}

/** Vote buttons sit inside the card link: a missed tap opens the player. */
export async function expectVoteButtonsTappable(page: Page): Promise<void> {
  await expectTappable(page, "vote-up");
  await expectTappable(page, "vote-down");
}

/** The close button is the only guaranteed way out of the player. */
export async function expectClosePlayerTappable(page: Page): Promise<void> {
  await expectTappable(page, "close-player");
}
