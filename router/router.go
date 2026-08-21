package router

import (
	"net/http"
	"rag-bot-client/handler"
	"strings"

	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin"
)

func SetupRouter(h *handler.RAGHandler) *gin.Engine {
	r := gin.Default()
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

	api := r.Group("/api/v1")
	{
		api.GET("/history", h.ListHistory)
		api.POST("/ask", h.Ask)
		api.POST("/conversations/:conversation_id/ask", h.Ask)
		api.GET("/conversations/:conversation_id/messages", h.ListMessages)
	}

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
