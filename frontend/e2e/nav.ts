import type { Page } from "@playwright/test";

/**
 * `page.goto` for the moment right after an action that makes the app
 * navigate or refresh on its own (a saved form's router.refresh(), a delete's
 * server action).
 *
 * Firefox cancels a goto that lands inside the app's own in-flight
 * navigation and reports it as "NS_BINDING_ABORTED"; Chromium and WebKit
 * usually let the later one win. The abort says nothing about the page under
 * test, so that one error is retried — once the app's own navigation has
 * finished there is nothing left to collide with. Every other error is
 * rethrown untouched, and the retry is bounded, so this cannot hide a page
 * that really fails to load.
 */
export async function gotoAfterAction(page: Page, url: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url);
      return;
    } catch (err) {
      if (!/NS_BINDING_ABORTED/.test(String(err))) throw err;
    }
  }
  await page.goto(url);
}
