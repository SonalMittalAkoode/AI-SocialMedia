import { describe, it, expect } from "vitest";
import {
  dayInZone,
  timeInZone,
  calendarDays,
  addDays,
  stateLabel,
  scheduleSchema,
} from "../../src/lib/scheduling-api";
describe("company scheduling dates", () => {
  it("groups an instant across date boundaries using the company zone", () => {
    expect(dayInZone("2027-01-01T20:00:00Z", "Asia/Kolkata")).toBe(
      "2027-01-02",
    );
    expect(dayInZone("2027-01-01T20:00:00Z", "America/Los_Angeles")).toBe(
      "2027-01-01",
    );
    expect(timeInZone("2027-01-01T20:00:00Z", "Asia/Kolkata")).toBe("01:30");
  });
  it("builds stable month and week date grids across DST and leap years", () => {
    expect(calendarDays("2027-03-14", "Month")).toHaveLength(42);
    expect(calendarDays("2027-03-14", "Week")).toEqual([
      "2027-03-14",
      "2027-03-15",
      "2027-03-16",
      "2027-03-17",
      "2027-03-18",
      "2027-03-19",
      "2027-03-20",
    ]);
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
  });
  it("labels the real holding state and rejects fictional publishing statuses", () => {
    expect(stateLabel("awaiting_publisher")).toBe("Awaiting Publisher");
    expect(scheduleSchema.shape.status.safeParse("published").success).toBe(
      false,
    );
  });
});
