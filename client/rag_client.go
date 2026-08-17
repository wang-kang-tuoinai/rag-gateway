package client

import (
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
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, resp.Status)
	}

	var out model.ListHistoryResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}
	return &out, nil
}
