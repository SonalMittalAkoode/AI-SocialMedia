import { describe, it, expect } from "vitest";
import {
  librarySchema,
  generationsSchema,
  summarySchema,
  displayDate,
} from "../../src/lib/crm-api";
describe("CRM read contracts", () => {
  it("requires a total and bounded page metadata rather than counting visible rows", () => {
    expect(
      librarySchema.safeParse({
        items: [],
        total: 120,
        limit: 25,
        offset: 50,
        company_timezone: "Asia/Kolkata",
      }).success,
    ).toBe(true);
    expect(librarySchema.safeParse({ items: [] }).success).toBe(false);
  });
  it("keeps generation results distinct from saved posts", () => {
    const data = {
      items: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          status: "completed",
          stage: "completed",
          created_at: "2026-11-16T10:00:00Z",
          completed_at: null,
          topic: "Unsaved results",
          result_count: 3,
          saved_results: [],
          error_message: null,
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    };
    expect(generationsSchema.parse(data).items[0].saved_results).toEqual([]);
    expect(summarySchema.shape.scheduled_posts.safeParse(0).success).toBe(true);
    expect(summarySchema.shape.recent_posts.safeParse(data.items).success).toBe(
      false,
    );
  });
  it("formats dates in the supplied company zone and handles legacy missing dates honestly", () => {
    expect(displayDate("2027-01-01T20:00:00Z", "Asia/Kolkata")).toBe(
      "2 Jan 2027",
    );
    expect(displayDate(undefined)).toBe("Unavailable");
  });
});
