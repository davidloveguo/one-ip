import type { Geo } from "@/lib/types";
import { canonicalIp } from "@/views/ip/scenario-evidence";

export type EnvHttpEgress = {
  ipv4: Geo | null;
  ipv6: Geo | null;
};

type Severity = "normal" | "warning" | "unavailable";
type Candidate = { ip: string; public: boolean; kind?: string };
type Resolver = { ip: string; country?: string };

function comparableIp(value: string | undefined) {
  const ip = canonicalIp(value);
  if (!ip) return null;

  // ICE can report an IPv4 address in its IPv4-mapped IPv6 form.
  const mapped = /^\[::ffff:([\da-f]+):([\da-f]+)\]$/i.exec(ip);
  if (!mapped) return ip;
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function isPrivateIp(ip: string) {
  if (ip.startsWith("[")) return /^\[(?:f[cd]|fe[89ab])/i.test(ip);
  const [first, second] = ip.split(".").map(Number);
  return (
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export function assessEnvWebRtc<T extends Candidate>(
  candidates: readonly T[],
  egress: EnvHttpEgress,
) {
  const ipv4 = comparableIp(egress.ipv4?.ip);
  const ipv6 = comparableIp(egress.ipv6?.ip);
  const matches: T[] = [];
  const mismatches: T[] = [];
  const unverified: T[] = [];
  const local = new Set<string>();

  for (const candidate of candidates) {
    const ip = comparableIp(candidate.ip);
    if (!ip) continue;
    if (!candidate.public) {
      if (isPrivateIp(ip)) local.add(ip);
      continue;
    }
    if (candidate.kind === "relay") continue;

    const sameFamily = ip.startsWith("[") ? ipv6 : ipv4;
    if (!sameFamily || ip.startsWith("[") !== sameFamily.startsWith("[")) {
      unverified.push(candidate);
    } else if (ip === sameFamily) {
      matches.push(candidate);
    } else {
      mismatches.push(candidate);
    }
  }

  const localExposed = [...local].map((ip) => ip.replace(/^\[|\]$/g, ""));
  let severity: Severity = "unavailable";
  if (mismatches.length || localExposed.length) severity = "warning";
  else if (matches.length) severity = unverified.length ? "warning" : "normal";

  return { severity, matches, mismatches, unverified, localExposed };
}

function countryCode(value: string | undefined) {
  const code = value?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) && code !== "XX" && code !== "ZZ"
    ? code
    : undefined;
}

export function assessEnvDns<T extends Resolver>(
  result: { results: readonly T[]; count: number; failed: number },
  egress: EnvHttpEgress,
) {
  // A DNS resolver can use a different address family than the HTTP client.
  const egressCountries = [
    ...new Set(
      [egress.ipv4, egress.ipv6].flatMap((address) => {
        const code = countryCode(address?.country_code);
        return code ? [code] : [];
      }),
    ),
  ];
  const mismatches: T[] = [];
  let unknown = 0;
  for (const resolver of result.results) {
    const country = countryCode(resolver.country);
    if (!country || !egressCountries.length) unknown++;
    else if (!egressCountries.includes(country)) mismatches.push(resolver);
  }

  const { failed } = result;
  const successful = result.count - failed;
  let severity: Severity = "unavailable";
  if (successful && result.results.length > unknown) {
    severity = failed || unknown || mismatches.length ? "warning" : "normal";
  }

  return { severity, egressCountries, mismatches, unknown, successful, failed };
}
