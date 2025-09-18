// Constants and Configuration
const PERFORMANCE_THRESHOLDS = {
  HIGH_MEMORY: 8,
  HIGH_CORES: 8,
  MEDIUM_MEMORY: 4,
  MEDIUM_CORES: 4
};

const CONCURRENCY_LEVELS = {
  HIGH: 17,
  MEDIUM: 12,
  LOW: 8
};

const TIMEOUT_DURATION = 5000;

// Global state
let globalController;
let isPaused = false;

// 根据系统性能动态设置并发数
const MAX_CONCURRENCY = (() => {
  const memory = navigator.deviceMemory || PERFORMANCE_THRESHOLDS.MEDIUM_MEMORY;
  const cores = navigator.hardwareConcurrency || PERFORMANCE_THRESHOLDS.MEDIUM_CORES;
  
  if (memory >= PERFORMANCE_THRESHOLDS.HIGH_MEMORY && cores >= PERFORMANCE_THRESHOLDS.HIGH_CORES) {
    return CONCURRENCY_LEVELS.HIGH;
  } else if (memory >= PERFORMANCE_THRESHOLDS.MEDIUM_MEMORY && cores >= PERFORMANCE_THRESHOLDS.MEDIUM_CORES) {
    return CONCURRENCY_LEVELS.MEDIUM;
  } else {
    return CONCURRENCY_LEVELS.LOW;
  }
})();
// DOM Initialization
document.addEventListener('DOMContentLoaded', function() {
  const elements = {
    checkBtn: document.getElementById('checkBtn'),
    abortBtn: document.getElementById('abortBtn')
  };
  
  // Initialize button states
  elements.abortBtn.disabled = true;
  elements.abortBtn.addEventListener('click', handlePauseResume);
  
  // Main check button handler
  elements.checkBtn.addEventListener('click', async () => {
    showLoading(true);
    isPaused = false;
    updatePauseButton();
    
    chrome.bookmarks.getTree(async (bookmarkTreeNodes) => {
      console.log('书签树原始数据:', JSON.parse(JSON.stringify(bookmarkTreeNodes)));
      const results = document.getElementById('result');
      await analyzeBookmarks(bookmarkTreeNodes);
      console.log('书签树分析结果:', results.innerHTML);
      results.innerHTML = results.innerHTML || '<p>未发现问题书签</p>';
    });
  });
});

// Utility Functions
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showLoading(isVisible) {
  const elements = {
    loading: document.getElementById('loading'),
    checkBtn: document.getElementById('checkBtn'),
    abortBtn: document.getElementById('abortBtn')
  };
  
  elements.loading.style.display = isVisible ? 'flex' : 'none';
  elements.checkBtn.disabled = isVisible;
  elements.abortBtn.disabled = false;
  
  if (isVisible) {
    updateLoadingStatus('正在施展魔法...');
  }
}

function updateLoadingStatus(status) {
  const loadingText = document.querySelector('#loading div:last-child');
  if (loadingText) {
    loadingText.textContent = status;
  }
}

function updatePauseButton() {
  const abortBtn = document.getElementById('abortBtn');
  if (isPaused) {
    abortBtn.textContent = '▶️ 继续检查';
    abortBtn.setAttribute('aria-label', '继续检查');
  } else {
    abortBtn.textContent = '⏸️ 暂停检查';
    abortBtn.setAttribute('aria-label', '暂停检查');
  }
}

// Event Handlers
function handlePauseResume() {
  console.log('暂停/恢复按钮被点击');
  if (!globalController) {
    console.log('没有活动的控制器需要暂停/恢复');
    return;
  }

  try {
    if (isPaused) {
      globalController.resume();
      isPaused = false;
      updateLoadingStatus('正在施展魔法...');
    } else {
      globalController.pause();
      isPaused = true;
      updateLoadingStatus('检查已暂停💤');
    }
    updatePauseButton();
  } catch (error) {
    console.error('暂停/恢复操作失败:', error);
  }
}

// Bookmark Analysis Helper Functions
function createInitialStats() {
  return {
    output: '<h3>📊 书签健康报告</h3>',
    urlMap: new Map(),
    invalidUrls: [],
    duplicates: new Set(),
    ignoredUrls: [],
    totalBookmarks: 0,
    verifiedBookmarks: 0,
    unverifiedBookmarks: 0,
    ignoredBookmarks: 0,
    processedBookmarks: 0
  };
}

function createStatsDisplay(stats) {
  return `
    <div class="stats">
      <p>📖 总书签: <strong>${stats.totalBookmarks}</strong></p>
      <p>✅ 已验证: <span style="color:#7BB662">${stats.verifiedBookmarks}</span></p>
      <p>🟡 待确认: <span style="color:#F1C40F">${stats.unverifiedBookmarks}</span></p>
      <p>⚪ 已忽略: <span style="color:#95A5A6">${stats.ignoredBookmarks}</span></p>
      <p>📈 检查进度: <span id="progress">${stats.totalBookmarks > 0 ? Math.round((stats.processedBookmarks / stats.totalBookmarks) * 100) : 0}%</span></p>
    </div>
  `;
}

