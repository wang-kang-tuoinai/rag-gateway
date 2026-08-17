package handler

import (
	"log"
	"net/http"
	"rag-bot-client/client"
	"strconv"

	"github.com/gin-gonic/gin"
)

type RAGHandler struct {
	rag_client *client.RAGClient
}

func NewRAGHandler(rag_client *client.RAGClient) *RAGHandler {
	return &RAGHandler{
		rag_client: rag_client,
	}
}

func (h *RAGHandler) ListHistory(c *gin.Context) {
	ctx := c.Request.Context()
	limitStr := c.Query("limit")
	cursorStr := c.Query("cursor")

	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit < 1 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	var cursor *int64
	if cursorStr != "" {
		if v, err := strconv.ParseInt(cursorStr, 10, 64); err == nil {
			cursor = &v
		}
	}
	log.Println("ListHistory: ", "limit: ", limit, "cursor ", cursor)
	resp, err := h.rag_client.ListHistory(ctx, limit, cursor)
	if err != nil {
		HandleError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}
