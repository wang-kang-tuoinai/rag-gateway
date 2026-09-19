# 运维诊断网关

托管 `static/` 页面，并使用 Go 标准库 `httputil.ReverseProxy` 将会话 API 转发给诊断后端。

| 路径 | 行为 |
| --- | --- |
| `/`、`/static/*` | 提供前端资源 |
| `/api/v1/conversations` 及其子路径 | 转发到 ops-diagnosis-agent，保留方法、路径、有效查询参数和请求体 |
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

## 前端迁移状态

本次只完成代理层。`static/` 仍为旧知识问答页面，尚未适配新的会话、历史与 SSE 协议，
因此页面可以打开，但旧的发送和历史功能暂不可用。
旧 `/api/v1/ask`、`/api/v1/history` 不再提供；前端下一步直接使用诊断后端的接口路径。
该接口文档见 `../ops-diagnosis-agent/README.md`。

## 验证

```powershell
go test ./...
```

测试使用本地模拟上游，不调用模型，覆盖 API 透传、SSE 未结束时的即时输出、
下游取消向上游传播、流中断、502 错误和静态资源路由。
