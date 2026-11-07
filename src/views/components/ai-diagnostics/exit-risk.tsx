import { CountryFlag } from "@/components/country-flag";
import { Facts, Pending, ToolCard } from "@/components/toolkit";
import { t } from "@/i18n";
import { ipScoreColor } from "@/lib/ip-score";
import type { Geo } from "@/lib/types";
import { lookupIpWithFallback } from "@/views/ip/api";
import { ipProfile } from "@/views/ip/profile";
import { sameIp } from "@/views/ip/scenario-evidence";
import { useQuery } from "@tanstack/react-query";
import {
  assessSupportedRegion,
  normalizeExitCountry,
  supportedRegions,
  type AiExitKind,
} from "./supported-regions";

function RiskFlag({ value }: { value?: boolean }) {
  if (typeof value !== "boolean")
    return <span className="ip-chip ip-chip-neutral">{t("未知")}</span>;
  return (
    <span className={`ip-chip ip-chip-${value ? "bad" : "good"}`}>
      {value ? t("已检测到") : t("未检测到")}
    </span>
  );
}

function ReputationMeter({
  score,
  scoreBand,
}: {
  score: number;
  scoreBand: number;
}) {
  const grades = [t("信誉偏低"), t("信誉一般"), t("信誉良好"), t("高信誉")];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-center gap-2">
        <strong
          className="text-3xl font-semibold tabular-nums"
          style={{ color: ipScoreColor(score) }}
        >
          {score}
          <small className="ml-1 text-sm text-muted-foreground">/ 100</small>
        </strong>
        <span className="text-sm">
          {score === 100 ? t("满分信誉") : grades[scoreBand]}
        </span>
      </div>
      <div
        role="meter"
        aria-label={t("IP 信誉分")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        className="relative h-2 rounded-full bg-linear-to-r from-[var(--danger)] via-[var(--warning)] to-[var(--success)]"
      >
        <span
          aria-hidden="true"
          className="absolute -top-1 h-4 w-1 -translate-x-1/2 rounded-full bg-foreground"
          style={{ left: `clamp(2px, ${score}%, calc(100% - 2px))` }}
        />
      </div>
      <div
        aria-hidden="true"
        className="flex justify-between text-xs text-muted-foreground tabular-nums"
      >
        {[0, 25, 50, 75, 100].map((tick) => (
          <span key={tick}>{tick}</span>
        ))}
      </div>
    </div>
  );
}

export function AiExitRiskCards({
  kind,
  ip,
  geo,
  traceCountry,
  pending = false,
}: {
  kind: AiExitKind;
  ip?: string;
  geo?: Geo;
  traceCountry?: string;
  pending?: boolean;
}) {
  const lookup = useQuery({
    queryKey: ["ai-exit-risk", ip],
    enabled: !!ip,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => lookupIpWithFallback(ip!, signal),
  });
  const loading = pending || Boolean(ip && lookup.isPending);
  const result = lookup.isError ? undefined : lookup.data;
  const risk = result?.risk.available ? result.risk : undefined;
  const coffee = risk ? result?.coffee : undefined;
  const profile = coffee ? ipProfile(coffee) : undefined;
  const type = profile?.checks.find(({ label }) => label === t("IP 类型"));
  const fallbackGeo = ip && geo && sameIp(geo.ip, ip) ? geo : undefined;
  const countryCode =
    normalizeExitCountry(result?.geo.country_code) ??
    normalizeExitCountry(fallbackGeo?.country_code) ??
    normalizeExitCountry(traceCountry);
  const country = result?.geo.country ?? fallbackGeo?.country ?? countryCode;
  const asn = result?.geo.asn ?? fallbackGeo?.asn;
  const registeredCountry = normalizeExitCountry(
    coffee?.registered_country_code,
  );
  const locatedCountry = normalizeExitCountry(coffee?.countryCode);
  const origin =
    registeredCountry && locatedCountry && coffee?.is_public_service !== true
      ? registeredCountry === locatedCountry
        ? t("原生 IP")
        : t("注册地不同")
      : undefined;
  const region = ip
    ? assessSupportedRegion(
        kind,
        traceCountry,
        result?.geo.country_code,
        fallbackGeo?.country_code,
      )
    : "unknown";
  const regionLabel = {
    supported: t("清单列出"),
    "not-listed": t("清单未列出"),
    partial: t("部分地区例外"),
    conflict: t("出口归属地存在差异"),
    unknown: t("未知"),
  }[region];
  const regionTone =
    region === "supported" ? "good" : region === "unknown" ? "neutral" : "warn";
  const policy = supportedRegions[kind];
  const unavailable = !ip
    ? t("未获取到出口")
    : (result?.risk.reason ?? t("风险数据源暂不可用。"));

  return (
    <>
      <ToolCard title={t("IP 信誉分")}>
        {profile?.score != null && profile.scoreBand != null ? (
          <>
            <ReputationMeter
              score={profile.score}
              scoreBand={profile.scoreBand}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {t("IP 信誉分来自 Net.Coffee。")}
            </p>
          </>
        ) : (
          <p className="small muted">
            {loading ? <Pending /> : risk ? t("信誉分未知") : unavailable}
          </p>
        )}
        <Facts
          rows={[
            [
              t("支持地区"),
              <span className={`ip-chip ip-chip-${regionTone}`}>
                {region === "unknown" && loading ? <Pending /> : regionLabel}
              </span>,
            ],
          ]}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          {t("按浏览器出口 IP 的估计地区对照。")}{" "}
          <a
            className="text-primary underline underline-offset-4"
            href={policy.source}
            target="_blank"
            rel="noreferrer"
          >
            {t("官方地区清单")}
          </a>{" "}
          {t("清单核对日期 {0}", [policy.checkedOn])}
        </p>
      </ToolCard>
      <ToolCard title={t("出口 IP 属性")}>
        <Facts
          rows={[
            [
              t("国家 / 地区"),
              country ? (
                <span className="inline-flex items-center gap-1.5">
                  <CountryFlag code={countryCode} /> {country}
                </span>
              ) : undefined,
            ],
            [t("城市"), result?.geo.city ?? fallbackGeo?.city],
            [t("IP 类型"), type?.value],
            [t("IP 原生性"), origin],
            ["ASN", asn ? `AS${String(asn).replace(/^AS/i, "")}` : undefined],
            [t("运营商"), result?.geo.isp ?? fallbackGeo?.isp],
          ]}
        />
      </ToolCard>
      <ToolCard title={t("出口 IP 安全检测")}>
        <Facts
          rows={[
            ["VPN", <RiskFlag value={risk?.vpn} />],
            [t("代理"), <RiskFlag value={risk?.proxy} />],
            ["Tor", <RiskFlag value={risk?.tor} />],
            [t("爬虫标记"), <RiskFlag value={risk?.bot_status} />],
            [t("滥用标记"), <RiskFlag value={risk?.recent_abuse} />],
          ]}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          {loading ? (
            <Pending />
          ) : risk ? (
            t("网络标记来自 Net.Coffee。")
          ) : (
            unavailable
          )}
        </p>
      </ToolCard>
    </>
  );
}
