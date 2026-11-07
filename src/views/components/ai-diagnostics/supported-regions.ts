export type AiExitKind = "claude" | "gpt";

// Country codes from each provider's consumer web access list, reviewed on
// 2026-11-07. Update these snapshots from their sources when policies change.
export const supportedRegions = {
  claude: {
    source:
      "https://support.claude.com/en/articles/8461763-where-can-i-access-claude",
    checkedOn: "2026-11-07",
    countries: `
      AD AE AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN
      BO BR BS BT BW BZ CA CG CH CI CL CM CO CR CV CY CZ DE DJ DK
      DM DO DZ EC EE EG ES FI FJ FM FR GA GB GD GE GH GM GN GQ GR
      GT GW GY HN HR HT HU ID IE IL IN IQ IS IT JM JO JP KE KG KH
      KI KM KN KR KW KZ LA LB LC LI LK LR LS LT LU LV MA MC MD ME
      MG MH MK MN MP MR MT MU MV MW MX MY MZ NA NE NG NL NO NP NR
      NZ OM PA PE PG PH PK PL PS PT PW PY QA RO RS RW SA SB SC SE
      SG SI SK SL SM SN SR ST SV SZ TD TG TH TJ TL TM TN TO TR TT
      TV TW TZ UA UG US UY UZ VA VC VN VU WS ZA ZM ZW
    `
      .trim()
      .split(/\s+/),
  },
  gpt: {
    source:
      "https://help.openai.com/en/articles/7947663-chatgpt-supported-countries",
    checkedOn: "2026-11-07",
    countries: `
      AD AE AF AG AL AM AO AR AT AU AW AX AZ BA BB BD BE BF BG BH
      BI BJ BL BM BN BO BR BS BT BW BZ CA CD CF CG CH CI CL CM CO
      CR CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FO
      FR GA GB GD GE GF GH GL GM GN GP GQ GR GT GW GY HN HR HT HU
      ID IE IL IN IQ IS IT JM JO JP KE KG KH KI KM KN KR KW KY KZ
      LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML
      MM MN MQ MR MT MU MV MW MX MY MZ NA NC NE NG NI NL NO NP NR
      NZ OM PA PE PF PG PH PK PL PM PS PT PW PY QA RE RO RS RW SA
      SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SZ TD TF
      TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VN
      VU WF WS YE YT ZA ZM ZW
    `
      .trim()
      .split(/\s+/),
  },
} satisfies Record<
  AiExitKind,
  { source: string; checkedOn: string; countries: string[] }
>;

export function normalizeExitCountry(value: unknown) {
  if (typeof value !== "string") return undefined;
  const code = value.trim().toUpperCase();
  if (code === "UK") return "GB";
  return /^[A-Z]{2}$/.test(code) && !["EU", "XX", "ZZ"].includes(code)
    ? code
    : undefined;
}

export function assessSupportedRegion(
  kind: AiExitKind,
  ...sources: (string | undefined)[]
): "supported" | "not-listed" | "partial" | "conflict" | "unknown" {
  const countries = [
    ...new Set(sources.map(normalizeExitCountry).filter(Boolean)),
  ];
  if (countries.length > 1) return "conflict";
  const country = countries[0];
  if (!country) return "unknown";
  // Both providers document regional exceptions that a country code cannot resolve.
  if (country === "UA") return "partial";
  return supportedRegions[kind].countries.includes(country)
    ? "supported"
    : "not-listed";
}
