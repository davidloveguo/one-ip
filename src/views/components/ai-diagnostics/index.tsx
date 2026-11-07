import { useEffect } from "react";
import { CountryFlag } from "@/components/country-flag";
import {
  PrivacyToggle,
  PageHeading,
  ToolCard,
  IpText,
  Pending,
} from "@/components/toolkit";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { t, locale } from "@/i18n";
import type { Geo } from "@/lib/types";
import { AiNetworkCheck } from "@/views/ai/network-check";
import { AiPlatformLinks } from "@/views/ai/platform-links";
import { aiPlatforms } from "@/views/ai/platforms";
import { claudeApi } from "@/views/claude/api";
import { claudeHistoryAtom } from "@/views/claude/store";
import { gptApi } from "@/views/gpt/api";
import { gptHistoryAtom } from "@/views/gpt/store";
import { sameIp } from "@/views/ip/scenario-evidence";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { AiDeviceDetails } from "./device-details";
import { AiExitLeaks } from "./exit-leaks";
import { AiExitRiskCards } from "./exit-risk";
import { normalizeExitCountry } from "./supported-regions";

function ExitCard({
  title,
  exit,
  geo,
  pending,
}: {
  title: string;
  exit?: Geo;
  geo?: Geo;
  pending: boolean;
}) {
  const location = [
    geo?.country ?? exit?.country_code,
    geo?.region,
    geo?.city,
    geo?.isp,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ToolCard title={title}>
      <div className="ip-value flex min-w-0 items-center gap-2 text-primary">
        {pending ? (
          <Pending>{t("正在检测出口…")}</Pending>
        ) : exit ? (
          <>
            <CountryFlag code={geo?.country_code ?? exit.country_code} />
            <IpText ip={exit.ip} />
          </>
        ) : (
          <span className="text-sm text-muted-foreground">{t("暂不可用")}</span>
        )}
      </div>
      <p className="small muted mt-1 break-words">
        {exit
          ? location || t("归属地未知")
          : !pending && t("暂未获取出口，可能受连接或跨域限制。")}
      </p>
    </ToolCard>
  );
}

export default function AiDiagnostics({ kind }: { kind: "claude" | "gpt" }) {
  const api = kind === "claude" ? claudeApi : gptApi;
  const platform = aiPlatforms.find(({ id }) => id === kind)!;
  const title =
    kind === "claude"
      ? t("Claude AI IP 风险检测")
      : t("ChatGPT · Codex IP 风险检测");
  const [history, setHistory] = useAtom(
    kind === "claude" ? claudeHistoryAtom : gptHistoryAtom,
  );
  const domestic = useQuery({
    queryKey: ["domestic-ip"],
    queryFn: ({ signal }) => api.domestic(signal),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const cf = useQuery({
    queryKey: ["cf-exit"],
    queryFn: ({ signal }) => api.cloudflare(signal),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const exit = useQuery({
    queryKey: [kind, "exit"],
    staleTime: 60_000,
    queryFn: ({ signal }) => api.exit(signal),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const currentExit = exit.isError ? undefined : exit.data;
  const ip = currentExit?.ip;
  const exitCards = [
    { title: t("国内 IPv4"), query: domestic },
    { title: t("Cloudflare 出口"), query: cf },
    { title: t("{0} 出口", [platform.name]), query: exit },
  ];
  const addresses = [
    ...new Set(
      exitCards.flatMap(({ query }) =>
        !query.isError && query.data?.ip ? [query.data.ip] : [],
      ),
    ),
  ];
  const locations = useQueries({
    queries: addresses.map((address) => ({
      queryKey: ["geo", address],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.geo(address, signal),
      staleTime: 60_000,
      retry: false,
      refetchOnWindowFocus: false,
    })),
  });
  const geoByIp = new Map(
    addresses.map((address, index) => {
      const geo = locations[index].data;
      return [address, geo && sameIp(address, geo.ip) ? geo : undefined];
    }),
  );
  const platformGeo = ip ? geoByIp.get(ip) : undefined;
  const traceCountry = normalizeExitCountry(currentExit?.country_code);
  const lookupCountry = normalizeExitCountry(platformGeo?.country_code);
  const countryMatches =
    !traceCountry || !lookupCountry || traceCountry === lookupCountry;
  const platformExit = currentExit && {
    ...platformGeo,
    ip: currentExit.ip,
    country_code: countryMatches ? (lookupCountry ?? traceCountry) : undefined,
  };
  useEffect(() => {
    if (ip)
      setHistory((previous) =>
        sameIp(previous[0]?.ip, ip)
          ? previous
          : [{ ip, time: new Date().toISOString() }, ...previous].slice(0, 20),
      );
  }, [ip, setHistory]);
  return (
    <div className="ai-diagnostics space-y-4">
      <PageHeading title={title} description="" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p
            aria-hidden="true"
            className="text-2xl font-semibold tracking-tight"
          >
            {title}
          </p>
          <p className="small muted mt-1">
            {t("查看浏览器访问平台时的出口、IP 信誉、DNS、WebRTC 和设备信息。")}
          </p>
        </div>
        <PrivacyToggle />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {exitCards.map(({ title: cardTitle, query }) => (
          <ExitCard
            key={cardTitle}
            title={cardTitle}
            exit={query.isError ? undefined : query.data}
            geo={query.data && geoByIp.get(query.data.ip)}
            pending={query.isPending}
          />
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <AiExitRiskCards
          kind={kind}
          ip={ip}
          geo={platformGeo}
          traceCountry={traceCountry}
          pending={exit.isPending}
        />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <AiNetworkCheck
          domains={
            kind === "claude"
              ? ["claude.ai", "anthropic.com"]
              : ["chatgpt.com", "api.openai.com"]
          }
          summary={{
            statusId: platform.statusId,
            statusPath: kind === "claude" ? "/status/claude" : "/status/openai",
          }}
        />
        <AiExitLeaks exit={platformExit} />
      </div>
      <AiDeviceDetails
        exitTimezone={countryMatches ? platformGeo?.timezone : undefined}
        exitCountry={platformExit?.country_code}
      />
      <Accordion
        type="multiple"
        defaultValue={["history"]}
        className="ai-details"
      >
        <AccordionItem value="history">
          <AccordionTrigger>
            <span>
              {t("出口历史")}{" "}
              <span className="ai-detail-summary">
                {history.length}
                {t("条 · 当前浏览器")}
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="row-between">
              <p className="small muted">
                {t("仅保存在当前浏览器，最多 20 条")}
              </p>
              <Button
                variant="ghost"
                size="sm"
                disabled={!history.length}
                onClick={() => setHistory([])}
              >
                {t("清除记录")}
              </Button>
            </div>
            {history.length ? (
              <div className="history-grid">
                {history.map((item) => (
                  <div key={item.time}>
                    <IpText ip={item.ip} />
                    <time dateTime={item.time}>
                      {new Date(item.time).toLocaleString(locale)}
                      {sameIp(item.ip, ip) && <span> · {t("当前")}</span>}
                    </time>
                  </div>
                ))}
              </div>
            ) : (
              <p className="small muted">{t("暂无历史记录")}</p>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      <ToolCard title={t("相关工具")}>
        <AiPlatformLinks platform={platform} />
      </ToolCard>
    </div>
  );
}
