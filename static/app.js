/**
 * Ops Agent RAG Gateway - Frontend Client Application
 */

document.addEventListener('DOMContentLoaded', () => {
  // --- Global State & Constants ---
  const STORAGE_KEY = 'ops_rag_active_conversation';

  let currentConversationId = null;
  let nextCursor = null;
  let hasMoreHistory = false;
  let thinkingTimer = null;

  const thinkingPhrases = [
    "Analyzing input prompt...",
    "Embedding query vector...",
    "Searching vector database index...",
    "Retrieving candidate documents...",
    "Filtering top-k relevant context...",
    "Synthesizing knowledge context...",
    "Generating model response...",
    "Refining output formatting...",
    "Finalizing response details..."
  ];

  // --- DOM Elements ---
  const historyListEl = document.getElementById('history-list');
  const loadMoreBtnEl = document.getElementById('load-more-btn');
  const newChatBtnEl = document.getElementById('new-chat-btn');
  const messagesContainerEl = document.getElementById('messages-container');
  const welcomeScreenEl = document.getElementById('welcome-screen');
  const currentChatTitleEl = document.getElementById('current-chat-title');
  const currentChatIdEl = document.getElementById('current-chat-id');
  const chatFormEl = document.getElementById('chat-form');
  const userInputEl = document.getElementById('user-input');
  const sendBtnEl = document.getElementById('send-btn');

  // --- Configure Marked JS ---
  if (window.marked) {
    marked.setOptions({
      highlight: function (code, lang) {
        if (window.hljs) {
          const language = hljs.getLanguage(lang) ? lang : 'plaintext';
          return hljs.highlight(code, { language }).value;
        }
        return code;
      },
      breaks: true
    });
  }

  // --- Storage Helper Functions ---
  function saveActiveConversation(id, title) {
    if (id) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          id: id,
          title: title || `会话 ${id.substring(0, 8)}`
        }));
      } catch (e) {
        console.warn('Unable to write active conversation to localStorage:', e);
      }
    } else {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (e) {}
    }
  }

  function getStoredActiveConversation() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  }

  // --- Auto-resize Textarea ---
  userInputEl.addEventListener('input', () => {
    userInputEl.style.height = 'auto';
    userInputEl.style.height = Math.min(userInputEl.scrollHeight, 160) + 'px';
  });

  userInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatFormEl.dispatchEvent(new Event('submit'));
    }
  });

  // --- Prompt Chip Click Handlers ---
  document.querySelectorAll('.prompt-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const promptText = chip.getAttribute('data-prompt');
      if (promptText) {
        userInputEl.value = promptText;
        userInputEl.style.height = 'auto';
        chatFormEl.dispatchEvent(new Event('submit'));
      }
    });
  });

  // --- New Chat Button Handler ---
  newChatBtnEl.addEventListener('click', () => {
    startNewChat();
  });

  function startNewChat() {
    currentConversationId = null;
    saveActiveConversation(null);

    currentChatTitleEl.textContent = '新会话';
    currentChatIdEl.textContent = 'ID: new';
    
    // Highlight sidebar items
    document.querySelectorAll('.history-item').forEach(item => item.classList.remove('active'));

    // Clear messages and show welcome screen
    messagesContainerEl.innerHTML = '';
    messagesContainerEl.appendChild(welcomeScreenEl);
    welcomeScreenEl.style.display = 'block';
  }

  // --- History List Fetching ---
  async function loadHistory(isAppend = false) {
    try {
      let url = '/api/v1/history?limit=20';
      if (isAppend && nextCursor) {
        url += `&cursor=${nextCursor}`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP Error ${res.status}`);
      }

      const data = await res.json();
      nextCursor = data.next_cursor;
      hasMoreHistory = data.has_more;

      if (!isAppend) {
        historyListEl.innerHTML = '';
      }

      if (data.items && data.items.length > 0) {
        data.items.forEach(item => {
          const li = document.createElement('li');
          li.className = 'history-item';
          if (item.id === currentConversationId) {
            li.classList.add('active');
            if (item.title) {
              currentChatTitleEl.textContent = item.title;
            }
          }

          const titleText = item.title ? item.title : `会话 ${item.id.substring(0, 8)}`;
          const timeFormatted = formatUnixTime(item.updated_at || item.created_at);

          li.innerHTML = `
            <div class="item-title">${escapeHtml(titleText)}</div>
            <div class="item-time">${timeFormatted}</div>
          `;

          li.addEventListener('click', () => {
            selectConversation(item.id, titleText);
          });

          historyListEl.appendChild(li);
        });
      } else if (!isAppend) {
        historyListEl.innerHTML = '<li class="history-item" style="color: var(--text-dim); cursor: default;">暂无历史会话</li>';
      }

      loadMoreBtnEl.style.display = hasMoreHistory ? 'block' : 'none';
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  }

  loadMoreBtnEl.addEventListener('click', () => {
    loadHistory(true);
  });

  function selectConversation(id, title) {
    currentConversationId = id;
    saveActiveConversation(id, title);

    currentChatTitleEl.textContent = title;
    currentChatIdEl.textContent = `ID: ${id.substring(0, 8)}`;

    document.querySelectorAll('.history-item').forEach(item => {
      item.classList.remove('active');
      if (item.querySelector('.item-title')?.textContent === title) {
        item.classList.add('active');
      }
    });

    // Clear message container and add prompt info
    messagesContainerEl.innerHTML = '';
    welcomeScreenEl.style.display = 'none';

    appendSystemNotice(`已切换至会话 [${id}]。您可以继续在此会话中提问。`);
  }

  // --- Form Submission / Ask ---
  chatFormEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = userInputEl.value.trim();
    if (!question) return;

    // Reset textarea
    userInputEl.value = '';
    userInputEl.style.height = 'auto';

    // Hide welcome screen if visible
    if (welcomeScreenEl.style.display !== 'none') {
      welcomeScreenEl.style.display = 'none';
    }

    // Append User Message
    appendUserMessage(question);

    // Append Bot Loading Message with Thinking Word Carousel
    const { botRow, wordSpan, stopThinkingAnimation } = appendBotThinkingMessage();

    // Disable input controls during API request
    setFormDisabled(true);

    try {
      let endpoint = '/api/v1/ask';
      if (currentConversationId) {
        endpoint = `/api/v1/conversations/${encodeURIComponent(currentConversationId)}/ask`;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question })
      });

      const data = await response.json();
      stopThinkingAnimation();

      if (!response.ok) {
        const errorMsg = data.error || '服务器请求异常';
        renderBotError(botRow, errorMsg);
      } else {
        // Update conversation ID state & persist to localStorage
        if (data.conversation_id) {
          currentConversationId = data.conversation_id;
          saveActiveConversation(data.conversation_id, question);
          currentChatIdEl.textContent = `ID: ${data.conversation_id.substring(0, 8)}`;
        }

        renderBotResponse(botRow, data.answer, data.references);
        
        // Refresh sidebar history list
        loadHistory(false);
      }
    } catch (err) {
      stopThinkingAnimation();
      renderBotError(botRow, `网络错误: ${err.message}`);
    } finally {
      setFormDisabled(false);
    }
  });

  // --- UI Helper Functions ---

  function appendUserMessage(text) {
    const row = document.createElement('div');
    row.className = 'message-row user';
    row.innerHTML = `
      <div class="message-content">
        <div class="message-bubble">${escapeHtml(text)}</div>
      </div>
      <div class="avatar">You</div>
    `;
    messagesContainerEl.appendChild(row);
    scrollToBottom();
  }

  function appendBotThinkingMessage() {
    const row = document.createElement('div');
    row.className = 'message-row bot';
    
    row.innerHTML = `
      <div class="avatar">AI</div>
      <div class="message-content" style="width: 100%;">
        <div class="message-bubble">
          <div class="thinking-box">
            <div class="spinner-icon"></div>
            <div class="carousel-text-wrapper">
              <span class="carousel-word" id="thinking-word">${thinkingPhrases[0]}</span>
            </div>
          </div>
        </div>
      </div>
    `;

    messagesContainerEl.appendChild(row);
    scrollToBottom();

    const wordEl = row.querySelector('#thinking-word');
    let phraseIdx = 0;

    const timer = setInterval(() => {
      phraseIdx = (phraseIdx + 1) % thinkingPhrases.length;
      wordEl.style.animation = 'none';
      void wordEl.offsetHeight; // trigger reflow
      wordEl.textContent = thinkingPhrases[phraseIdx];
      wordEl.style.animation = 'slideWord 0.4s ease-out';
    }, 1200);

    return {
      botRow: row,
      wordSpan: wordEl,
      stopThinkingAnimation: () => clearInterval(timer)
    };
  }

  function renderBotResponse(botRow, answer, references) {
    const bubbleEl = botRow.querySelector('.message-bubble');
    
    // Parse Markdown
    let rawHtml = '';
    if (window.marked) {
      rawHtml = marked.parse(answer);
    } else {
      rawHtml = `<p>${escapeHtml(answer)}</p>`;
    }

    // Anti-XSS Sanitization via DOMPurify
    let sanitizedHtml = rawHtml;
    if (window.DOMPurify) {
      sanitizedHtml = DOMPurify.sanitize(rawHtml);
    }

    // Build References Section if available
    let refsHtml = '';
    if (references && Array.isArray(references) && references.length > 0) {
      const refItems = references.map(ref => `
        <div class="ref-card">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          <span class="topic-badge">${escapeHtml(ref.topic || 'doc')}</span>
          <span>${escapeHtml(ref.source || '')}</span>
        </div>
      `).join('');

      refsHtml = `
        <div class="references-box">
          <div class="references-title">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            参考来源 (References)
          </div>
          <div class="ref-cards">
            ${refItems}
          </div>
        </div>
      `;
    }

    bubbleEl.innerHTML = sanitizedHtml + refsHtml;
    
    // Re-apply highlight.js syntax highlighting if present
    if (window.hljs) {
      bubbleEl.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
      });
    }

    scrollToBottom();
  }

  function renderBotError(botRow, errorText) {
    const bubbleEl = botRow.querySelector('.message-bubble');
    bubbleEl.innerHTML = `
      <div style="color: #f87171; display: flex; align-items: center; gap: 8px;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <span>提问失败：${escapeHtml(errorText)}</span>
      </div>
    `;
    scrollToBottom();
  }

  function appendSystemNotice(msg) {
    const div = document.createElement('div');
    div.style.cssText = 'text-align: center; font-size: 0.8rem; color: var(--text-dim); margin: 12px 0;';
    div.textContent = msg;
    messagesContainerEl.appendChild(div);
    scrollToBottom();
  }

  function setFormDisabled(disabled) {
    userInputEl.disabled = disabled;
    sendBtnEl.disabled = disabled;
  }

  function scrollToBottom() {
    messagesContainerEl.scrollTop = messagesContainerEl.scrollHeight;
  }

  function formatUnixTime(ts) {
    if (!ts) return '';
    const date = new Date(ts * 1000);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[m];
    });
  }

  // --- Initial Load ---
  const savedConv = getStoredActiveConversation();
  if (savedConv && savedConv.id) {
    currentConversationId = savedConv.id;
    currentChatTitleEl.textContent = savedConv.title || '当前会话';
    currentChatIdEl.textContent = `ID: ${savedConv.id.substring(0, 8)}`;
    welcomeScreenEl.style.display = 'none';
    appendSystemNotice(`已自动恢复上次会话 [${savedConv.id}]。您可以继续在此会话中提问。`);
  }

  loadHistory(false);
});
