package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"rag-bot-client/client"
	"rag-bot-client/handler"
	"rag-bot-client/router"
	"syscall"
	"time"
)

func main() {
	ragServiceURL := getEnv("RAG_SERVICE_URL", "http://localhost:8000")
	ragClient := client.NewRAGClient(ragServiceURL)
	ragHandler := handler.NewRAGHandler(ragClient)
	r := router.SetupRouter(ragHandler)
	srv := &http.Server{
		Addr:    ":8080",
		Handler: r,
	}
	srvErr := make(chan error, 1)
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			srvErr <- err
		}
	}()
	log.Println("启动成功!")
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	select {
	case sig := <-quit:
		log.Printf("收到信号 %v,开始优雅退出", sig)
	case err := <-srvErr:
		log.Println("HTTP 服务异常:", err)
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Println("关闭HTTP服务失败:", err)
	}
}

func getEnv(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}
