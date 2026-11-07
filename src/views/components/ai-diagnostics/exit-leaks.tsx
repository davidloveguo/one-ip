import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ActionButton, IpText, Pending, ToolCard } from "@/components/toolkit";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { endpoint } from "@/lib/network";
import type { Geo } from "@/lib/types";
import {
  dnsSources,
  sampleDnsSource,
  type DnsResolver,
} from "@/views/dns-exit/api";
import {
  assessEnvDns,
  assessEnvWebRtc,
  type EnvHttpEgress,
} from "@/views/env/network-assessment";
import { canonicalIp, sameIp } from "@/views/ip/scenario-evidence";
import { collectCandidates } from "@/views/webrtc/api";
import { useQuery } from "@tanstack/react-query";

const probeOptions = {
  retry: false,
  staleTime: 60_000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
};

async function sampleDnsEvidence(signal: AbortSignal) {
  const probeSignal = AbortSignal.any([signal, AbortSignal.timeout(6500)]);
  const samples = await Promise.allSettled(
    dnsSources.map((source) => sampleDnsSource(source, probeSignal)),
  );
  signal.throwIfAborted();

  const resolvers = new Map<string, DnsResolver>();
  let failed = 0;
  for (const sample of samples) {
    const rows =
      sample.status === "fulfilled"
        ? sample.value.filter((row) => canonicalIp(row.ip))
        : [];
    if (!rows.length) {
      failed++;
      continue;
    }
    for (const row of rows) {
      const existing = resolvers.get(row.ip);
      if (existing) {
        existing.country ??= row.country;
        existing.geo ||= row.geo;
      } else {
        resolvers.set(row.ip, { ...row });
      }
    }
  }
  return { results: [...resolvers.values()], count: samples.length, failed };
}

async function sampleWebRtcEvidence(signal: AbortSignal) {
  const candidates = await collectCandidates(signal);
  const publicCandidates = candidates
    .filter((row) => row.public && row.kind !== "relay")
    .slice(0, 3);
  const lookupSignal = AbortSignal.any([signal, AbortSignal.timeout(3500)]);
  const locations = await Promise.all(
    publicCandidates.map(async ({ ip }) => {
      try {
        const geo = await endpoint<Geo>(`/geoip/${encodeURIComponent(ip)}`, {
          signal: lookupSignal,
        });
        return sameIp(geo?.ip, ip) ? geo : undefined;
      } catch {
        signal.throwIfAborted();
        return undefined;
      }
    }),
  );
  const geos = new Map(publicCandidates.map(({ ip }, i) => [ip, locations[i]]));
  return candidates.map((row) => ({ ...row, geo: geos.get(row.ip) }));
}

function CheckCard({
  title,
  pending,
  onRetry,
  link,
  status,
  children,
}: {
  title: string;
  pending: boolean;
  onRetry: () => void;
  link: string;
  status: string;
  children: ReactNode;
}) {
  return (
    <ToolCard
      className="min-w-0"
      title={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>{title}</span>
          <ActionButton
            type="button"
            variant="outline"
            size="sm"
            busy={pending}
            onClick={onRetry}
          >
            {t("重新检测")}
          </ActionButton>
        </div>
      }
    >
      <div className="space-y-3">
        {pending ? (
          <Pending />
        ) : (
          <>
            <p className="text-sm font-medium" role="status">
              {status}
            </p>
            {children}
          </>
        )}
        <Button asChild variant="outline" size="sm">
          <Link to={link}>{t("深度检测")}</Link>
        </Button>
      </div>
    </ToolCard>
  );
}

export function AiExitLeaks({ exit }: { exit?: Geo }) {
  const address = canonicalIp(exit?.ip);
  const isIpv6 = address?.startsWith("[") && !address.startsWith("[::ffff:");
  const egress: EnvHttpEgress = {
    ipv4: exit && address && !isIpv6 ? exit : null,
    ipv6: exit && isIpv6 ? exit : null,
  };
  const dns = useQuery({
    ...probeOptions,
    queryKey: ["ai-dns-exit-evidence"],
    queryFn: ({ signal }) => sampleDnsEvidence(signal),
  });
  const webrtc = useQuery({
    ...probeOptions,
    queryKey: ["ai-webrtc-exit-evidence"],
    queryFn: ({ signal }) => sampleWebRtcEvidence(signal),
  });
  const dnsData = dns.isError ? undefined : dns.data;
  const dnsReport = dnsData && assessEnvDns(dnsData, egress);
  const rtcReport = assessEnvWebRtc(
    webrtc.isError ? [] : (webrtc.data ?? []),
    egress,
  );
  const rtcRows = [
    ...rtcReport.matches.map((row) => ({
      ...row,
      evidence: t("与同族网页出口一致"),
    })),
    ...rtcReport.mismatches.map((row) => ({
      ...row,
      evidence: t("与同族网页出口不同"),
    })),
    ...rtcReport.unverified.map((row) => ({
      ...row,
      evidence: t("缺少同族网页出口"),
    })),
  ];
  const dnsStatus = dnsReport?.mismatches.length
    ? t("解析器地区与网页出口不同")
    : dnsReport?.severity === "normal"
      ? t("已采样解析器与网页出口同地区")
      : t("无法确认");
  const rtcStatus = rtcReport.mismatches.length
    ? t("观察到不同的公网 UDP 出口")
    : rtcReport.severity === "normal"
      ? t("已采样 UDP 出口与网页出口一致")
      : t("无法确认");

  return (
    <>
      <CheckCard
        title={t("DNS 泄露检测")}
        pending={dns.isPending || dns.isFetching}
        onRetry={() => void dns.refetch()}
        link="/network/dns"
        status={dnsStatus}
      >
        {dnsReport && (
          <p className="text-xs text-muted-foreground">
            {t("{0}/{1} 个 DNS 探测来源有响应", [
              dnsReport.successful,
              dnsData.count,
            ])}
          </p>
        )}
        {!!dnsData?.results.length && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">{t("DNS 出口 IP")}</p>
            <ul className="space-y-2 text-sm">
              {dnsData.results.map((row) => (
                <li key={row.ip} className="min-w-0 break-words">
                  <IpText ip={row.ip} link={false} />
                  <p className="text-xs text-muted-foreground">
                    {row.geo || row.country || t("归属地未知")}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(
            "本次检测按地区对照 DNS 解析器与网页出口。地区不同可能来自公共 DNS 或代理分流。",
          )}
        </p>
      </CheckCard>
      <CheckCard
        title={t("WebRTC UDP 泄露检测")}
        pending={webrtc.isPending || webrtc.isFetching}
        onRetry={() => void webrtc.refetch()}
        link="/browser/privacy"
        status={rtcStatus}
      >
        {!!rtcRows.length && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              {t("公网 UDP 出口")}
            </p>
            <ul className="space-y-2 text-sm">
              {rtcRows.map(({ ip, geo, evidence }) => (
                <li key={ip} className="min-w-0 break-words">
                  <IpText ip={ip} link={false} />
                  <p className="text-xs text-muted-foreground">
                    {[
                      geo?.country ?? geo?.country_code,
                      geo?.city,
                      geo?.isp,
                      evidence,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!!rtcReport.localExposed.length && (
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span>{t("观察到内网地址")}</span>
            {rtcReport.localExposed.map((ip) => (
              <IpText key={ip} ip={ip} link={false} />
            ))}
          </div>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(
            "仅对照与网页出口同为 IPv4 或同为 IPv6 的公网 UDP 地址。出口不同请核对代理分流。",
          )}
        </p>
      </CheckCard>
    </>
  );
}
