let globalController;
let isPaused = false;

// 根据系统性能动态设置并发数
const MAX_CONCURRENCY = (() => {
  // 检测系统性能
  const memory = navigator.deviceMemory || 4; // 默认假设4GB内存
  const cores = navigator.hardwareConcurrency || 4; // 默认假设4核CPU
  
  // 根据系统性能调整并发数
  if (memory >= 8 && cores >= 8) {
    return 17; // 高性能系统
  } else if (memory >= 4 && cores >= 4) {
    return 12; // 中等性能系统
  } else {
    return 8;  // 低性能系统
  }
})();
document.addEventListener('DOMContentLoaded', function() {
  const abortBtn = document.getElementById('abortBtn');
  abortBtn.addEventListener('click', handlePauseResume);
  // 设置初始状态
  abortBtn.disabled = true;
  
  // 添加加载状态控制逻辑
  document.getElementById('checkBtn').addEventListener('click', async () => {
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

// 添加HTML转义函数
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function analyzeBookmarks(nodes) {
try {
    // 清理之前可能存在的全局控制器
    if (globalController) {
      globalController.abort();
      globalController = null;
    }
    
    let output = '<h3>📊 书签健康报告</h3>';
    const urlMap = new Map();
    const invalidUrls = [];
    const duplicates = new Set();
    const ignoredUrls = [];
    let totalBookmarks = 0;
    let verifiedBookmarks = 0;
    let unverifiedBookmarks = 0;
    let ignoredBookmarks = 0;
    let processedBookmarks = 0;

    // DOM缓存
    const resultDiv = document.getElementById('result');
    const checkBtn = document.getElementById('checkBtn');
    const abortBtn = document.getElementById('abortBtn');

    // 添加实时状态显示
    output += `
      <div class="stats">
        <p>📖 总书签: <strong>${totalBookmarks}</strong></p>
        <p>✅ 已验证: <span style="color:#7BB662">${verifiedBookmarks}</span></p>
        <p>🟡 待确认: <span style="color:#F1C40F">${unverifiedBookmarks}</span></p>
        <p>⚪ 已忽略: <span style="color:#95A5A6">${ignoredBookmarks}</span></p>
        <p>📈 检查进度: <span id="progress">0%</span></p>
      </div>
    `;
    resultDiv.innerHTML = output;

    // 新增：动态渲染待确认URL列表
    function renderUnverifiedList() {
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

    // 修复：将updateStats提前
    function updateStats() {
      const stats = document.querySelector('.stats');
      if (stats) {
        const progress = totalBookmarks > 0 ? Math.round((processedBookmarks / totalBookmarks) * 100) : 0;
        stats.innerHTML = `
          <p>📖 总书签: <strong>${totalBookmarks}</strong></p>
          <p>✅ 已验证: <span style="color:#7BB662">${verifiedBookmarks}</span></p>
          <p>🟡 待确认: <span style="color:#F1C40F">${unverifiedBookmarks}</span></p>
          <p>⚪ 已忽略: <span style="color:#95A5A6">${ignoredBookmarks}</span></p>
          <p>📈 检查进度: <span id="progress">${progress}%</span></p>
        `;
      }
      // 新增：每次状态更新时刷新待确认列表
      renderUnverifiedList();
    }

    // 并发控制器（最大10个并发）
    const createConcurrencyController = (maxConcurrency) => {
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
        // 恢复处理队列
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
    };

    globalController = createConcurrencyController(MAX_CONCURRENCY);
    const { run, abort, pause, resume } = globalController;

    async function scan(node) {
      if (node.url) {
        totalBookmarks++;
        updateStats(); // 更新总书签数
        // 跨层级重复检测
        const count = urlMap.get(node.url) || 0;
        urlMap.set(node.url, count + 1);
        if (count > 0) duplicates.add(node.url);
        // 协议检测
        if (!node.url.startsWith('http:') && !node.url.startsWith('https:')) {
          ignoredBookmarks++;
          processedBookmarks++; // 新增：更新已处理数
          updateStats(); // 更新已忽略数
          ignoredUrls.push({ title: node.title, url: node.url });
          return;
        }
        // 网络请求验证
        try {
          await run(async () => {
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => reject(new Error('请求超时（5秒）')), 5000);
            });
            try {
              const response = await Promise.race([
                new Promise((resolve) => {
                  chrome.runtime.sendMessage({
                    action: 'verifyUrl',
                    url: node.url
                  }, (result) => {
                    if (chrome.runtime.lastError) {
                      resolve({ status: 500, error: chrome.runtime.lastError.message });
                    } else {
                      resolve(result);
                    }
                  });
                }),
                timeoutPromise
              ]);
              if (response.status >= 200 && response.status < 400) {
                verifiedBookmarks++;
                processedBookmarks++; // 新增：更新已处理数
                updateStats(); // 更新已验证数
              } else {
                throw new Error(response.error || `HTTP ${response.status}`);
              }
            } catch (error) {
              unverifiedBookmarks++;
              processedBookmarks++; // 新增：更新已处理数
              updateStats(); // 更新待确认数
              invalidUrls.push({
                title: node.title,
                url: node.url,
                error: error.message
              });
            }
          });
        } catch (error) {
          unverifiedBookmarks++;
          processedBookmarks++; // 新增：更新已处理数
          updateStats(); // 更新待确认数
          invalidUrls.push({
            title: node.title,
            url: node.url,
            error: error.message
          });
        }
      }
      await Promise.all(node.children?.map(scan) || []);
    }

    // await所有scan
    await Promise.all(nodes.map(scan));
    console.log('重复链接:', Array.from(duplicates));
    if (duplicates.size > 0) {
      output += `<p>发现重复书签：${Array.from(duplicates).map(url => escapeHtml(url)).join(', ')}</p>`;
    }
    if (invalidUrls.length > 0) {
      output += `<p>发现无效链接：</p><ul>`;
      invalidUrls.forEach(item => {
        output += `<li>${escapeHtml(item.title)} - ${escapeHtml(item.url)} 
          ${item.status ? `状态码: ${escapeHtml(String(item.status))}` : ''}
          ${item.error ? `错误: <span style='color:#f44336'>${escapeHtml(item.error)}</span>` : ''}
        </li>`;
      });
      output += `</ul>`;
    }
    output += `
      <div class="stats">
        <p>📖 总书签: <strong>${totalBookmarks}</strong></p>
        <p>✅ 已验证: <span style="color:#7BB662">${verifiedBookmarks}</span></p>
        <p>🟡 待确认: <span style="color:#F1C40F">${unverifiedBookmarks}</span></p>
        <p>⚪ 已忽略: <span style="color:#95A5A6">${ignoredBookmarks}</span></p>
        <p>📈 检查进度: <span id="progress">100%</span></p>
      </div>
    `;
    
    if (ignoredUrls.length > 0) {
      output += `<p>非HTTP(S)链接：</p><ul>`;
      ignoredUrls.forEach(item => {
        output += `<li>${escapeHtml(item.title)} - ${escapeHtml(item.url)}</li>`;
      });
      output += `</ul>`;
    }

    // 添加待确认URL列表
    if (invalidUrls.length > 0) {
      output += `
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

    // 清理数据
    urlMap.clear();
    duplicates.clear();
    invalidUrls.length = 0;
    ignoredUrls.length = 0;

    // 更新检查完成状态
    showLoading(false);
    updateLoadingStatus('✨ 检查完成！');
    checkBtn.disabled = false;
    abortBtn.disabled = true; // 检查完成后禁用暂停按钮

    return output || '<p>未发现问题书签</p>';
  } catch (error) {
    console.error('书签分析过程出错:', error);
    showLoading(false);
    updateLoadingStatus('❌ 检查出错');
    document.getElementById('checkBtn').disabled = false;
    document.getElementById('abortBtn').disabled = true; // 检查出错时禁用暂停按钮
    // 错误信息美化
    return `<p class="error">😞 分析过程出现错误: <span style='color:#f44336'>${escapeHtml(error.message)}</span></p>`;
  }
}

// 暂停/恢复功能
function handlePauseResume() {
  console.log('暂停/恢复按钮被点击');
  if (globalController) {
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
  } else {
    console.log('没有活动的控制器需要暂停/恢复');
  }
}

// 更新暂停按钮状态
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

// 更新加载状态显示
function updateLoadingStatus(status) {
  const loadingText = document.querySelector('#loading div:last-child');
  if (loadingText) {
    loadingText.textContent = status;
  }
}

function showLoading(isVisible) {
  console.log('showLoading>>> ');
  document.getElementById('loading').style.display = isVisible ? 'flex' : 'none';
  document.getElementById('checkBtn').disabled = isVisible;
  document.getElementById('abortBtn').disabled = false; // 始终启用暂停按钮，除非检查完成或出错
  if (isVisible) {
    updateLoadingStatus('正在施展魔法...');
  }
}