package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"rag-bot-client/model"
	"strconv"
	"time"
)

type RAGClient struct {
	baseURL string
	client  *http.Client
}

func NewRAGClient(baseURL string) *RAGClient {
	return &RAGClient{
		baseURL: baseURL,
		client:  &http.Client{Timeout: 30 * time.Second},
	}
}

// HTTPError 表示 RAG 服务返回的非 2xx 响应，携带状态码便于上层区分处理。
type HTTPError struct {
	StatusCode int
	Message    string
}

func (e *HTTPError) Error() string {
	return fmt.Sprintf("HTTP %d: %s", e.StatusCode, e.Message)
}

// newHTTPError 从响应构造带状态码的错误，优先解析 FastAPI 的 {"detail": "..."}。
func newHTTPError(resp *http.Response) error {
	msg := resp.Status
	var detail struct {
		Detail string `json:"detail"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&detail); err == nil && detail.Detail != "" {
		msg = detail.Detail
	}
	return &HTTPError{StatusCode: resp.StatusCode, Message: msg}
}

func (c *RAGClient) ListHistory(ctx context.Context, limit int, cursor *int64) (*model.ListHistoryResponse, error) {
	u, err := url.Parse(c.baseURL)
	if err != nil {
		return nil, err
	}
	u = u.JoinPath("api", "v1", "history")

	q := u.Query()
	q.Set("limit", strconv.Itoa(limit))
	if cursor != nil {
		q.Set("cursor", strconv.FormatInt(*cursor, 10))
	}
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("构造请求失败: %w", err)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, newHTTPError(resp)
	}

	var out model.ListHistoryResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}
	return &out, nil
}

func (c *RAGClient) Ask(ctx context.Context, question string, conversationID string) (*model.RAGQueryResponse, error) {
	u, err := url.Parse(c.baseURL)
	if err != nil {
		return nil, err
	}
	if conversationID == "" {
		u = u.JoinPath("api", "v1", "ask")
	} else {
		u = u.JoinPath("api", "v1", "conversations", conversationID, "ask")
	}

	body, err := json.Marshal(model.RAGQueryRequest{Question: question})
	if err != nil {
		return nil, fmt.Errorf("编码请求失败: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("构造请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, newHTTPError(resp)
	}

	var out model.RAGQueryResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}
	return &out, nil
}
