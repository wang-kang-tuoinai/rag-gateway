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
  // 使用 sessionStorage：Tab/窗口关闭时自动清空，同一 Tab 内刷新仍保留
  function saveActiveConversation(id, title) {
    if (id) {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
          id: id,
          title: title || `会话 ${id.substring(0, 8)}`
        }));
      } catch (e) {
        console.warn('Unable to write active conversation to sessionStorage:', e);
      }
    } else {
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch (e) {}
    }
  }

  function getStoredActiveConversation() {
    try {
      const data = sessionStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  }

  // --- Auto-resize Textarea ---
  userInputEl.addEventListener('input', () => {
    userInputEl.style.height = 'auto';
    const newHeight = Math.min(userInputEl.scrollHeight, 160);
    userInputEl.style.height = newHeight + 'px';
    if (userInputEl.scrollHeight > 160) {
      userInputEl.style.overflowY = 'auto';
    } else {
      userInputEl.style.overflowY = 'hidden';
    }
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

  // --- Messages Loading State ---
  let messagesCursor = null;
  let hasMoreMessages = false;
  let isLoadingMessages = false;

  // Scroll-to-top: auto-load older messages
  messagesContainerEl.addEventListener('scroll', () => {
    if (
      messagesContainerEl.scrollTop <= 50 &&
      hasMoreMessages &&
      !isLoadingMessages &&
      currentConversationId
    ) {
      loadMoreMessages(currentConversationId);
    }
  });

  async function loadConversationMessages(convId) {
    // Reset state
    messagesCursor = null;
    hasMoreMessages = false;
    messagesContainerEl.innerHTML = '';
    welcomeScreenEl.style.display = 'none';
    isLoadingMessages = true;

    try {
      const res = await fetch(`/api/v1/conversations/${encodeURIComponent(convId)}/messages?limit=40`);

      // 会话不存在（未迁移或已删除）：清空状态，回退到欢迎页
      if (res.status === 404) {
        console.warn(`Conversation ${convId} not found, resetting to welcome screen`);
        currentConversationId = null;
        saveActiveConversation(null);
        currentChatTitleEl.textContent = '新会话';
        currentChatIdEl.textContent = 'ID: new';
        messagesContainerEl.innerHTML = '';
        messagesContainerEl.appendChild(welcomeScreenEl);
        welcomeScreenEl.style.display = 'block';
        document.querySelectorAll('.history-item').forEach(item => item.classList.remove('active'));
        return;
      }

      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);

      const data = await res.json();
      messagesCursor = data.next_cursor;
      hasMoreMessages = data.has_more;

      // API returns newest-first; reverse to render chronologically (oldest on top)
      const chronological = (data.items || []).slice().reverse();
      chronological.forEach(msg => {
        renderHistoryMessage(msg);
      });

      scrollToBottom();
    } catch (err) {
      console.error('Failed to load messages:', err);
      appendSystemNotice(`加载消息失败: ${err.message}`);
    } finally {
      isLoadingMessages = false;
    }
  }

  async function loadMoreMessages(convId) {
    if (!messagesCursor || isLoadingMessages) return;
    isLoadingMessages = true;

    // Remember scroll position to maintain view after prepending
    const prevScrollHeight = messagesContainerEl.scrollHeight;
    const prevScrollTop = messagesContainerEl.scrollTop;

    try {
      const res = await fetch(
        `/api/v1/conversations/${encodeURIComponent(convId)}/messages?limit=20&cursor=${messagesCursor}`
      );
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);

      const data = await res.json();
      messagesCursor = data.next_cursor;
      hasMoreMessages = data.has_more;

      // API returns newest-first; reverse to chronological order, then prepend
      const chronological = (data.items || []).slice().reverse();
      const fragment = document.createDocumentFragment();
      chronological.forEach(msg => {
        const el = createHistoryMessageElement(msg);
        fragment.appendChild(el);
      });

      messagesContainerEl.insertBefore(fragment, messagesContainerEl.firstChild);

      // Restore scroll position so the user doesn't jump
      const newScrollHeight = messagesContainerEl.scrollHeight;
      messagesContainerEl.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
    } catch (err) {
      console.error('Failed to load more messages:', err);
    } finally {
      isLoadingMessages = false;
    }
  }

  function renderHistoryMessage(msg) {
    const el = createHistoryMessageElement(msg);
    messagesContainerEl.appendChild(el);
  }

  function createHistoryMessageElement(msg) {
    if (msg.role === 'user') {
      const row = document.createElement('div');
      row.className = 'message-row user';
      row.innerHTML = `
        <div class="message-content">
          <div class="message-bubble">${escapeHtml(msg.content)}</div>
        </div>
      `;
      return row;
    } else {
      const row = document.createElement('div');
      row.className = 'message-row bot';

      // Parse answer markdown
      let rawHtml = '';
      if (window.marked) {
        rawHtml = marked.parse(msg.content);
      } else {
        rawHtml = `<p>${escapeHtml(msg.content)}</p>`;
      }

      let sanitizedHtml = rawHtml;
      if (window.DOMPurify) {
        sanitizedHtml = DOMPurify.sanitize(rawHtml);
      }

      // Build references
      let refsHtml = '';
      if (msg.references && msg.references.length > 0) {
        const refItems = msg.references.map(ref => `
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

      row.innerHTML = `
        <div class="message-content" style="width: 100%;">
          <div class="message-bubble">${sanitizedHtml}${refsHtml}</div>
        </div>
      `;

      // Re-apply syntax highlighting
      if (window.hljs) {
        row.querySelectorAll('pre code').forEach((block) => {
          hljs.highlightElement(block);
        });
      }

      return row;
    }
  }

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

    // Load and render conversation messages
    loadConversationMessages(id);
  }

  // --- Form Submission / Ask ---
  chatFormEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = userInputEl.value.trim();
    if (!question) return;

    // Reset textarea
    userInputEl.value = '';
    userInputEl.style.height = 'auto';
    userInputEl.style.overflowY = 'hidden';

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
    `;
    messagesContainerEl.appendChild(row);
    scrollToBottom();
  }

  function appendBotThinkingMessage() {
    const row = document.createElement('div');
    row.className = 'message-row bot';
    
    row.innerHTML = `
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
    // Load historical messages for the restored conversation
    loadConversationMessages(savedConv.id);
  }

  loadHistory(false);
});
