package router

import (
	"rag-bot-client/handler"

	"github.com/gin-gonic/gin"
)

func SetupRouter(h *handler.RAGHandler) *gin.Engine {
	r := gin.Default()
	api := r.Group("/api/v1")
	{
		api.GET("/history", h.ListHistory)
		api.POST("/ask", h.Ask)
		api.POST("/conversations/:conversation_id/ask", h.Ask)
	}
	return r
}
