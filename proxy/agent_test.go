package proxy_test

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"rag-bot-client/proxy"
	"rag-bot-client/router"
)

func gateway(t *testing.T, upstream string) *httptest.Server {
	t.Helper()
	gin.SetMode(gin.TestMode)
	gin.DefaultWriter = io.Discard
	gin.DefaultErrorWriter = io.Discard
	p, err := proxy.NewAgentProxy(upstream)
	if err != nil {
		t.Fatal(err)
	}
	s := httptest.NewServer(router.SetupRouter(p))
	t.Cleanup(s.Close)
	return s
}

func TestProxyPreservesAPIContract(t *testing.T) {
	for _, status := range []int{201, 404, 409, 422, 503} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				body, _ := io.ReadAll(r.Body)
				if r.Method != "POST" || r.URL.RequestURI() != "/api/v1/conversations/c/messages?limit=2&before=42" ||
					string(body) != `{"question":"Redis 超时","request_id":"request-1"}` {
					t.Errorf("request changed: %s %s %s", r.Method, r.URL.RequestURI(), body)
				}
				if r.Header.Get("X-Forwarded-Host") == "" || strings.Contains(r.Header.Get("X-Forwarded-For"), "forged") {
					t.Error("unexpected forwarding headers")
				}
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("X-Run-ID", "run-1")
				w.WriteHeader(status)
				_, _ = io.WriteString(w, `{"detail":"原始响应","run_id":"run-1"}`)
			}))
			defer upstream.Close()
			gw := gateway(t, upstream.URL)
			req, _ := http.NewRequest("POST", gw.URL+"/api/v1/conversations/c/messages?limit=2&before=42",
				strings.NewReader(`{"question":"Redis 超时","request_id":"request-1"}`))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Forwarded-For", "forged")
			res, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			body, _ := io.ReadAll(res.Body)
			if res.StatusCode != status || res.Header.Get("X-Run-ID") != "run-1" ||
				string(body) != `{"detail":"原始响应","run_id":"run-1"}` {
				t.Fatalf("response changed: %d %s", res.StatusCode, body)
			}
		})
	}
}

func TestSSEFlushesBeforeCompletionAndCancelsUpstream(t *testing.T) {
	cancelled := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("X-Run-ID", "run-stream")
		for _, event := range []string{"thinking", "tool_start", "tool_end", "content"} {
			_, _ = fmt.Fprintf(w, "event: %s\ndata: {\"delta\":\"中文\"}\n\n", event)
		}
		w.(http.Flusher).Flush()
		<-r.Context().Done() // 必须由下游断连结束，不能预先关闭来掩盖缓冲问题。
		close(cancelled)
	}))
	defer upstream.Close()
	gw := gateway(t, upstream.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "POST", gw.URL+"/api/v1/conversations/c/messages", strings.NewReader(`{"question":"test"}`))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.Header.Get("Content-Type") != "text/event-stream" || res.Header.Get("X-Run-ID") != "run-stream" {
		t.Fatal("SSE headers lost")
	}
	reader := bufio.NewReader(res.Body)
	for _, event := range []string{"thinking", "tool_start", "tool_end", "content"} {
		want := "event: " + event + "\ndata: {\"delta\":\"中文\"}\n\n"
		body := make([]byte, len(want))
		if _, err := io.ReadFull(reader, body); err != nil || string(body) != want {
			t.Fatalf("SSE not delivered while upstream is open: %q, %v", body, err)
		}
	}
	cancel()
	select {
	case <-cancelled:
	case <-time.After(3 * time.Second):
		t.Fatal("client cancellation did not reach upstream")
	}
}

func TestUpstreamStreamFailureDoesNotAppendJSONOrSuccess(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "event: content\ndata: partial\n\n")
		w.(http.Flusher).Flush()
		panic(http.ErrAbortHandler)
	}))
	defer upstream.Close()
	gw := gateway(t, upstream.URL)
	res, err := (&http.Client{Timeout: 5 * time.Second}).Get(gw.URL + "/api/v1/conversations/c/messages")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, readErr := io.ReadAll(res.Body)
	if readErr == nil || string(body) != "event: content\ndata: partial\n\n" {
		t.Fatalf("expected partial stream and read error, got %q, %v", body, readErr)
	}
}

func TestUnreachableUpstreamReturns502(t *testing.T) {
	upstream := httptest.NewServer(http.NotFoundHandler())
	upstream.Close()
	gw := gateway(t, upstream.URL)
	res, err := (&http.Client{Timeout: 5 * time.Second}).Get(gw.URL + "/api/v1/conversations")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != 502 || !strings.Contains(string(body), `"detail"`) {
		t.Fatalf("expected JSON 502: %d %s", res.StatusCode, body)
	}
}

func TestRoutesAndStaticFiles(t *testing.T) {
	t.Chdir("..") // 静态目录与实际进程工作目录一致。
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Proxied", "yes")
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()
	gw := gateway(t, upstream.URL)
	for _, tc := range []struct {
		method, path string
		status       int
		proxied      bool
	}{
		{"GET", "/", 200, false},
		{"GET", "/static/app.js", 200, false},
		{"GET", "/api/v1/conversations?offset=20", 204, true},
		{"POST", "/api/v1/conversations", 204, true},
		{"GET", "/api/v1/conversations/c/runs/r", 204, true},
		{"POST", "/api/v1/conversations/c/runs/r/cancel", 204, true},
		{"POST", "/api/v1/ask", 404, false},
		{"GET", "/api/v1/history", 404, false},
		{"GET", "/api/v1/conversations-evil", 404, false},
		{"GET", "/static/missing.js", 404, false},
	} {
		req, _ := http.NewRequest(tc.method, gw.URL+tc.path, nil)
		res, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, res.Body)
		res.Body.Close()
		if res.StatusCode != tc.status || (res.Header.Get("X-Proxied") == "yes") != tc.proxied {
			t.Errorf("%s %s: unexpected response %d", tc.method, tc.path, res.StatusCode)
		}
	}
}

func TestRejectInvalidTarget(t *testing.T) {
	for _, value := range []string{"", "localhost:8001", "ftp://localhost", "http://", "http://localhost/api", "http://user:password@localhost", "http://localhost?x=1", "http://localhost#fragment"} {
		if _, err := proxy.NewAgentProxy(value); err == nil {
			t.Errorf("accepted invalid target %q", value)
		}
	}
}
