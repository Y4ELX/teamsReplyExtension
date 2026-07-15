(function () {
  'use strict';

  const MESSAGE_TID = 'chat-pane-message';
  const CONTAINER_TID = 'message-actions-container';
  const HIDDEN_MORE_TID = 'message-actions-menu-hidden-button';
  const MORE_TID = 'message-actions-more';
  const QUOTED_TID = 'message-actions-quoted-reply';
  const EXT_TID = 'teams-ext-quoted-reply';
  const STYLE_ID = 'teams-ext-quoted-reply-style';
  const BUTTON_SIZE = 30;
  const BUTTON_GAP = 8;
  const REQUEST_TIMEOUT_MS = 2200;
  const HOVER_OPEN_DELAY_MS = 500;
  const HIDDEN_FALLBACK_WINDOW_MS = 650;

  let activeRequest = null;

  const ICON_PATH = `M7.83 8.62a8.8 8.8 0 0 1-.96 2.76 12.06 12.06 0 0 1-2.22 2.77.5.5 0 0 0 .7.7h.02c.74-.75 1.66-1.67 2.38-2.98A10.83 10.83 0 0 0 9 6.5a2.5 2.5 0 1 0-1.17 2.12ZM8 6.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm6.83 2.12a8.8 8.8 0 0 1-.96 2.76 12.06 12.06 0 0 1-2.22 2.77.5.5 0 0 0 .7.7h.02c.74-.75 1.66-1.67 2.38-2.98A10.83 10.83 0 0 0 16 6.5a2.5 2.5 0 1 0-1.17 2.12ZM13.5 8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z`;

  const ICON = `<svg fill="currentColor" aria-hidden="true" width="1em" height="1em"
      viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
    <path d="${ICON_PATH}" fill="currentColor"></path>
  </svg>`;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .teams-ext-quoted-reply-host {
        overflow: visible !important;
        position: relative !important;
      }

      [data-tid="${EXT_TID}"] {
        align-items: center !important;
        background: transparent !important;
        border: 0 !important;
        border-radius: 6px !important;
        box-shadow: none !important;
        color: #454545 !important;
        cursor: pointer !important;
        display: inline-flex !important;
        height: ${BUTTON_SIZE}px !important;
        justify-content: center !important;
        min-width: ${BUTTON_SIZE}px !important;
        opacity: 0.92 !important;
        padding: 0 !important;
        position: absolute !important;
        transition: background-color 120ms ease, color 120ms ease, opacity 120ms ease !important;
        width: ${BUTTON_SIZE}px !important;
        z-index: 10 !important;
      }

      [data-tid="${EXT_TID}"]:hover,
      [data-tid="${EXT_TID}"]:focus-visible {
        background: transparent !important;
        color: #ffffff !important;
        opacity: 1 !important;
      }

      [data-tid="${EXT_TID}"] .teams-ext-quoted-reply-icon {
        align-items: center;
        display: inline-flex;
        font-size: 19px;
        height: 20px;
        justify-content: center;
        width: 20px;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function fireEvent(el, type, options = {}) {
    const isPointer = type.startsWith('pointer') && window.PointerEvent;
    const EventCtor = isPointer ? window.PointerEvent : window.MouseEvent;
    const event = new EventCtor(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      buttons: type.endsWith('down') ? 1 : 0,
      clientX: options.clientX || 0,
      clientY: options.clientY || 0,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true
    });
    el.dispatchEvent(event);
  }

  function fireClick(el) {
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
      fireEvent(el, type);
    });
  }

  function fireHover(message) {
    const content = findMessageContent(message);
    const rect = content.getBoundingClientRect();
    const point = {
      clientX: rect.left + Math.min(rect.width / 2, 80),
      clientY: rect.top + rect.height / 2
    };

    [message, content].forEach(el => {
      ['pointerover', 'mouseover', 'pointerenter', 'mouseenter', 'pointermove', 'mousemove'].forEach(type => {
        fireEvent(el, type, point);
      });
    });
  }

  function fireKey(el, key, options = {}) {
    ['keydown', 'keyup'].forEach(type => {
      el.dispatchEvent(new KeyboardEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        key,
        code: options.code || key,
        shiftKey: Boolean(options.shiftKey),
        view: window
      }));
    });
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getMessageKey(message) {
    return message.getAttribute('data-mid') ||
           message.id?.match(/^message-body-(.+)$/)?.[1] ||
           null;
  }

  function getElementSignature(el) {
    return [
      el.id,
      el.getAttribute('aria-labelledby'),
      el.getAttribute('data-tabster')
    ].filter(Boolean).join(' ');
  }

  function elementBelongsToMessage(el, message) {
    const messageKey = getMessageKey(message);
    if (!messageKey) return true;

    return getElementSignature(el).includes(messageKey);
  }

  function rectGap(a, b) {
    const horizontal = Math.max(0, a.left - b.right, b.left - a.right);
    const vertical = Math.max(0, a.top - b.bottom, b.top - a.bottom);
    return { horizontal, vertical };
  }

  function menuIsNearMessage(menu, message) {
    const messageRect = findMessageContent(message).getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const gap = rectGap(messageRect, menuRect);

    return gap.vertical <= Math.max(180, messageRect.height + 120) &&
           gap.horizontal <= 620;
  }

  function cssEscape(value) {
    return window.CSS?.escape ? window.CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
  }

  function findQuotedReplyItemForRequest(request) {
    const { openedBy, message } = request;

    if (!openedBy) return;

    if (openedBy.id) {
      const menu = document.querySelector(`[role="menu"][aria-labelledby="${cssEscape(openedBy.id)}"]`);
      const item = menu?.querySelector(`[data-tid="${QUOTED_TID}"]`);
      if (item && isVisible(item)) return item;
    }

    const messageRect = message.getBoundingClientRect();
    const messageCenterX = messageRect.left + messageRect.width / 2;
    const messageCenterY = messageRect.top + messageRect.height / 2;

    return [...document.querySelectorAll(`[data-tid="${QUOTED_TID}"]`)]
      .filter(isVisible)
      .map(item => {
        const menu = item.closest('[role="menu"]') || item;
        if (!menuIsNearMessage(menu, message)) return null;

        const rect = menu.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const distance = Math.hypot(centerX - messageCenterX, centerY - messageCenterY);
        return { item, distance };
      })
      .filter(Boolean)
      .filter(({ distance }) => distance < 360)
      .sort((a, b) => a.distance - b.distance)[0]?.item;
  }

  function findHiddenMoreButton(message) {
    return message.querySelector(`[data-tid="${HIDDEN_MORE_TID}"]`);
  }

  function findMessageContent(message) {
    return message.querySelector('[data-message-content]') ||
           message.querySelector('[id^="content-"]') ||
           message;
  }

  function getInjectedButton(message) {
    return [...message.children].find(child => child.getAttribute?.('data-tid') === EXT_TID);
  }

  function cleanupRequest(request) {
    request.cancelled = true;
    request.observer?.disconnect();
    request.intervals.forEach(clearInterval);
    request.timers.forEach(clearTimeout);
  }

  function createRequest() {
    if (activeRequest) cleanupRequest(activeRequest);

    activeRequest = {
      cancelled: false,
      intervals: [],
      timers: [],
      observer: null,
      message: null,
      openedBy: null,
      openedBySource: null
    };

    activeRequest.timers.push(setTimeout(() => {
      if (activeRequest) {
        cleanupRequest(activeRequest);
        activeRequest = null;
      }
    }, REQUEST_TIMEOUT_MS));

    return activeRequest;
  }

  function findHoverMoreButtonForMessage(message) {
    const messageRect = findMessageContent(message).getBoundingClientRect();
    const messageCenterX = messageRect.left + messageRect.width / 2;
    const messageCenterY = messageRect.top + messageRect.height / 2;

    return [...document.querySelectorAll(`[data-tid="${CONTAINER_TID}"]`)]
      .filter(isVisible)
      .filter(container => elementBelongsToMessage(container, message))
      .map(container => {
        const moreBtn = container.querySelector(`[data-tid="${MORE_TID}"]`);
        if (!moreBtn || !isVisible(moreBtn)) return null;

        const rect = container.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const distance = Math.hypot(centerX - messageCenterX, centerY - messageCenterY);
        return { moreBtn, distance };
      })
      .filter(Boolean)
      .filter(({ distance }) => distance < 420)
      .sort((a, b) => a.distance - b.distance)[0]?.moreBtn;
  }

  function clickQuotedWhenReady(request) {
    if (request.cancelled || !request.openedBy) return;

    const item = findQuotedReplyItemForRequest(request);
    if (!item) return;

    cleanupRequest(request);
    if (activeRequest === request) activeRequest = null;
    setTimeout(() => fireClick(item), 80);
  }

  function openQuotedReply(message) {
    const request = createRequest();
    request.message = message;

    const watchForQuotedItem = () => clickQuotedWhenReady(request);
    request.observer = new MutationObserver(watchForQuotedItem);
    request.observer.observe(document.body, { childList: true, subtree: true });
    request.intervals.push(setInterval(watchForQuotedItem, 80));

    const tryOpenHoverMenu = () => {
      if (request.cancelled) return;

      fireHover(message);
      message.focus?.({ preventScroll: true });

      const hoverMoreBtn = findHoverMoreButtonForMessage(message);
      if (!hoverMoreBtn) return;

      request.openedBy = hoverMoreBtn;
      request.openedBySource = 'hover';
      fireClick(hoverMoreBtn);
      request.intervals.forEach(clearInterval);
      request.intervals = [setInterval(watchForQuotedItem, 80)];
    };

    request.intervals.push(setInterval(tryOpenHoverMenu, 80));
    request.timers.push(setTimeout(() => {
      if (request.cancelled || request.openedBy) return;

      const hiddenMoreBtn = findHiddenMoreButton(message);
      if (!hiddenMoreBtn?.isConnected) return;

      request.openedBy = hiddenMoreBtn;
      request.openedBySource = 'hidden';
      request.intervals.forEach(clearInterval);
      request.intervals = [setInterval(watchForQuotedItem, 80)];

      fireHover(message);
      message.focus?.({ preventScroll: true });
      fireClick(hiddenMoreBtn);
      hiddenMoreBtn.click?.();
      fireKey(hiddenMoreBtn, 'Enter');

      request.timers.push(setTimeout(() => {
        if (request.cancelled || activeRequest !== request) return;

        cleanupRequest(request);
        activeRequest = null;
      }, HIDDEN_FALLBACK_WINDOW_MS));
    }, HOVER_OPEN_DELAY_MS));
  }

  function positionButton(message, btn) {
    const content = findMessageContent(message);
    const messageRect = message.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    if (!messageRect.width || !contentRect.width) return;

    const x = contentRect.right - messageRect.left + BUTTON_GAP;
    const y = contentRect.top - messageRect.top + contentRect.height / 2 - BUTTON_SIZE / 2;

    btn.style.left = `${Math.round(x)}px`;
    btn.style.top = `${Math.round(y)}px`;
  }

  function buildButton(message) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.tid = EXT_TID;
    btn.dataset.track = 'false';
    btn.setAttribute('aria-label', 'Responder con una cita');
    btn.title = 'Responder con una cita';
    btn.innerHTML = `<span class="teams-ext-quoted-reply-icon">${ICON}</span>`;

    ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(type => {
      btn.addEventListener(type, e => e.stopPropagation(), true);
    });

    btn.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();

      openQuotedReply(message);
    }, true);

    message.appendChild(btn);
    return btn;
  }

  function processMessage(message) {
    if (!(message instanceof Element)) return;
    if (message.getAttribute('data-tid') !== MESSAGE_TID) return;

    ensureStyle();

    const moreBtn = findHiddenMoreButton(message);
    if (!moreBtn) return;

    message.classList.add('teams-ext-quoted-reply-host');

    const btn = getInjectedButton(message) || buildButton(message);
    positionButton(message, btn);
    requestAnimationFrame(() => positionButton(message, btn));
  }

  function processNode(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    if (node.getAttribute?.('data-tid') === MESSAGE_TID) {
      processMessage(node);
      return;
    }

    const parentMessage = node.closest?.(`[data-tid="${MESSAGE_TID}"]`);
    if (parentMessage) processMessage(parentMessage);

    node.querySelectorAll?.(`[data-tid="${MESSAGE_TID}"]`).forEach(processMessage);
  }

  let updateQueued = false;
  function updateVisibleButtons() {
    if (updateQueued) return;
    updateQueued = true;

    requestAnimationFrame(() => {
      updateQueued = false;
      document.querySelectorAll(`[data-tid="${MESSAGE_TID}"]`).forEach(processMessage);
    });
  }

  new MutationObserver(mutations => {
    for (const { addedNodes } of mutations) {
      for (const node of addedNodes) processNode(node);
    }
  }).observe(document.body, { childList: true, subtree: true });

  window.addEventListener('resize', updateVisibleButtons, { passive: true });
  document.addEventListener('scroll', updateVisibleButtons, true);

  document.querySelectorAll(`[data-tid="${MESSAGE_TID}"]`).forEach(processMessage);

})();
