自定义功能：
- /env 自动环境体检页
- 顶部“环境体检”导航入口
- `/ai/claude` 和 `/ai/gpt` 共用的 IP 风险面板，包含三路出口、IP 信誉和安全标记、地区清单、DNS、WebRTC、服务状态、设备指纹与本地历史

涉及文件：
- src/App.tsx
- src/views/env/index.tsx
- src/layout/routes.ts
- src/layout/index.tsx
- `src/views/components/ai-diagnostics/` 和 `src/views/ai/network-check.tsx`

说明：
本项目 Fork 自 zhihui-hu/one-ip。
后续可继续同步 upstream；如发生冲突，优先保留上述自定义功能。

平台支持地区集中在 `src/views/components/ai-diagnostics/supported-regions.ts`。按文件内的官方来源核对并更新地区代码及核对日期。面板按实际平台网页出口 IP 查询信誉，并复用 One IP 的 IP 查询降级和网络证据判读。升级时验证两个专项页的同一套组件，覆盖出口缺失、信誉数据不可用和隐藏 IP。
