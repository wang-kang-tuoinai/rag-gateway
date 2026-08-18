package model

type RAGQueryRequest struct {
	Question string `json:"question"`
}

type RAGReference struct {
	Source string `json:"source"`
	Topic  string `json:"topic"`
}

type RAGQueryResponse struct {
	Answer         string         `json:"answer"`
	ConversationID string         `json:"conversation_id"`
	References     []RAGReference `json:"references"`
}
