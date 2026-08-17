package model

type ConversationSummary struct {
	ID        string  `json:"id"`
	Title     *string `json:"title"`      // 可能为 null
	CreatedAt int64   `json:"created_at"` // 秒级时间戳
	UpdatedAt int64   `json:"updated_at"`
}

type ListHistoryResponse struct {
	Items      []ConversationSummary `json:"items"`
	NextCursor *int64                `json:"next_cursor"` // 可能为 null
	HasMore    bool                  `json:"has_more"`
}

