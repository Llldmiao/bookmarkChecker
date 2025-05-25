// 存储URL验证的Promise
const urlVerificationPromises = new Map();
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
    // 使用fetch直接验证URL
    fetch(url, { 
      method: 'HEAD',
      mode: 'no-cors'
    })
    .then(response => {
      // 对于no-cors模式，response.status总是0
      // 如果请求成功，我们认为是可访问的
      sendResponse({ status: 200 });
    })
    .catch(error => {
      console.error('URL验证失败:', url, error);
      sendResponse({ 
        status: 500, 
        error: error.message || '请求失败'
      });
    });

    // 设置超时
    setTimeout(() => {
      sendResponse({ 
        status: 408, 
        error: '请求超时'
      });
    }, 5000);

    return true; // 保持消息通道开放
  }
});