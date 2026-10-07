# 运维诊断网关

托管 `static/` 页面，并使用 Go 标准库 `httputil.ReverseProxy` 将会话 API 转发给诊断后端。

| 路径 | 行为 |
| --- | --- |
| `/`、`/static/*` | 提供前端资源 |
| `/api/v1/conversations` 及其子路径 | 转发到 ops-diagnosis-agent，保留方法、路径、有效查询参数和请求体 |
| `GET /api/v1/visual/services`、`GET /api/v1/visual/traces`、`GET /api/v1/visual/logs` | 转发到 obs-api，服务目录、入口摘要与日志时间桶 |
| 其他 `/api/*` | 返回 404 JSON，不回退到 HTML |

不在网关定义会话响应模型，也不解析、聚合或重写 SSE 事件。
后端的 201、409、422、503 等状态、响应正文与 `X-Run-ID` 都直接转发。
连接上游失败时由网关返回 502 JSON；已经开始的流发生读错误时中止连接，
不追加 JSON 或虚假的 done，前端需查询该 run 的最终状态。

## 启动配置

本地运行（在本目录）：

```powershell
$env:AGENT_SERVICE_URL='http://localhost:8001'
go run .
```

- `AGENT_SERVICE_URL`：默认 `http://localhost:8001`；只接受 http(s) origin，不带 API 路径、凭据或查询参数。
- `PORT`：默认 `8081`。
- `OTEL_EXPORTER_OTLP_ENDPOINT`：沿用现有 OpenTelemetry 配置。

根目录 Compose 已配置 `AGENT_SERVICE_URL=http://ops-diagnosis-agent:8001`，
并等待 Agent 健康后启动网关。运行 `docker compose up -d --build rag-gateway` 可构建并启动。
旧的 `RAG_SERVICE_URL` 已移除。

代理使用请求上下文向上游传播浏览器断连，支持 SSE 立即刷新；
设置了连接及响应头阶段的超时，没有沿用旧 HTTP 客户端的 30 秒响应总超时。
现有 Gin 与 OpenTelemetry 中间件保留，出站请求仍使用 otelhttp Transport。

## 诊断页面

浏览器访问 `http://localhost:8081`。页面使用原生 JavaScript 模块，不需要前端构建步骤。
模型密钥仅存在于 Agent 服务端，前端通过网关的同源 API 发起请求。

- 点击新建诊断会打开空白草稿，首次发送时创建会话，服务端生成 UUID；首条问题作为简短标题。
- 左侧加载会话列表，首次进入会话读取最近 20 轮；顶部“加载更早的对话”用 `before` 向前翻页，保持页内从旧到新。
- SSE 分别展示思考、正文、工具开始和结束，工具按调用 ID 配对，参数与结果可展开。
- 知识引用由工具的 `artifact.ref_to_item` 关联原始条目，正文中的 `[K-…]` 和底部来源按钮可以打开知识内容。
- 停止生成调用后端取消接口；切换会话保留本页现有连接，刷新或关闭页面则会断连取消。
- 未收到 done 就断流时查询单轮状态，查询失败可手动刷新；执行仍在进行中时可再次刷新或停止。
- 提交结果不明时“重试本次提交”复用同一个 request_id。收到 409 后读取已有执行，不重复启动诊断。
- 历史回看与实时事件使用相同的渲染模型。快照恢复替换整轮状态，避免文本重复追加。
- 页面仅在用户靠近底部时跟随输出，向上阅读后可点击“回到最新”。

旧 `/api/v1/ask`、`/api/v1/history` 不再使用。接口文档见 `../ops-diagnosis-agent/README.md`。
浏览器只保存最近打开的会话 ID；未提交草稿和待确认提交信息仅保留在当前页面内存中。

前端文件职责：

| 文件 | 职责 |
| --- | --- |
| `static/app.js` | 会话状态、分页、发送、取消和异常恢复 |
| `static/api.mjs` | HTTP 请求与错误解析 |
| `static/core.mjs` | SSE 分帧、增量聚合、工具配对和历史恢复 |
| `static/render.mjs` | 局部 DOM 更新、Markdown 净化和引用弹窗 |
| `static/vendor/` | 固定版本的 marked、DOMPurify 及许可证，本地加载 |

## 验证

```powershell
go test ./...
node --test tests/frontend.test.mjs
```

测试使用本地模拟上游，不调用模型，覆盖 API 透传、SSE 未结束时的即时输出、
下游取消向上游传播、流中断、502 错误和静态资源路由。
前端测试覆盖中文拆包、CRLF 和多行 SSE、半条事件、工具并发配对、合并历史和链接协议。

无需真实模型与数据库的浏览器验收：

```powershell
node tests/preview-server.mjs
```

打开 `http://127.0.0.1:8765`，该服务只有内存模拟数据，不参与 Docker 部署。
可验证 23 轮历史分页、流式输出、引用、停止、刷新和切换会话。
问题包含 `[响应丢失]`、`[断流]`、`[XSS]` 时可触发对应验收场景。
该预览服务不代表已完成真实模型联调。
## 日志与 Trace 观测面板

顶栏「观测面板」支持服务/接口筛选、实时最近 15 分钟、最多 15 分钟的固定历史窗口、耗时散点与每 10 秒日志级别堆叠柱状图。任意图上拖动，双图同步框选并更新诊断草稿，保留已有问题，不自动发送。HTTP operation 同步映射为日志 method/route；日志图例可切换级别显示。两图独立显示加载、错误、过期和更新时间。瀑布图及日志模板详情弹窗暂未实现。

`OBS_SERVICE_URL` 本地默认 `http://localhost:8082`，Compose 配置为 `http://obs-api:8081`。网关仅代理三个观测 GET 路径，会话 SSE 代理不变。完整接口及缓存约束见 [traces-visual.md](../obs-api/docs/traces-visual.md) 和 [logs-visual.md](../obs-api/docs/logs-visual.md)。日志表新增 service-ts 索引需要重建负责 AutoMigrate 的 app 服务，并确认实际数据库迁移成功。

验证：`go test -race ./...` 和 `node --test tests/frontend.test.mjs tests/trace-panel.test.mjs`。运行 `node tests/preview-server.mjs` 可查看含 4500 个合成点的预览（无真实 Jaeger、模型调用或数据库写入）。
