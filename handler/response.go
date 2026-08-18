package handler

import (
	"errors"
	"log"
	"net/http"
	"rag-bot-client/client"

	"github.com/gin-gonic/gin"
)

type ErrorResponse struct {
	Error string `json:"error"`
}

func HandleError(c *gin.Context, err error) {
	var httpErr *client.HTTPError
	if errors.As(err, &httpErr) && httpErr.StatusCode == http.StatusNotFound {
		// 上游返回 404：会话不存在，属于前端传错参数
		log.Println("not found: ", err)
		c.JSON(http.StatusNotFound, ErrorResponse{Error: httpErr.Message})
		return
	}
	log.Println("internal error: ", err)
	c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "服务器内部错误"})
}

func BadRequest(c *gin.Context, err error) {
	c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
}
