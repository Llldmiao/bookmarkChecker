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
  const value = String(unsafe ?? '');
  return value
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
    const invalidUrlById = new Map();
    const duplicates = new Set();
    const ignoredUrls = [];
    const sectionCollapsed = {
      pending: false,
      confirmed: true
    };
    let totalBookmarks = 0;
    let verifiedBookmarks = 0;
    let unverifiedBookmarks = 0;
    let confirmedBadBookmarks = 0;
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
        <p>❌ 已确认失效: <span style="color:#E74C3C">${confirmedBadBookmarks}</span></p>
        <p>⚪ 已忽略: <span style="color:#95A5A6">${ignoredBookmarks}</span></p>
        <p>📈 检查进度: <span id="progress">0%</span></p>
      </div>
    `;
    resultDiv.innerHTML = output;

    // 新增：动态渲染待确认URL列表
    function renderUnverifiedList() {
      let html = '';
      const pending = invalidUrls.filter(item => item.state === 'unverified');
      const confirmedBad = invalidUrls.filter(item => item.state === 'confirmed_bad');
      if (pending.length > 0 || confirmedBad.length > 0) {
        const pendingSectionClass = sectionCollapsed.pending ? 'collapsed' : '';
        const confirmedSectionClass = sectionCollapsed.confirmed ? 'collapsed' : '';
        html += `
          <div class="unverified-list">
            <h4>🔄 待确认链接列表</h4>
            <p class="tip">点击链接可以手动验证其可访问性</p>
            ${pending.length > 0 ? `
              <div class="url-section ${pendingSectionClass}">
                <button
                  class="section-toggle"
                  data-action="toggle-section"
                  data-section="pending"
                  aria-expanded="${String(!sectionCollapsed.pending)}"
                >
                  <span>待确认 (${pending.length})</span>
                  <span class="toggle-icon">▾</span>
                </button>
                <div class="url-list">
                  ${pending.map(item => `
                    <div class="url-item">
                      <div class="url-title">${escapeHtml(item.title)}</div>
                      <a href="${escapeHtml(item.url)}" target="_blank" class="url-link">
                        ${escapeHtml(item.url)}
                      </a>
                      ${item.error ? `<div class="url-error">${escapeHtml(item.error)}</div>` : ''}
                      <div class="url-actions">
                        <button class="mini-btn" data-action="confirm-good" data-id="${escapeHtml(item.id)}">确认可访问</button>
                        <button class="mini-btn danger" data-action="confirm-bad" data-id="${escapeHtml(item.id)}">确认失效</button>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}
            ${confirmedBad.length > 0 ? `
              <div class="url-section ${confirmedSectionClass}">
                <div class="url-section-title">
                  <button
                    class="section-toggle"
                    data-action="toggle-section"
                    data-section="confirmed"
                    aria-expanded="${String(!sectionCollapsed.confirmed)}"
                  >
                    <span>已确认失效 (${confirmedBad.length})</span>
                    <span class="toggle-icon">▾</span>
                  </button>
                  <button class="mini-btn danger" data-action="delete-all-bad">删除全部失效</button>
                </div>
                <div class="url-list">
                  ${confirmedBad.map(item => `
                    <div class="url-item">
                      <div class="url-title">${escapeHtml(item.title)}</div>
                      <a href="${escapeHtml(item.url)}" target="_blank" class="url-link">
                        ${escapeHtml(item.url)}
                      </a>
                      <div class="url-badge bad">已确认失效</div>
                      <div class="url-actions">
                        <button class="mini-btn danger" data-action="delete" data-id="${escapeHtml(item.id)}">删除书签</button>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}
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

    const updateCountsForStateChange = (item, nextState) => {
      const prevState = item.state;
      if (prevState === nextState) return;
      if (prevState === 'unverified') unverifiedBookmarks--;
      if (prevState === 'confirmed_bad') confirmedBadBookmarks--;
      if (prevState === 'confirmed_good') verifiedBookmarks--;
      if (nextState === 'unverified') unverifiedBookmarks++;
      if (nextState === 'confirmed_bad') confirmedBadBookmarks++;
      if (nextState === 'confirmed_good') verifiedBookmarks++;
      item.state = nextState;
    };

    const removeInvalidItem = (itemId) => {
      const index = invalidUrls.findIndex(item => item.id === itemId);
      if (index === -1) return;
      const item = invalidUrls[index];
      updateCountsForStateChange(item, 'removed');
      invalidUrls.splice(index, 1);
      invalidUrlById.delete(itemId);
    };

    const removeInvalidItemSilently = (itemId) => {
      const index = invalidUrls.findIndex(item => item.id === itemId);
      if (index === -1) return;
      invalidUrls.splice(index, 1);
      invalidUrlById.delete(itemId);
    };

    // 事件委托处理按钮行为
    resultDiv.onclick = async (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      const itemId = button.dataset.id;
      const section = button.dataset.section;

      if (action === 'toggle-section') {
        if (!section || !(section in sectionCollapsed)) return;
        sectionCollapsed[section] = !sectionCollapsed[section];
        renderUnverifiedList();
        return;
      }

      if (action === 'confirm-good' || action === 'confirm-bad') {
        const item = invalidUrlById.get(itemId);
        if (!item) return;
        if (action === 'confirm-good') {
          updateCountsForStateChange(item, 'confirmed_good');
          removeInvalidItemSilently(itemId);
        } else {
          updateCountsForStateChange(item, 'confirmed_bad');
        }
        updateStats();
        return;
      }

      if (action === 'delete') {
        const item = invalidUrlById.get(itemId);
        if (!item) return;
        chrome.bookmarks.remove(itemId, () => {
          if (chrome.runtime.lastError) {
            console.error('删除书签失败:', chrome.runtime.lastError.message);
            return;
          }
          totalBookmarks--;
          removeInvalidItem(itemId);
          updateStats();
        });
        return;
      }

      if (action === 'delete-all-bad') {
        const toDelete = invalidUrls.filter(item => item.state === 'confirmed_bad');
        if (toDelete.length === 0) return;
        Promise.all(toDelete.map(item => new Promise((resolve) => {
          chrome.bookmarks.remove(item.id, () => {
            resolve();
          });
        }))).then(() => {
          totalBookmarks -= toDelete.length;
          toDelete.forEach(item => removeInvalidItem(item.id));
          updateStats();
        });
      }
    };

    // 修复：将updateStats提前
    function updateStats() {
      const stats = document.querySelector('.stats');
      if (stats) {
        const progress = totalBookmarks > 0 ? Math.round((processedBookmarks / totalBookmarks) * 100) : 0;
        stats.innerHTML = `
          <p>📖 总书签: <strong>${totalBookmarks}</strong></p>
          <p>✅ 已验证: <span style="color:#7BB662">${verifiedBookmarks}</span></p>
          <p>🟡 待确认: <span style="color:#F1C40F">${unverifiedBookmarks}</span></p>
          <p>❌ 已确认失效: <span style="color:#E74C3C">${confirmedBadBookmarks}</span></p>
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
                      resolve({ ok: false, status: 0, error: chrome.runtime.lastError.message });
                    } else {
                      resolve(result || { ok: false, status: 0, error: '未知错误' });
                    }
                  });
                }),
                timeoutPromise
              ]);
              if (response.ok) {
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
              const item = {
                id: node.id,
                title: node.title,
                url: node.url,
                error: error.message,
                state: 'unverified'
              };
              invalidUrls.push(item);
              invalidUrlById.set(node.id, item);
            }
          });
        } catch (error) {
          unverifiedBookmarks++;
          processedBookmarks++; // 新增：更新已处理数
          updateStats(); // 更新待确认数
          const item = {
            id: node.id,
            title: node.title,
            url: node.url,
            error: error.message,
            state: 'unverified'
          };
          invalidUrls.push(item);
          invalidUrlById.set(node.id, item);
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
    output += `
      <div class="stats">
        <p>📖 总书签: <strong>${totalBookmarks}</strong></p>
        <p>✅ 已验证: <span style="color:#7BB662">${verifiedBookmarks}</span></p>
        <p>🟡 待确认: <span style="color:#F1C40F">${unverifiedBookmarks}</span></p>
        <p>❌ 已确认失效: <span style="color:#E74C3C">${confirmedBadBookmarks}</span></p>
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

    resultDiv.innerHTML = output;
    renderUnverifiedList();

    // 清理数据
    urlMap.clear();
    duplicates.clear();

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
