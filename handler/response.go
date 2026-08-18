package handler

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

type ErrorResponse struct {
	Error string `json:"error"`
}

func HandleError(c *gin.Context, err error) {
	switch {
	default:
		log.Println("internal error: ", err)
		c.JSON(http.StatusInternalServerError, "服务器内部错误")
	}
}

func BadRequest(c *gin.Context, err error) {
	c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
}
