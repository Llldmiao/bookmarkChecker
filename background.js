console.info('>>>>>>>>>> background');

// 添加点击扩展图标时的处理
chrome.action.onClicked.addListener(() => {
  chrome.windows.create({
    url: 'popup.html',
    type: 'popup',
    focused: true
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'verifyUrl') {
    const { url } = request;
    console.info('> request: ', request);
    let done = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const respondOnce = (payload) => {
      if (done) return;
      done = true;
      clearTimeout(timeoutId);
      sendResponse(payload);
    };

    const isOkStatus = (status) => status >= 200 && status < 400;

    const probe = async (method) => {
      const response = await fetch(url, {
        method,
        redirect: 'follow',
        cache: 'no-store',
        mode: 'cors',
        signal: controller.signal
      });
      return {
        ok: isOkStatus(response.status),
        status: response.status,
        statusText: response.statusText || ''
      };
    };

    (async () => {
      try {
        let result = await probe('HEAD');
        if (!result.ok && (result.status === 0 || result.status === 403 || result.status === 405)) {
          result = await probe('GET');
        }
        if (result.ok) {
          respondOnce({ ok: true, status: result.status });
        } else {
          respondOnce({
            ok: false,
            status: result.status,
            error: result.status ? `HTTP ${result.status}` : (result.statusText || '请求失败')
          });
        }
      } catch (error) {
        console.error('URL验证失败:', url, error);
        const message = error.name === 'AbortError' ? '请求超时' : (error.message || '请求失败');
        respondOnce({ ok: false, status: 0, error: message });
      }
    })();

    return true; // 保持消息通道开放
  }
});
