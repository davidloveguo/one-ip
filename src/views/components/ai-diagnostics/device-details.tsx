import { Facts, Pending, ToolCard } from "@/components/toolkit";
import { t } from "@/i18n";
import { platformFamily } from "@/views/browser/consistency";
import {
  environmentSnapshot,
  type BrowserNavigator,
} from "@/views/browser/environment";
import { useQuery } from "@tanstack/react-query";

const browserMarkers: [RegExp, string][] = [
  [/\bEdg(?:A|iOS)?\/([\d.]+)/, "Microsoft Edge"],
  [/\b(?:OPR|OPiOS)\/([\d.]+)/, "Opera"],
  [/\bSamsungBrowser\/([\d.]+)/, "Samsung Internet"],
  [/\b(?:Firefox|FxiOS)\/([\d.]+)/, "Firefox"],
  [/\b(?:Chrome|CriOS)\/([\d.]+)/, "Chrome"],
  [/\bVersion\/([\d.]+).*\bSafari\//, "Safari"],
];

function browserName(nav: BrowserNavigator) {
  const brand = nav.userAgentData?.brands.find(({ brand }) =>
    /^(?:Google Chrome|Microsoft Edge|Brave|Opera|Vivaldi|Samsung Internet)$/.test(
      brand,
    ),
  );
  if (brand) return [brand.brand, brand.version].filter(Boolean).join(" ");
  const marker = browserMarkers.find(([pattern]) =>
    pattern.test(nav.userAgent),
  );
  return marker && `${marker[1]} ${nav.userAgent.match(marker[0])?.[1]}`;
}

function languageRegion(language?: string) {
  if (!language) return undefined;
  try {
    return new Intl.Locale(language).region;
  } catch {
    return undefined;
  }
}

function normalizedTimezone(timeZone?: string) {
  if (!timeZone) return undefined;
  try {
    return Intl.DateTimeFormat("en", { timeZone }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

async function collectGraphics() {
  const { hashComponents, loadSources, sources } =
    await import("@fingerprintjs/fingerprintjs");
  // Collect the two graphics signals without starting the full browser scan.
  const { canvas, webGlBasics, webGlExtensions } = await loadSources(
    {
      canvas: sources.canvas,
      webGlBasics: sources.webGlBasics,
      webGlExtensions: sources.webGlExtensions,
    },
    { cache: {} },
    [],
  )();

  const hasCanvas =
    "value" in canvas && canvas.value.geometry.startsWith("data:image/");
  const gl =
    "value" in webGlBasics && typeof webGlBasics.value === "object"
      ? webGlBasics.value
      : undefined;
  return {
    canvas: hasCanvas ? hashComponents({ canvas }) : undefined,
    webgl: gl
      ? hashComponents({
          webGlBasics,
          ...("value" in webGlExtensions &&
          typeof webGlExtensions.value === "object"
            ? { webGlExtensions }
            : {}),
        })
      : undefined,
    renderer: gl?.rendererUnmasked || gl?.renderer,
  };
}

export function AiDeviceDetails({
  exitTimezone,
  exitCountry,
}: {
  exitTimezone?: string;
  exitCountry?: string;
}) {
  const nav = navigator as BrowserNavigator & {
    connection?: { type?: string; effectiveType?: string };
  };
  const { userAgent, platform, timezone, language, languages } =
    environmentSnapshot();
  const os =
    platformFamily(nav.userAgentData?.platform ?? "") ??
    platformFamily(userAgent) ??
    platformFamily(platform) ??
    (nav.userAgentData?.platform || platform || undefined);
  const browserTimezone = normalizedTimezone(timezone);
  const platformTimezone = normalizedTimezone(exitTimezone);
  const localeRegion = languageRegion(language);
  const platformRegion =
    /^[A-Z]{2}$/i.test(exitCountry ?? "") && exitCountry?.toUpperCase() !== "XX"
      ? exitCountry?.toUpperCase()
      : undefined;
  const connection = nav.connection;
  const connectionType =
    connection?.type && connection.type !== "unknown"
      ? connection.type
      : connection?.effectiveType &&
        t("{0}（网络质量档位）", [connection.effectiveType]);
  const doNotTrack =
    nav.doNotTrack === "1" || nav.doNotTrack === "yes"
      ? t("已启用")
      : nav.doNotTrack === "0" || nav.doNotTrack === "no"
        ? t("未启用")
        : undefined;

  const graphics = useQuery({
    queryKey: ["ai-device-graphics"],
    queryFn: collectGraphics,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const graphicValue = (value?: string) =>
    graphics.isPending ? <Pending /> : value;

  return (
    <ToolCard title={t("设备与指纹")}>
      <Facts
        rows={[
          [t("操作系统"), os],
          [t("浏览器"), browserName(nav)],
          [t("语言"), languages.join(" · ") || language || undefined],
          [
            t("语言地区对照"),
            localeRegion && platformRegion
              ? `${localeRegion} / ${platformRegion} · ${t(localeRegion === platformRegion ? "一致" : "存在差异")}`
              : t("无法对照"),
          ],
          [t("时区"), browserTimezone],
          [t("平台出口时区"), platformTimezone],
          [
            t("时区名称对照"),
            browserTimezone && platformTimezone
              ? browserTimezone === platformTimezone
                ? t("一致")
                : t("存在差异")
              : t("无法对照"),
          ],
          [t("触控点"), nav.maxTouchPoints],
          [t("网络类型"), connectionType],
          [
            "Cookie",
            typeof nav.cookieEnabled === "boolean"
              ? nav.cookieEnabled
                ? t("已启用")
                : t("未启用")
              : undefined,
          ],
          ["Do Not Track", doNotTrack],
          [t("WebGL 渲染器"), graphicValue(graphics.data?.renderer)],
          [t("Canvas 指纹"), graphicValue(graphics.data?.canvas)],
          [t("WebGL 指纹"), graphicValue(graphics.data?.webgl)],
        ]}
      />
    </ToolCard>
  );
}