function renderUnverifiedList(invalidUrls, resultDiv) {
  let html = '';
  if (invalidUrls.length > 0) {
    html += `
      <div class="unverified-list">
        <h4>🔄 待确认链接列表</h4>
        <p class="tip">点击链接可以手动验证其可访问性</p>
        <div class="url-list">
          ${invalidUrls.map(item => `
            <div class="url-item">
              <div class="url-title">${escapeHtml(item.title)}</div>
              <a href="${escapeHtml(item.url)}" target="_blank" class="url-link">
                ${escapeHtml(item.url)}
              </a>
              <div class="url-error" style="color:#f44336">${escapeHtml(item.error)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  
  let container = document.getElementById('unverified-list-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'unverified-list-container';
    resultDiv.appendChild(container);
  }
  container.innerHTML = html;
}

function createConcurrencyController(maxConcurrency) {
  const queue = [];
  let activeCount = 0;
  let abortController = new AbortController();

  const pause = () => {
    isPaused = true;
    console.log('检查已暂停');
  };

  const resume = () => {
    isPaused = false;
    console.log('检查已恢复');
    if (queue.length > 0) {
      const batch = queue.splice(0, maxConcurrency);
      batch.forEach(task => task());
    }
  };

  const abort = () => {
    abortController.abort();
    console.log('>> aborted >>> queue.length: ', queue.length);
    queue.length = 0;
    activeCount = 0;
    abortController = new AbortController();
  };

  const next = () => {
    activeCount--;
    if (!isPaused && queue.length > 0) {
      queue.shift()();
    }
  };

  const run = async (fn) => {
    if (abortController.signal.aborted) {
      throw new Error('操作已中止');
    }
    if (isPaused) {
      return new Promise((resolve) => {
        queue.push(() => {
          resolve(run(fn));
        });
      });
    }
    if (activeCount < maxConcurrency) {
      activeCount++;
      try {
        return await fn({ signal: abortController.signal });
      } finally {
        next();
      }
    } else {
      return new Promise((resolve) => {
        queue.push(() => {
          resolve(run(fn));
        });
      });
    }
  };

  return { run, abort, pause, resume };
}

async function verifyUrl(url) {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`请求超时（${TIMEOUT_DURATION / 1000}秒）`)), TIMEOUT_DURATION);
  });
  
  const requestPromise = new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'verifyUrl',
      url: url
    }, (result) => {
      if (chrome.runtime.lastError) {
        resolve({ status: 500, error: chrome.runtime.lastError.message });
      } else {
        resolve(result);
      }
    });
  });
  
  return Promise.race([requestPromise, timeoutPromise]);
}

async function analyzeBookmarks(nodes) {
  try {
    // 清理之前可能存在的全局控制器
    if (globalController) {
      globalController.abort();
      globalController = null;
    }
    
    const stats = createInitialStats();
    
    // 缓存DOM元素
    const elements = {
      resultDiv: document.getElementById('result'),
      checkBtn: document.getElementById('checkBtn'),
      abortBtn: document.getElementById('abortBtn')
    };

    // 初始化显示
    stats.output += createStatsDisplay(stats);
    elements.resultDiv.innerHTML = stats.output;

    // 更新统计信息的闭包函数
    function updateStats() {
      const statsElement = document.querySelector('.stats');
      if (statsElement) {
        statsElement.innerHTML = createStatsDisplay(stats).replace('<div class="stats">', '').replace('</div>', '');
      }
      renderUnverifiedList(stats.invalidUrls, elements.resultDiv);
    }

    // 初始化并发控制器
    globalController = createConcurrencyController(MAX_CONCURRENCY);
    const { run } = globalController;

    async function scan(node) {
      if (node.url) {
        stats.totalBookmarks++;
        updateStats();
        
        // 检查重复书签
        const count = stats.urlMap.get(node.url) || 0;
        stats.urlMap.set(node.url, count + 1);
        if (count > 0) stats.duplicates.add(node.url);
        
        // 检查非HTTP(S)协议
        if (!node.url.startsWith('http:') && !node.url.startsWith('https:')) {
          stats.ignoredBookmarks++;
          stats.processedBookmarks++;
          updateStats();
          stats.ignoredUrls.push({ title: node.title, url: node.url });
          return;
        }
        
        // 网络验证
        try {
          await run(async () => {
            try {
              const response = await verifyUrl(node.url);
              if (response.status >= 200 && response.status < 400) {
                stats.verifiedBookmarks++;
              } else {
                throw new Error(response.error || `HTTP ${response.status}`);
              }
            } catch (error) {
              stats.unverifiedBookmarks++;
              stats.invalidUrls.push({
                title: node.title,
                url: node.url,
                error: error.message
              });
            } finally {
              stats.processedBookmarks++;
              updateStats();
            }
          });
        } catch (error) {
          stats.unverifiedBookmarks++;
          stats.processedBookmarks++;
          updateStats();
          stats.invalidUrls.push({
            title: node.title,
            url: node.url,
            error: error.message
          });
        }
      }
      
      if (node.children) {
        await Promise.all(node.children.map(scan));
      }
    }

    // 执行扫描
    await Promise.all(nodes.map(scan));
    
    // 生成最终报告
    return generateFinalReport(stats, elements);
    
  } catch (error) {
    console.error('书签分析过程出错:', error);
    showLoading(false);
    updateLoadingStatus('❌ 检查出错');
    document.getElementById('checkBtn').disabled = false;
    document.getElementById('abortBtn').disabled = true;
    return `<p class="error">😞 分析过程出现错误: <span style='color:#f44336'>${escapeHtml(error.message)}</span></p>`;
  }
}

