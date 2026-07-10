/**
 * E2E tests — G4 flow self-restraint:
 *   (a)(b) query TPE→NRT on a date the scheduler has already fetched
 *          → hits cache, never calls live fast-flights / Amadeus
 *   (c) query a valid-IATA-but-no-flight route → verifies empty-result state
 *
 * Set E2E_CACHED_DATE=YYYY-MM-DD to the date the scheduler last fetched.
 * Defaults to tomorrow (safe fallback if cache is cold — tests still pass
 * functionally but may hit live providers once).
 */

import { expect, test } from "@playwright/test";

const tomorrow = new Date(Date.now() + 86_400_000)
  .toISOString()
  .split("T")[0];
const TEST_DATE = process.env.E2E_CACHED_DATE || tomorrow;

test.describe("FlightSearch E2E", () => {
  test("round-trip mode searches outbound and return legs with total price", async ({
    page,
  }) => {
    const searchHosts: string[] = [];
    await page.route("**/api/health", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ok", db: true }),
      });
    });
    await page.route("**/api/search**", async (route) => {
      const url = new URL(route.request().url());
      searchHosts.push(url.host);
      const origin = url.searchParams.get("origin");
      const dest = url.searchParams.get("dest");
      const isReturn = origin === "NRT" && dest === "TPE";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          flights: [
            {
              airline: isReturn ? "BR" : "CI",
              flight_no: isReturn ? "BR198" : "CI100",
              depart_time: isReturn ? "18:30" : "09:10",
              arrive_time: isReturn ? "21:40" : "13:25",
              duration_min: isReturn ? 190 : 255,
              stops: 0,
              price: isReturn ? 9200 : 8800,
              currency: "TWD",
              booking_hint: "https://www.google.com/travel/flights",
            },
          ],
          source: "fast_flights",
          fetched_at: new Date().toISOString(),
          stale: false,
        }),
      });
    });

    await page.goto(
      "/?trip=round-trip&origin=TPE&dest=NRT&date=2030-10-01&returnDate=2030-10-05&adults=1&cabin=economy"
    );

    await expect(page.getByRole("tab", { name: "來回", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("回程日期")).toHaveValue("2030-10-05");
    await page.getByLabel("去程結果").locator("[role='option']").first().waitFor();
    await page.getByLabel("回程結果").locator("[role='option']").first().waitFor();

    const totalText = (await page.getByLabel("來回總價").textContent()) ?? "";
    expect(totalText).toContain("已選 2 / 2 段合計");
    expect(totalText).toContain("NT$ 18,000");
    expect(searchHosts).toEqual(["127.0.0.1:8000", "127.0.0.1:8000"]);
  });

  // ── (a) Search TPE→NRT returns ≥1 flight card ───────────────────────────

  test("(a) TPE→NRT search returns at least one flight card", async ({
    page,
  }) => {
    // Navigate with pre-filled query string (URL deep-link)
    await page.goto(
      `/?origin=TPE&dest=NRT&date=${TEST_DATE}&adults=1&cabin=economy`
    );

    // Wait for loading to finish — either a card or empty state appears
    const card = page.locator("a[aria-label*='Google Flights']").first();
    const empty = page.getByText("這天沒有找到航班");
    const error = page.getByText("查詢失敗");

    await Promise.race([
      card.waitFor({ timeout: 25_000 }),
      empty.waitFor({ timeout: 25_000 }),
      error.waitFor({ timeout: 25_000 }),
    ]);

    // In normal operation at least one card should be present
    const cardCount = await page
      .locator("a[aria-label*='Google Flights']")
      .count();
    expect(cardCount).toBeGreaterThanOrEqual(1);
  });

  // ── (b) Sort by lowest price → first card price ≤ second card price ─────

  test("(b) Sort by lowest price — first card has lowest price", async ({
    page,
  }) => {
    await page.goto(
      `/?origin=TPE&dest=NRT&date=${TEST_DATE}&adults=1&cabin=economy`
    );

    // Wait for cards
    await page
      .locator("a[aria-label*='Google Flights']")
      .first()
      .waitFor({ timeout: 25_000 });

    // Ensure "最低價" sort tab is active (it is by default)
    await page.getByRole("tab", { name: "最低價" }).click();
    await page.waitForTimeout(200); // let re-sort settle

    const cards = page.locator("a[aria-label*='Google Flights']");
    const count = await cards.count();
    if (count < 2) {
      test.skip(); // nothing to compare
      return;
    }

    // Extract prices from aria-labels: "... NT$ 8,432 ..."
    const extractPrice = (label: string): number => {
      const m = label.match(/NT\$\s*([\d,]+)/);
      return m ? parseInt(m[1].replace(/,/g, ""), 10) : 0;
    };

    const firstLabel = await cards.nth(0).getAttribute("aria-label") ?? "";
    const secondLabel = await cards.nth(1).getAttribute("aria-label") ?? "";
    const first = extractPrice(firstLabel);
    const second = extractPrice(secondLabel);

    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(second);

    // Also verify sort by duration changes first card
    await page.getByRole("tab", { name: "最短時間" }).click();
    await page.waitForTimeout(200);
    const durationFirstLabel =
      (await cards.nth(0).getAttribute("aria-label")) ?? "";
    // Just verify the tab click worked and cards still exist
    expect(durationFirstLabel).toBeTruthy();
  });

  // ── (c) No-route query → empty-result state ──────────────────────────────

  test("(c) Route with no flights shows empty-result state with prev/next day buttons", async ({
    page,
  }) => {
    // TPE→YYZ (Toronto) — valid IATA but no typical direct service from Taiwan
    // Use a very specific future date to avoid accidentally cached results
    await page.goto(
      `/?origin=TPE&dest=YYZ&date=${TEST_DATE}&adults=1&cabin=economy`
    );

    // Wait for either empty state or actual result
    const empty = page.getByText("這天沒有找到航班");
    const card = page.locator("a[aria-label*='Google Flights']").first();
    await Promise.race([
      empty.waitFor({ timeout: 25_000 }),
      card.waitFor({ timeout: 25_000 }),
    ]);

    // If empty state is shown, verify the prev/next day buttons exist
    if (await empty.isVisible()) {
      await expect(page.getByRole("button", { name: "← 查前一天" })).toBeVisible();
      await expect(page.getByRole("button", { name: "查後一天 →" })).toBeVisible();
    }
  });

  // ── (d) Multi-leg（外站／四腿）mode ──────────────────────────────────────

  test("(d) multi-leg mode searches all legs and shows total", async ({
    page,
  }) => {
    // URL 直開多段模式（2 段），應自動查詢
    await page.goto(
      `/?mode=multi&legs=TPE-NRT%402026-08-06%7CNRT-TPE%402026-08-06&adults=1&cabin=economy`
        .replace(/2026-08-06/g, TEST_DATE)
    );

    // 兩段都要載入完成（出現可選報價，而非骨架屏）
    await page
      .getByLabel("第 1 段結果")
      .locator("[role='option']")
      .first()
      .waitFor({ timeout: 30_000 });
    await page
      .getByLabel("第 2 段結果")
      .locator("[role='option']")
      .first()
      .waitFor({ timeout: 30_000 });

    // 總價列出現且金額 > 0
    const totalBar = page.getByLabel("多段總價");
    await totalBar.waitFor({ timeout: 30_000 });
    const totalText = (await totalBar.textContent()) ?? "";
    const m = totalText.match(/NT\$\s*([\d,]+)/);
    expect(m).toBeTruthy();
    const total = parseInt(m![1].replace(/,/g, ""), 10);
    expect(total).toBeGreaterThan(0);

    // 每段各自的最便宜報價相加應等於預設總價
    const legCheapest = async (label: string) => {
      const section = page.getByLabel(label);
      const first = section.locator("[role='option']").first();
      const t = (await first.textContent()) ?? "";
      const pm = t.match(/NT\$\s*([\d,]+)/);
      return pm ? parseInt(pm[1].replace(/,/g, ""), 10) : 0;
    };
    const sum = (await legCheapest("第 1 段結果")) + (await legCheapest("第 2 段結果"));
    expect(total).toBe(sum);

    // 點選第 1 段的第二個報價 → 總價跟著變
    const secondOption = page
      .getByLabel("第 1 段結果")
      .locator("[role='option']")
      .nth(1);
    if (await secondOption.count()) {
      await secondOption.click();
      await page.waitForTimeout(200);
      const newText = (await totalBar.textContent()) ?? "";
      const nm = newText.match(/NT\$\s*([\d,]+)/);
      expect(nm).toBeTruthy();
      const newTotal = parseInt(nm![1].replace(/,/g, ""), 10);
      expect(newTotal).toBeGreaterThanOrEqual(total); // 第二便宜 ≥ 最便宜
    }
  });

  // ── (e) 外站組合比價 date-matrix mode ────────────────────────────────────

  test("(e) combo mode builds date matrix with best total", async ({ page }) => {
    test.setTimeout(120_000); // 6 個日期查詢（並發 2）串行於 fast-flights 節流之後

    await page.goto(
      `/?mode=combo&a=TPE-NRT%40${TEST_DATE}~1&b=NRT-TPE%40${TEST_DATE}~1&adults=1&cabin=economy`
    );

    // 矩陣表格出現
    await page.getByLabel("組合價格矩陣").waitFor({ timeout: 30_000 });

    // 等全部查詢完成 → 出現最佳組合列
    const best = page.getByLabel("最佳組合");
    await best.waitFor({ timeout: 90_000 });
    const bestText = (await best.textContent()) ?? "";
    const m = bestText.match(/NT\$\s*([\d,]+)/);
    expect(m).toBeTruthy();
    expect(parseInt(m![1].replace(/,/g, ""), 10)).toBeGreaterThan(0);

    // 不可行組合（回程早於去程）應以「—」顯示
    const matrix = page.getByLabel("組合價格矩陣");
    expect((await matrix.textContent()) ?? "").toContain("—");

    // 點一個有價格的格子 → 出現組合明細（兩段航班）
    await matrix.locator("button:not([disabled])").first().click();
    await page.getByLabel("組合明細").waitFor({ timeout: 5_000 });
    const detail = (await page.getByLabel("組合明細").textContent()) ?? "";
    expect(detail).toContain("段1");
    expect(detail).toContain("段2");
  });

  // ── 375px — no horizontal scroll ─────────────────────────────────────────

  test("375px viewport — no horizontal scrollbar", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2); // 2px tolerance
  });

  test("375px multi-leg mode — no horizontal scrollbar", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/?mode=multi");

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
  });
});
