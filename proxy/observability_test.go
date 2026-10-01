package proxy_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"rag-bot-client/proxy"
	"rag-bot-client/router"
	"sync/atomic"
	"testing"
)

func TestVisualProxyPreservesQueryAndIsReadOnly(t *testing.T) {
	var calls atomic.Int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.RequestURI() != "/api/v1/visual/traces?service=user&operation=GET+%2Fa" {
			t.Error(r.URL.RequestURI())
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(429)
		io.WriteString(w, `{"error":"busy"}`)
	}))
	defer up.Close()
	p, err := proxy.NewObservabilityProxy(up.URL)
	if err != nil {
		t.Fatal(err)
	}
	r := router.SetupRouter(http.NotFoundHandler(), p)
	gw := httptest.NewServer(r)
	defer gw.Close()
	for _, method := range []string{"GET", "POST"} {
		req, err := http.NewRequest(method, gw.URL+"/api/v1/visual/traces?service=user&operation=GET+%2Fa", nil)
		if err != nil {
			t.Fatal(err)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if method == "GET" && resp.StatusCode != 429 {
			t.Fatal(resp.StatusCode)
		}
		if method == "POST" && resp.StatusCode != 404 {
			t.Fatal(resp.StatusCode)
		}
	}
	if calls.Load() != 1 {
		t.Fatal("non-read request reached upstream")
	}
}