function generateFinalReport(stats, elements) {
  console.log('重复链接:', Array.from(stats.duplicates));
  
  let output = stats.output;
  
  // 添加重复书签信息
  if (stats.duplicates.size > 0) {
    output += `<p>发现重复书签：${Array.from(stats.duplicates).map(url => escapeHtml(url)).join(', ')}</p>`;
  }
  
  // 添加无效链接信息
  if (stats.invalidUrls.length > 0) {
    output += `<p>发现无效链接：</p><ul>`;
    stats.invalidUrls.forEach(item => {
      output += `<li>${escapeHtml(item.title)} - ${escapeHtml(item.url)} 
        ${item.status ? `状态码: ${escapeHtml(String(item.status))}` : ''}
        ${item.error ? `错误: <span style='color:#f44336'>${escapeHtml(item.error)}</span>` : ''}
      </li>`;
    });
    output += `</ul>`;
  }
  
  // 添加最终统计
  output += createStatsDisplay({
    ...stats,
    processedBookmarks: stats.totalBookmarks // 确保显示100%完成
  }).replace('检查进度: <span id="progress">', '检查进度: <span id="progress">100%</span><span style="display:none">');
  
  // 添加忽略的非HTTP(S)链接
  if (stats.ignoredUrls.length > 0) {
    output += `<p>非HTTP(S)链接：</p><ul>`;
    stats.ignoredUrls.forEach(item => {
      output += `<li>${escapeHtml(item.title)} - ${escapeHtml(item.url)}</li>`;
    });
    output += `</ul>`;
  }

  // 添加待确认URL列表的样式和内容
  if (stats.invalidUrls.length > 0) {
    output += getUnverifiedListStyles();
    output += `
      <div class="unverified-list">
        <h4>🔄 待确认链接列表</h4>
        <p class="tip">点击链接可以手动验证其可访问性</p>
        <div class="url-list">
          ${stats.invalidUrls.map(item => `
            <div class="url-item">
              <div class="url-title">${escapeHtml(item.title)}</div>
              <a href="${escapeHtml(item.url)}" target="_blank" class="url-link">
                ${escapeHtml(item.url)}
              </a>
              <div class="url-error" style="color:#f44336">${escapeHtml(item.error)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // 清理数据
  stats.urlMap.clear();
  stats.duplicates.clear();
  stats.invalidUrls.length = 0;
  stats.ignoredUrls.length = 0;

  // 更新UI状态
  showLoading(false);
  updateLoadingStatus('✨ 检查完成！');
  elements.checkBtn.disabled = false;
  elements.abortBtn.disabled = true;

  return output || '<p>未发现问题书签</p>';
}

function getUnverifiedListStyles() {
  return `
    <style>
      .unverified-list {
        margin-top: 20px;
        padding: 15px;
        background: #f8f9fa;
        border-radius: 8px;
      }
      .tip {
        color: #666;
        font-size: 0.9em;
        margin: 5px 0 15px;
      }
      .url-list {
        max-height: 300px;
        overflow-y: auto;
        border: 1px solid #ddd;
        border-radius: 4px;
        padding: 10px;
      }
      .url-item {
        padding: 10px;
        border-bottom: 1px solid #eee;
      }
      .url-item:last-child {
        border-bottom: none;
      }
      .url-title {
        font-weight: bold;
        margin-bottom: 5px;
      }
      .url-link {
        color: #2196F3;
        text-decoration: none;
        word-break: break-all;
        display: block;
        margin: 5px 0;
      }
      .url-link:hover {
        text-decoration: underline;
      }
      .url-error {
        color: #f44336;
        font-size: 0.9em;
        margin-top: 5px;
      }
    </style>
  `;
}

