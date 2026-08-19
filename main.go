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

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	"go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.30.0"
)

func main() {
	//初始化Tracer
	tp, err := initTracer()
	if err != nil {
		log.Fatal("初始化Tracer失败:", err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := tp.Shutdown(ctx); err != nil {
			log.Println("关闭Trace超时或失败:", err)
		}
	}()
	ragServiceURL := getEnv("RAG_SERVICE_URL", "http://localhost:8000")
	ragClient := client.NewRAGClient(ragServiceURL)
	ragHandler := handler.NewRAGHandler(ragClient)
	r := router.SetupRouter(ragHandler)
	port := getEnv("PORT", "8081")
	srv := &http.Server{
		Addr:    ":" + port,
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

func initTracer() (*trace.TracerProvider, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	//创建OTLP HTTP Exporter
	exporter, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, err
	}

	//定义当前服务的资源属性
	res, err := resource.New(ctx, resource.WithAttributes(
		semconv.ServiceName("rag-bot"),
	))
	if err != nil {
		return nil, err
	}
	tp := trace.NewTracerProvider(
		trace.WithBatcher(exporter),
		trace.WithResource(res),
	)
	otel.SetTracerProvider(tp)
	// 设置全局propagator，靠他往header里写trace信息
	otel.SetTextMapPropagator(
		propagation.NewCompositeTextMapPropagator(
			propagation.TraceContext{},
			propagation.Baggage{},
		),
	)
	return tp, nil
}
