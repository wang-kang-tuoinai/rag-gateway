package router

import (
	"rag-bot-client/handler"

	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin"
)

func SetupRouter(h *handler.RAGHandler) *gin.Engine {
	r := gin.Default()
	r.Use(otelgin.Middleware("rag-bot"))
	api := r.Group("/api/v1")
	{
		api.GET("/history", h.ListHistory)
		api.POST("/ask", h.Ask)
		api.POST("/conversations/:conversation_id/ask", h.Ask)
	}
	return r
}
