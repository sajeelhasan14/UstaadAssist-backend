/** Same date every year. */
export const PK_FIXED_HOLIDAYS = [
  { month: 2, day: 5, name: "Kashmir Day" },
  { month: 3, day: 23, name: "Pakistan Day" },
  { month: 5, day: 1, name: "Labour Day" },
  { month: 5, day: 28, name: "Youm-e-Takbeer" },
  { month: 8, day: 14, name: "Independence Day" },
  { month: 9, day: 6, name: "Defence Day" },
  { month: 11, day: 9, name: "Iqbal Day" },
  { month: 12, day: 25, name: "Quaid-e-Azam Day" },
];

/**
 * Lunar holidays — the date moves every year and depends on a moon sighting,
 * so they cannot be calculated. Add each year as it is announced.
 * Multi-day holidays get one entry per day.
 */
export const PK_LUNAR_HOLIDAYS: Record<
  number,
  { date: string; name: string }[]
> = {
  2027: [
    { date: "2027-03-10", name: "Eid ul-Fitr" },
    { date: "2027-03-11", name: "Eid ul-Fitr" },
    { date: "2027-03-12", name: "Eid ul-Fitr" },
    { date: "2027-05-17", name: "Eid ul-Adha" },
    { date: "2027-05-18", name: "Eid ul-Adha" },
    { date: "2027-06-14", name: "Ashura" },
    { date: "2027-06-15", name: "Ashura" },
    { date: "2027-08-15", name: "Eid Milad un-Nabi" },
  ],
};

/** Every public holiday between two dates, fixed and lunar, deduplicated. */
export function holidaysBetween(start: string, end: string) {
  const firstYear = Number(start.slice(0, 4));
  const lastYear = Number(end.slice(0, 4));
  const byDate = new Map<string, string>();

  for (let year = firstYear; year <= lastYear; year++) {
    for (const h of PK_FIXED_HOLIDAYS) {
      const date = `${year}-${String(h.month).padStart(2, "0")}-${String(h.day).padStart(2, "0")}`;
      if (date >= start && date <= end) byDate.set(date, h.name);
    }

    for (const h of PK_LUNAR_HOLIDAYS[year] ?? []) {
      if (h.date >= start && h.date <= end) byDate.set(h.date, h.name);
    }
  }

  return [...byDate.entries()]
    .map(([date, name]) => ({ date, name }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
