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

type MessageReference struct {
	Source string `json:"source"`
	Topic  string `json:"topic"`
}

type MessageItem struct {
	Role       string             `json:"role"`
	Content    string             `json:"content"`
	Timestamp  int64              `json:"timestamp"`
	References []MessageReference `json:"references"`
}

type ListMessagesResponse struct {
	ConversationID string        `json:"conversation_id"`
	Items          []MessageItem `json:"items"`
	NextCursor     *int64        `json:"next_cursor"`
	HasMore        bool          `json:"has_more"`
}

