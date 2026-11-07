import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeading } from "@/components/toolkit";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { trace } from "@/lib/network";
import { consistencyChecks, automationChecks, fingerprint } from "@/views/browser/collect";
import {
  collectDeepDiagnostics,
  type DiagnosticModule,
} from "@/views/browser/deep-diagnostics";
import { environmentRows, environmentSnapshot } from "@/views/browser/environment";
import {
  fieldLabel,
  moduleReport,
  parseDetail,
} from "@/views/browser/result-format";
import { detectDnsExits } from "@/views/dns-exit/api";
import { getBrowserIp } from "@/views/home/api";
import { currentIp, lookupIpWithFallback } from "@/views/ip/api";
import { collectCandidates, isPublicCandidate } from "@/views/webrtc/api";
import { AlertTriangle, CheckCircle2, CircleHelp, ShieldAlert } from "lucide-react";
import { AiTroubleshooting } from "./ai-troubleshooting";
import {
  assessEnvDns,
  assessEnvWebRtc,
  type EnvHttpEgress,
} from "./network-assessment";

type Severity = "critical" | "warning" | "normal" | "unavailable";
type ReportItem = {
  id: string;
  title: string;
  severity: Severity;
  actual: string;
  expected?: string;
  explanation: string;
  technical?: unknown;
};

const TOTAL_CHECKS = 18;
const networkDetails = new Set(["webrtc", "dns", "ipv6", "ip-risk"]);
const severityMeta: Record<
  Severity,
  { label: string; icon: typeof ShieldAlert; color: string; bg: string }
> = {
  critical: {
    label: "严重问题",
    icon: ShieldAlert,
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-500/8 ring-red-500/20",
  },
  warning: {
    label: "需要注意",
    icon: AlertTriangle,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/8 ring-amber-500/20",
  },
  normal: {
    label: "正常",
    icon: CheckCircle2,
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/8 ring-emerald-500/20",
  },
  unavailable: {
    label: "无法检测",
    icon: CircleHelp,
    color: "text-muted-foreground",
    bg: "bg-muted/50 ring-foreground/10",
  },
};

function unavailable(id: string, title: string, reason: unknown): ReportItem {
  return {
    id,
    title,
    severity: "unavailable",
    actual: "未取得检测结果",
    explanation:
      reason instanceof Error ? reason.message : "浏览器或网络限制了本次检测。",
    technical: reason instanceof Error ? reason.message : reason,
  };
}

function deepModule(modules: DiagnosticModule[], name: string) {
  return modules.find((module) => module.name === name);
}

async function detectHttpFamily(family: 4 | 6, signal: AbortSignal) {
  const matchesFamily = (ip: string) =>
    ip.includes(":") === (family === 6) && isPublicCandidate(ip);
  try {
    // An IP literal keeps the Cloudflare probe on the intended address family.
    const host = family === 4 ? "1.1.1.1" : "[2606:4700:4700::1111]";
    const result = await trace(host, signal);
    if (matchesFamily(result.ip)) return result;
  } catch {
    signal.throwIfAborted();
  }
  try {
    const result = await getBrowserIp(family, signal);
    return matchesFamily(result.ip) ? result : null;
  } catch {
    signal.throwIfAborted();
    return null;
  }
}

function httpReference({ ipv4, ipv6 }: EnvHttpEgress) {
  return `HTTP IPv4：${ipv4?.ip ?? "未取得"}；IPv6：${ipv6?.ip ?? "未取得"}`;
}

function deepItem(
  modules: DiagnosticModule[],
  name: string,
  id: string,
  title: string,
): ReportItem {
  const module = deepModule(modules, name);
  if (!module) return unavailable(id, title, "深度检测没有返回该模块。");
  const value = parseDetail(module.detail);
  const report = moduleReport(name, value);
  return {
    id,
    title,
    severity: report.unavailable
      ? "unavailable"
      : report.signal
        ? "warning"
        : "normal",
    actual: report.summary,
    expected: report.signal ? "检测模块未标记明确差异" : undefined,
    explanation: report.signal
      ? "检测模块记录了可观察差异；请结合技术详情核对，单个指纹值或硬件型号本身不代表异常。"
      : "检测已完成，未发现该模块明确标记的数据差异。",
    technical: value,
  };
}

