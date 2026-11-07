import { t } from "@/i18n";
import { endpoint, request } from "@/lib/network";
import type { Geo, Lookup } from "@/lib/types";
import { adaptCoffee, type CoffeeIp, type CoffeeLookup } from "./coffee.ts";
import { sameIp } from "./scenario-evidence.ts";

const PRIMARY_LOOKUP_TIMEOUT_MS = 5000;

export async function lookupIp(ip: string, signal?: AbortSignal) {
  const data = await request<CoffeeIp>(
    `https://ip.net.coffee/api/ip/lookup/${encodeURIComponent(ip)}`,
    { signal, mode: "cors", credentials: "omit", cache: "no-store" },
  );
  if (typeof data?.ip !== "string" || !sameIp(data.ip, ip))
    throw new Error(t("IP 数据源返回的地址不匹配"));
  return adaptCoffee(data);
}

async function lookupIpViaServer(
  ip: string,
  signal?: AbortSignal,
): Promise<CoffeeLookup> {
  const data = await endpoint<Pick<Lookup, "sources" | "rdap">>(
    `/ip/lookup/${encodeURIComponent(ip)}`,
    { signal },
  );
  const sources = data.sources.filter((source) => sameIp(source.ip, ip));
  const geo = sources[0];
  if (!geo) throw new Error(t("IP 归属地数据源未返回有效结果"));

  const asn = Number(String(geo.asn ?? "").replace(/^AS/i, ""));
  return {
    coffee: {
      ip: geo.ip,
      country: geo.country,
      countryCode: geo.country_code,
      region: geo.region,
      city: geo.city,
      isp: geo.isp,
      asn: Number.isInteger(asn) && asn > 0 ? asn : undefined,
    },
    geo,
    sources,
    rdap: data.rdap,
    risk: { available: false, reason: t("风险数据源暂不可用。") },
    fallback: true,
  };
}

export async function lookupIpWithFallback(ip: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(PRIMARY_LOOKUP_TIMEOUT_MS);
  try {
    return await lookupIp(
      ip,
      signal ? AbortSignal.any([signal, timeout]) : timeout,
    );
  } catch {
    signal?.throwIfAborted();
    return lookupIpViaServer(ip, signal);
  }
}

export const currentIp = (signal?: AbortSignal) =>
  endpoint<Geo>("/me", { signal });
