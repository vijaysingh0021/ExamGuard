if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
      .catch(error => console.error('ExamGuard service worker registration failed.', error));
  });
}