function ResultCard({ item }: { item: ReportItem }) {
  const meta = severityMeta[item.severity];
  const Icon = meta.icon;
  return (
    <Card className={`ring-1 ${meta.bg}`}>
      <CardHeader>
        <CardTitle className="flex items-start gap-2">
          <Icon className={`mt-0.5 size-4 shrink-0 ${meta.color}`} />
          <span>{item.title}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <div className="text-xs text-muted-foreground">实际检测值</div>
            <div className="mt-1 break-words font-medium">{item.actual}</div>
          </div>
          {item.expected && (
            <div>
              <div className="text-xs text-muted-foreground">对照值</div>
              <div className="mt-1 break-words font-medium">{item.expected}</div>
            </div>
          )}
        </div>
        <div>
          <div className="text-xs text-muted-foreground">问题说明</div>
          <p className="mt-1 leading-6">{item.explanation}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function EnvironmentReportPage() {
  const [items, setItems] = useState<ReportItem[]>([]);
  const [running, setRunning] = useState(true);
  const [round, setRound] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    setItems([]);
    setRunning(true);
    const add = (item: ReportItem) => {
      if (!signal.aborted)
        setItems((current) =>
          current.some((entry) => entry.id === item.id)
            ? current
            : [...current, item],
        );
    };

    const environment = environmentSnapshot();
    const raw: Record<string, unknown> = {
      environment: Object.fromEntries(environmentRows()),
    };

    const consistencyTask = (async () => {
      try {
        const checks = await consistencyChecks();
        raw.consistency = checks;
        for (const [index, check] of checks.entries()) {
          const critical = check.status === "存在差异";
          add({
            id: ["ua-platform", "ua-client-hints", "iframe", "worker", "language"][index],
            title: check.name,
            severity:
              check.status === "无法检测"
                ? "unavailable"
                : critical
                  ? index >= 2 || index === 4
                    ? "warning"
                    : "critical"
                  : "normal",
            actual: check.detail,
            expected: critical ? "关键环境字段保持兼容或一致" : undefined,
            explanation: critical
              ? index === 4
                ? "navigator.language 与 languages[0] 不一致，可能影响站点看到的语言环境。"
                : index >= 2
                  ? "主页面与隔离上下文返回了不同的关键字段，请核对浏览器隔离或伪装设置。"
                  : "浏览器公开的平台信息彼此不兼容。"
              : check.status === "无法检测"
                ? "浏览器未提供足够数据，无法形成可靠判断。"
                : "相关环境字段兼容或一致。",
            technical: check,
          });
        }
      } catch (error) {
        [
          ["ua-platform", "UA / Platform"],
          ["ua-client-hints", "UA / Client Hints"],
          ["iframe", "主页面 / iframe"],
          ["worker", "主页面 / Worker"],
          ["language", "Language"],
        ].forEach(([id, title]) => add(unavailable(id, title, error)));
      }
    })();

    const webdriverTask = (async () => {
      const check = automationChecks()[0];
      raw.automation = automationChecks();
      add({
        id: "webdriver",
        title: check.status === "检测到特征" ? "检测到 WebDriver 自动化特征" : "WebDriver",
        severity:
          check.status === "无法检测"
            ? "unavailable"
            : check.status === "检测到特征"
              ? "critical"
              : "normal",
        actual: check.detail,
        expected: "navigator.webdriver 为 false",
        explanation:
          check.status === "检测到特征"
            ? "浏览器明确公开了 WebDriver 自动化状态。"
            : "未发现明确的 WebDriver 自动化特征。",
        technical: check,
      });
    })();

    const deepTask = (async () => {
      try {
        const [deep, fp] = await Promise.all([
          collectDeepDiagnostics(signal),
          fingerprint(),
        ]);
        raw.deepDiagnostics = deep;
        raw.fingerprint = fp;

        const headlessModule = deepModule(deep.modules, "headless");
        const headlessValue = parseDetail(headlessModule?.detail);
        const headlessReport = moduleReport("headless", headlessValue);
        const explicitHeadless = /HeadlessChrome/i.test(navigator.userAgent);
        add({
          id: "headless",
          title: explicitHeadless ? "检测到 HeadlessChrome" : "Headless 特征",
          severity: explicitHeadless
            ? "critical"
            : headlessReport.unavailable
              ? "unavailable"
              : headlessReport.signal
                ? "warning"
                : "normal",
          actual: explicitHeadless ? navigator.userAgent : headlessReport.summary,
          expected: "User-Agent 不含 HeadlessChrome，且无明确接口异常",
          explanation: explicitHeadless
            ? "User-Agent 明确包含 HeadlessChrome。"
            : headlessReport.signal
              ? "这些弱信号普通浏览器设置也可能触发，不能单独证明为自动化浏览器。"
              : "未发现明确的无头浏览器特征。",
          technical: headlessValue,
        });

        const prototype = deepModule(deep.modules, "prototypeLies") ?? deepModule(deep.modules, "lies");
        if (!prototype) add(unavailable("prototype", "Prototype Lies", "未返回原型接口检测模块。"));
        else {
          const value = parseDetail(prototype.detail);
          const report = moduleReport(prototype.name, value);
          add({
            id: "prototype",
            title: "Prototype Lies",
            severity: report.unavailable
              ? "unavailable"
              : report.issues.length >= 5
                ? "critical"
                : report.signal
                  ? "warning"
                  : "normal",
            actual: report.summary,
            expected: "未记录接口原型异常",
            explanation: report.signal
              ? report.issues.length >= 5
                ? "检测到较多接口篡改或原型异常记录，建议检查注入脚本和指纹伪装配置。"
                : "检测到少量接口差异；扩展或隐私设置也可能造成这些记录。"
              : "未发现原型接口异常记录。",
            technical: value,
          });
        }

        add(deepItem(deep.modules, "canvas", "canvas", "Canvas"));
        add(deepItem(deep.modules, "webgl", "webgl", "WebGL / GPU"));
        add(deepItem(deep.modules, "audio", "audio", "Audio"));
        add(deepItem(deep.modules, "fonts", "fonts", "Fonts"));
      } catch (error) {
        [
          ["headless", "Headless 特征"],
          ["prototype", "Prototype Lies"],
          ["canvas", "Canvas"],
          ["webgl", "WebGL / GPU"],
          ["audio", "Audio"],
          ["fonts", "Fonts"],
        ].forEach(([id, title]) => add(unavailable(id, title, error)));
      }
    })();

    const screenTask = Promise.resolve().then(() => {
      const value = `${screen.width} × ${screen.height}；可用 ${screen.availWidth} × ${screen.availHeight}；像素比 ${devicePixelRatio}；色深 ${screen.colorDepth}`;
      add({
        id: "screen",
        title: "Screen",
        severity: "normal",
        actual: value,
        explanation: "已展示浏览器公开的屏幕参数；现有基础检测没有给出明确异常信号，因此不额外推断。",
        technical: {
          width: screen.width,
          height: screen.height,
          availWidth: screen.availWidth,
          availHeight: screen.availHeight,
          devicePixelRatio,
          colorDepth: screen.colorDepth,
        },
      });
    });

    const httpEgress = Promise.all([
      detectHttpFamily(4, signal),
      detectHttpFamily(6, signal),
    ]).then(([ipv4, ipv6]) => ({ ipv4, ipv6 }));

    const webrtcTask = (async () => {
      try {
        const [egress, candidates] = await Promise.all([
          httpEgress,
          collectCandidates(signal),
        ]);
        const assessment = assessEnvWebRtc(candidates, egress);
        const { severity, matches, mismatches, unverified, localExposed } =
          assessment;
        const ips = (rows: typeof candidates) =>
          rows.map((row) => row.ip).join("、");
        add({
          id: "webrtc",
          title: "WebRTC 出口对照",
          severity,
          actual: [
            matches.length > 0 && `一致：${ips(matches)}`,
            mismatches.length > 0 && `公网出口不同：${ips(mismatches)}`,
            unverified.length > 0 && `缺少同协议 HTTP 对照：${ips(unverified)}`,
            localExposed.length > 0 && `可读取的内网地址：${localExposed.join("、")}`,
          ].filter(Boolean).join("；") || "未采集到可对照的公网 WebRTC 地址",
          expected: httpReference(egress),
          explanation: severity === "normal"
            ? "已采集的公网 WebRTC 地址与同协议的 HTTP 出口一致。"
            : severity === "warning"
              ? "请结合 UDP 分流规则核对不同出口及浏览器公开的内网地址。"
              : "浏览器限制、UDP 阻断或缺少同协议 HTTP 出口时，无法确认 WebRTC 路径。",
          technical: { egress, candidates, assessment },
        });
      } catch (error) {
        add(unavailable("webrtc", "WebRTC", error));
      }
    })();

    const dnsTask = (async () => {
      let progress: Awaited<ReturnType<typeof detectDnsExits>> | undefined;
      try {
        const [egress, result] = await Promise.all([
          httpEgress,
          detectDnsExits(signal, (sample) => { progress = sample; }),
        ]);
        const assessment = assessEnvDns(result, egress);
        const { severity, egressCountries, mismatches, unknown, successful, failed } =
          assessment;
        add({
          id: "dns",
          title: "DNS 出口",
          severity,
          actual: [
            `采样成功 ${successful}/${result.count}，失败 ${failed}`,
            ...result.results.map((row) =>
              [row.ip, row.geo || row.country].filter(Boolean).join(" · "),
            ),
          ].join("；"),
          expected: egressCountries.length
            ? `HTTP 出口地区：${egressCountries.join("、")}`
            : "未取得 HTTP 出口地区",
          explanation: [
            mismatches.length > 0
              ? `请核对 ${mismatches.length} 个地区不同的解析器。公共 DNS 和代理分流可能使用不同地区。`
              : severity === "unavailable"
                ? "缺少地区信息，无法对照 DNS 解析器与 HTTP 出口。"
                : "本次可核对的 DNS 解析器与 HTTP 出口地区一致。",
            unknown > 0 && `${unknown} 个解析器的地区无法核对。`,
            failed > 0 && "部分探测失败，结果只覆盖成功的采样。",
          ].filter(Boolean).join(" "),
          technical: { egress, ...result, assessment },
        });
      } catch (error) {
        add({
          ...unavailable("dns", "DNS 出口", error),
          actual: progress?.count
            ? `采样成功 ${progress.count - progress.failed}/${progress.count}，失败 ${progress.failed}`
            : "未取得检测结果",
          technical: progress,
        });
      }
    })();

    const ipv6Task = (async () => {
      try {
        const egress = await httpEgress;
        const { ipv4, ipv6 } = egress;
        add({
          id: "ipv6",
          title: "HTTP IPv4／IPv6 出口",
          severity: ipv6 ? "normal" : "unavailable",
          actual: httpReference(egress),
          explanation: ipv6
            ? ipv4
              ? "已分别采集双栈 HTTP 出口，可用于 DNS 和 WebRTC 对照。"
              : "已采集 IPv6 HTTP 出口，IPv4 暂无可读取结果。"
            : "当前网络未返回可读取的 IPv6 地址。仅使用 IPv4 的网络也可能出现此结果。",
          technical: egress,
        });
      } catch (error) {
        add({
          ...unavailable("ipv6", "IPv6", error),
          actual: "未检测到 IPv6",
          explanation: "当前网络未返回可读取的 IPv6；没有 IPv6 不属于异常。",
        });
      }
    })();

    const ipTask = (async () => {
      try {
        const me = await currentIp(signal);
        const lookup = await lookupIpWithFallback(me.ip, signal).catch((error) => {
          signal.throwIfAborted();
          return error instanceof Error ? error : new Error("IP 查询暂不可用。");
        });
        const geo = lookup instanceof Error ? me : lookup.geo;
        const browserTimezone = environment.timezone;
        const ipTimezone = geo.timezone ?? me.timezone;
        const timezoneMismatch =
          Boolean(ipTimezone && browserTimezone && ipTimezone !== browserTimezone);
        add({
          id: "timezone",
          title: timezoneMismatch
            ? "浏览器时区与当前 IP 地理环境不一致"
            : "浏览器时区",
          severity:
            !ipTimezone || !browserTimezone
              ? "unavailable"
              : timezoneMismatch
                ? "warning"
                : "normal",
          actual: `浏览器：${browserTimezone}`,
          expected: ipTimezone
            ? `IP 地区：${[geo.country, geo.region, geo.city].filter(Boolean).join(" · ") || "未知"}；参考时区：${ipTimezone}`
            : undefined,
          explanation:
            timezoneMismatch
              ? "浏览器时区与 IP 所在地区不一致。建议检查浏览器的“跟随代理/IP 时区”设置。"
              : ipTimezone && browserTimezone
                ? "浏览器时区与数据源提供的 IP 时区一致。"
                : "浏览器或 IP 时区数据不完整，无法对照。",
          technical: { browserTimezone, geo, ipTimezone },
        });

        if (lookup instanceof Error || !lookup.risk.available) {
          add({
            id: "ip-risk",
            title: "IP 风险与网络信誉",
            severity: "unavailable",
            actual: [
              me.ip,
              [geo.country, geo.region, geo.city].filter(Boolean).join(" · "),
              geo.isp ?? me.isp,
              geo.asn ? `AS${String(geo.asn).replace(/^AS/i, "")}` : "",
            ].filter(Boolean).join(" · "),
            explanation: "当前仅显示可读取的基础归属信息，信誉评分与风险标记暂不可用。",
            technical: lookup instanceof Error ? { geo, error: lookup.message } : lookup,
          });
          return;
        }

        const coffee = lookup.coffee;
        const score = coffee.trust_score;
        const validScore =
          typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 100;
        const flags = [
          coffee.is_vpn ? "VPN" : "",
          coffee.is_proxy ? "代理" : "",
          coffee.is_tor ? "Tor" : "",
          coffee.is_crawler ? "爬虫" : "",
          coffee.is_abuser ? "滥用" : "",
        ].filter(Boolean);
        const networkType = coffee.isResidential
          ? "Residential"
          : coffee.is_datacenter
            ? "Datacenter"
            : coffee.company_type || "未知";
        const reputationNotice =
          flags.length > 0 ||
          coffee.is_datacenter === true ||
          coffee.company_type === "hosting" ||
          (validScore && score < 75);
        add({
          id: "ip-risk",
          title: "IP 风险与网络信誉",
          severity: reputationNotice ? "warning" : validScore ? "normal" : "unavailable",
          actual: [
            me.ip,
            validScore ? `信誉分 ${score}/100` : "信誉分未知",
            networkType,
            coffee.isp,
            coffee.asn ? `AS${coffee.asn}` : "",
            flags.length ? `标记：${flags.join("、")}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
          explanation: reputationNotice
            ? "这是第三方数据库提供的网络信誉提示。Hosting、Datacenter 或代理分类不等同于浏览器泄露，也不代表任何平台的官方风控结论。"
            : validScore
              ? "当前取得的评分和风险标记未达到提示阈值。"
              : "数据源未返回可用的信誉评分。",
          technical: lookup,
        });
      } catch (error) {
        add(unavailable("timezone", "浏览器时区", error));
        add(unavailable("ip-risk", "IP 风险与网络信誉", error));
      }
    })();

    await Promise.allSettled([
      consistencyTask,
      webdriverTask,
      deepTask,
      screenTask,
      webrtcTask,
      dnsTask,
      ipv6Task,
      ipTask,
    ]);
    if (!signal.aborted) {
      raw.completedAt = new Date().toISOString();
      setItems((current) =>
        current.map((item) => ({
          ...item,
          technical: item.technical ?? raw[item.id],
        })),
      );
      setRunning(false);
    }
  }, [round]);

  useEffect(() => {
    void run();
    return () => abortRef.current?.abort();
  }, [run]);

  const counts = {
    critical: items.filter((item) => item.severity === "critical").length,
    warning: items.filter((item) => item.severity === "warning").length,
    normal: items.filter((item) => item.severity === "normal").length,
    unavailable: items.filter((item) => item.severity === "unavailable").length,
  };
  const problems = items.filter((item) =>
    ["critical", "warning"].includes(item.severity),
  );
  const normalItems = items.filter((item) => item.severity === "normal");
  const unavailableItems = items.filter((item) => item.severity === "unavailable");

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-8">
      <PageHeading title="环境检测报告" description="" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">环境检测报告</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {running ? `环境检测中…… ${items.length} / ${TOTAL_CHECKS}` : "环境检测完成"}
          </p>
        </div>
        <Button disabled={running} onClick={() => setRound((value) => value + 1)}>
          {running ? "检测中…" : "重新检测"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {running
              ? "正在检查浏览器与网络环境"
              : counts.critical
                ? "存在需要处理的问题"
                : counts.warning
                  ? "存在需要核对的项目"
                  : "未发现明确环境不一致"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["critical", counts.critical],
                ["warning", counts.warning],
                ["normal", counts.normal],
                ["unavailable", counts.unavailable],
              ] as const
            ).map(([severity, count]) => {
              const meta = severityMeta[severity];
              return (
                <div key={severity} className={`rounded-lg p-3 ring-1 ${meta.bg}`}>
                  <div className={`text-xs ${meta.color}`}>{meta.label}</div>
                  <div className="mt-1 text-2xl font-semibold">{count}</div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <AiTroubleshooting />

      {!running && problems.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">发现的问题</h2>
          {problems.map((item) => (
            <ResultCard key={item.id} item={item} />
          ))}
        </section>
      )}

      {!running && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">正常项目</h2>
          <Card>
            <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {normalItems.map((item) => (
                <div key={item.id} className="flex items-start gap-2 rounded-md bg-emerald-500/8 px-3 py-2">
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <div className="min-w-0">
                    <span>{item.title}</span>
                    {networkDetails.has(item.id) && (
                      <p className="mt-1 text-xs break-words text-muted-foreground">{item.actual}</p>
                    )}
                  </div>
                </div>
              ))}
              {!normalItems.length && <span className="text-muted-foreground">暂无</span>}
            </CardContent>
          </Card>
        </section>
      )}

      {!running && unavailableItems.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">无法检测</h2>
          {unavailableItems.map((item) => (
            <ResultCard key={item.id} item={item} />
          ))}
        </section>
      )}

      {!running && (
        <Card>
          <CardContent>
            <Accordion type="single" collapsible>
              <AccordionItem value="technical">
                <AccordionTrigger>查看技术详情</AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-4 pt-2">
                    {items.map((item) => (
                      <div key={item.id}>
                        <h3 className="mb-1 font-medium">{fieldLabel(item.title)}</h3>
                        <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap break-all">
                          {JSON.stringify(item.technical ?? item.actual, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      )}

      <p className="text-sm leading-6 text-muted-foreground">
        检测结果用于发现浏览器和网络环境中的可观察不一致，不代表任何第三方网站的官方风控、账号风险或封禁判断。
      </p>
    </div>
  );
}
