import { useState } from "react";
import { Link } from "react-router-dom";
import { Facts, IpText, Pending } from "@/components/toolkit";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent } from "@/components/ui/card";
import { trace } from "@/lib/network";
import { aiPlatforms, type AiPlatform } from "@/views/ai/platforms";
import { probeAiDomain } from "@/views/ai/probe";
import { getStatus } from "@/views/status/api";
import { useQuery } from "@tanstack/react-query";

const platforms = aiPlatforms.filter(
  ({ id }) => id === "claude" || id === "gpt",
);

async function probeWebExit(domain: string, signal: AbortSignal) {
  const start = performance.now();
  try {
    const result = await trace(domain, signal);
    return { ip: result.ip, elapsed: Math.round(performance.now() - start) };
  } catch {
    signal.throwIfAborted();
    return null;
  }
}

function PlatformResult({ platform }: { platform: AiPlatform }) {
  const webDomain = platform.traceDomain ?? platform.domain;
  const apiDomain = new URL(platform.apiUrl).hostname;
  const network = useQuery({
    queryKey: ["env-ai-browser", platform.id],
    queryFn: async ({ signal }) => {
      const [web, api] = await Promise.all([
        probeWebExit(webDomain, signal),
        probeAiDomain(apiDomain, signal),
      ]);
      return { web, api };
    },
    retry: false,
    gcTime: 0,
  });
  const status = useQuery({
    queryKey: ["service-status", platform.statusId],
    queryFn: ({ signal }) => getStatus(platform.statusId, signal),
    retry: false,
    staleTime: 60_000,
  });
  const { web, api } = network.data ?? {};
  const pending = <Pending />;
  const label = platform.id === "gpt" ? "ChatGPT · Codex" : platform.name;
  const statusPage =
    platform.id === "gpt" ? "/status/openai" : "/status/claude";
  const officialStatus = status.isError
    ? null
    : status.data?.status?.description;

  return (
    <section className="min-w-0 rounded-lg border p-3">
      <h3 className="mb-2 font-semibold">{label}</h3>
      <Facts
        rows={[
          [
            webDomain,
            network.isPending
              ? pending
              : web
                ? `边缘响应 · ${web.elapsed} ms`
                : "无法确认边缘响应",
          ],
          [
            "网页出口 IP",
            network.isPending ? (
              pending
            ) : web ? (
              <IpText ip={web.ip} />
            ) : (
              "未取得出口"
            ),
          ],
          [
            apiDomain,
            network.isPending
              ? pending
              : api?.median != null
                ? `资源响应 · ${api.median} ms`
                : "无法确认资源响应",
          ],
          [
            "官方服务状态",
            status.isPending ? pending : officialStatus || "无法读取官方状态",
          ],
        ]}
      />
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
        <Link to={`/ai/${platform.id}`}>专项检测</Link>
        <Link to={statusPage}>官方状态详情</Link>
      </div>
    </section>
  );
}

export function AiTroubleshooting() {
  const [open, setOpen] = useState("");
  return (
    <Card>
      <CardContent>
        <Accordion
          type="single"
          collapsible
          value={open}
          onValueChange={setOpen}
        >
          <AccordionItem value="ai">
            <AccordionTrigger>Claude / ChatGPT · Codex 排障</AccordionTrigger>
            <AccordionContent>
              {open === "ai" && (
                <>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {platforms.map((platform) => (
                      <PlatformResult key={platform.id} platform={platform} />
                    ))}
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    网页出口由当前浏览器的边缘探测返回。API 域名只请求
                    favicon.ico，浏览器无法读取跨域 HTTP
                    状态码。超时、跨域限制或内容拦截时显示无法确认。登录、模型权限和独立客户端的网络需另行验证。
                  </p>
                </>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}
