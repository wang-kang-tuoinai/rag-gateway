package router

import (
	"log"
	"mime"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin"
)

func SetupRouter(agentProxy http.Handler) *gin.Engine {
	// Windows 的系统 MIME 表不一定包含 .mjs；ES 模块要求 JavaScript MIME。
	_ = mime.AddExtensionType(".mjs", "text/javascript; charset=utf-8")
	r := gin.New()
	r.Use(gin.Logger(), recoverRequests)
	r.Use(otelgin.Middleware("rag-bot"))

	// 托管前端静态文件（对 JS/CSS 禁用强缓存，确保容器重建后浏览器拿到最新版本）
	r.Use(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/static/") {
			c.Header("Cache-Control", "no-cache, must-revalidate")
		}
		c.Next()
	})
	r.Static("/static", "./static")
	r.StaticFile("/", "./static/index.html")

	// 会话 API 保留原始方法、路径、请求体与后端状态码，参数校验由 Agent 负责。
	r.Any("/api/v1/conversations", gin.WrapH(agentProxy))
	r.Any("/api/v1/conversations/*path", gin.WrapH(agentProxy))

	// 兜底策略：处理前端 SPA 路由
	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path

		// API 路径 404 返回 JSON，避免返回 HTML
		if strings.HasPrefix(path, "/api") {
			c.JSON(http.StatusNotFound, gin.H{"error": "API not found"})
			return
		}

		// 静态资源路径 404 也应该返回 404，避免 JS 文件请求得到 HTML
		if strings.HasPrefix(path, "/static") {
			c.JSON(http.StatusNotFound, gin.H{"error": "static file not found"})
			return
		}

		// 其余所有路径都返回 index.html，交给前端路由
		c.File("./static/index.html")
	})
	return r
}

func recoverRequests(c *gin.Context) {
	defer func() {
		if recovered := recover(); recovered != nil {
			// Gin 的默认 Recovery 会吞掉此信号；这里让 net/http 真正中止连接。
			if recovered == http.ErrAbortHandler {
				panic(recovered)
			}
			log.Printf("网关请求处理异常: %v", recovered)
			if c.Writer.Written() {
				panic(http.ErrAbortHandler)
			}
			c.AbortWithStatus(http.StatusInternalServerError)
		}
	}()
	c.Next()
}
