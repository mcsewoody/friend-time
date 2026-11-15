import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { Converter } from "opencc-js";
const require = createRequire(import.meta.url),
  { Solar } = require("lunar-javascript");
const tw = Converter({ from: "cn", to: "tw" }),
  raw = JSON.parse(
    await fs.readFile(
      new URL("../.qa/official-calendar.json", import.meta.url),
      "utf8",
    ),
  );
const out = new URL("../docs/data/", import.meta.url),
  years = [];
for (let year = 2023; year <= 2030; year++) {
  const days = {};
  let officialLunarCount = 0,
    officialTermsCount = 0;
  for (
    let d = new Date(Date.UTC(year, 0, 1));
    d.getUTCFullYear() === year;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const key = d.toISOString().slice(0, 10),
      l = Solar.fromYmd(year, d.getUTCMonth() + 1, d.getUTCDate()).getLunar(),
      cwa = raw.lunar[key],
      official = raw.official[key];
    const lunarMonth = cwa
        ? Number(cwa["農曆月"].replace("閏", "-"))
        : l.getMonth(),
      lunarDay = cwa ? Number(cwa["農曆日"]) : l.getDay();
    // Treat any astronomy conversion mismatch as a verification failure.
    if (cwa) {
      if (lunarMonth !== l.getMonth() || lunarDay !== l.getDay())
        throw Error(`CWA mismatch ${key}`);
      officialLunarCount++;
    }
    const t = raw.terms[key];
    if (t) officialTermsCount++;
    days[key] = {
      holiday: official?.isHoliday ?? null,
      note: official?.note || "",
      lunar: tw(`${l.getMonthInChinese()}月${l.getDayInChinese()}`),
      lunarShort: tw(
        lunarDay === 1 ? `${l.getMonthInChinese()}月` : l.getDayInChinese(),
      ),
      lunarYear: cwa?.["農曆年"] || l.getYearInGanZhi(),
      lunarOfficial: !!cwa,
      festival: l.getFestivals().map(tw).join("、"),
      term: t ? (t["節氣"] === "-" ? "" : t["節氣"]) : tw(l.getJieQi()),
      termTime: t && t["節氣時分"] !== "-" ? t["節氣時分"] : "",
      termOfficial: !!t,
      ganZhi: tw(l.getDayInGanZhi()),
      zodiac: tw(l.getYearShengXiao()),
      yi: l.getDayYi().map(tw),
      ji: l.getDayJi().map(tw),
      chongSha: tw(`沖${l.getDayChongShengXiao()}・煞${l.getDaySha()}`),
    };
  }
  await fs.writeFile(
    new URL(`${year}.json`, out),
    JSON.stringify({
      year,
      metadata: {
        officialYears: Object.keys(raw.sources).map(Number),
        checkedAt: raw.checkedAt,
      },
      days,
    }),
  );
  years.push({
    year,
    days: Object.keys(days).length,
    officialLunarCount,
    officialTermsCount,
  });
}
await fs.writeFile(
  new URL("sources.json", out),
  JSON.stringify(
    {
      checkedAt: raw.checkedAt,
      officialYears: Object.keys(raw.sources).map(Number),
      years,
      dgpa: raw.sources,
      lunar: raw.lunarSource,
      terms: raw.termSource,
      folk: "https://github.com/6tail/lunar-javascript",
      folkVersion: require("lunar-javascript/package.json").version,
      license: "MIT",
    },
    null,
    2,
  ),
);
console.log(years);
