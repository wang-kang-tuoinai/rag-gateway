// Package proxy forwards diagnosis API responses, including SSE, without decoding them.
package proxy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

func NewAgentProxy(baseURL string) (*httputil.ReverseProxy, error) {
	target, err := url.Parse(baseURL)
	if err != nil || target.Hostname() == "" || (target.Scheme != "http" && target.Scheme != "https") ||
		target.User != nil || target.RawQuery != "" || target.ForceQuery || target.Fragment != "" ||
		(target.Path != "" && target.Path != "/") {
		return nil, fmt.Errorf("AGENT_SERVICE_URL 必须是 http(s) 服务地址，不包含路径、凭据、查询参数或片段")
	}
	target.Path = ""
	transport := http.DefaultTransport.(*http.Transport).Clone()
	// 只限制等待响应头的时间；不能给整个 SSE 响应设置 30 秒总超时。
	transport.ResponseHeaderTimeout = 30 * time.Second
	return &httputil.ReverseProxy{
		Rewrite: func(req *httputil.ProxyRequest) {
			req.SetURL(target)
			req.SetXForwarded()
		},
		Transport:     otelhttp.NewTransport(transport),
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			if r.Context().Err() != nil || errors.Is(err, context.Canceled) {
				return
			}
			log.Printf("诊断服务代理失败: %v", err)
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusBadGateway)
			_ = json.NewEncoder(w).Encode(map[string]string{"detail": "无法连接诊断服务，请稍后重试"})
		},
	}, nil
}
