package handler

import (
	"errors"
	"log"
	"net/http"
	"rag-bot-client/client"
	"rag-bot-client/model"
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
		if v, err := strconv.ParseInt(cursorStr, 10, 64); err == nil && v > 0 {
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

func (h *RAGHandler) Ask(c *gin.Context) {
	ctx := c.Request.Context()
	conversationID := c.Param("conversation_id") // /ask 时为空，/conversations/:id/ask 时非空

	var req model.RAGQueryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err)
		return
	}
	if req.Question == "" {
		BadRequest(c, errors.New("question 不能为空"))
		return
	}

	resp, err := h.rag_client.Ask(ctx, req.Question, conversationID)
	if err != nil {
		HandleError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

