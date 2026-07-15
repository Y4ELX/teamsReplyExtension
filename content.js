(function () {
  'use strict';

  const CONTAINER_TID   = 'message-actions-container';
  const MORE_TID        = 'message-actions-more';
  const EDIT_TID        = 'message-actions-edit';
  const QUOTED_TID      = 'message-actions-quoted-reply';
  const EXT_TID         = 'teams-ext-quoted-reply';

  const ICON_PATH = `M7.83 8.62a8.8 8.8 0 0 1-.96 2.76 12.06 12.06 0 0 1-2.22 2.77.5.5 0 0 0 .7.7h.02c.74-.75 1.66-1.67 2.38-2.98A10.83 10.83 0 0 0 9 6.5a2.5 2.5 0 1 0-1.17 2.12ZM8 6.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm6.83 2.12a8.8 8.8 0 0 1-.96 2.76 12.06 12.06 0 0 1-2.22 2.77.5.5 0 0 0 .7.7h.02c.74-.75 1.66-1.67 2.38-2.98A10.83 10.83 0 0 0 16 6.5a2.5 2.5 0 1 0-1.17 2.12ZM13.5 8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z`;

  const ICON = `<svg fill="currentColor" aria-hidden="true" width="1em" height="1em"
      viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
    <path d="${ICON_PATH}" fill="currentColor"></path>
  </svg>`;

  /** Dispatches the full pointer+mouse+click sequence that React expects. */
  function fireClick(el) {
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
      const isPointer = type.startsWith('pointer') && window.PointerEvent;
      const EventCtor = isPointer ? window.PointerEvent : window.MouseEvent;
      const event = new EventCtor(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        button: 0,
        buttons: type.endsWith('down') ? 1 : 0,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true
      });
      el.dispatchEvent(event);
    });
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findQuotedReplyItem() {
    const items = [...document.querySelectorAll(`[data-tid="${QUOTED_TID}"]`)];
    return items.find(isVisible);
  }

  /**
   * Opens the overflow menu and clicks "Responder con una cita".
   * @param {Element} moreBtn  – the "Más opciones" anchor/button element
   */
  function triggerQuotedReply(moreBtn) {
    // If the menu is already open, click directly.
    const existing = findQuotedReplyItem();
    if (existing) { fireClick(existing); return; }

    let done = false;
    const clickWhenReady = () => {
      const item = findQuotedReplyItem();
      if (!item) return;
      done = true;
      obs.disconnect();
      clearInterval(poll);
      // Let Teams finish rendering the menu before clicking.
      setTimeout(() => fireClick(item), 80);
    };

    const obs = new MutationObserver(clickWhenReady);
    obs.observe(document.body, { childList: true, subtree: true });
    const poll = setInterval(clickWhenReady, 100);
    setTimeout(() => {
      if (!done) {
        clearInterval(poll);
        obs.disconnect();
      }
    }, 4000);

    // Open the menu after the current call stack clears so our
    // button's own click event finishes bubbling first.
    setTimeout(() => fireClick(moreBtn), 0);
  }

  function findToolbar(container) {
    return container.querySelector('[role="toolbar"][aria-label*="mensaje" i]') ||
           container.querySelector('[role="toolbar"]') ||
           container;
  }

  function copyButtonClasses(btn, container, moreBtn) {
    const source =
      moreBtn ||
      container.querySelector(`[data-tid="${EDIT_TID}"]`) ||
      container.querySelector('.fui-Button');

    const sourceClass = source?.getAttribute('class');
    if (sourceClass) btn.setAttribute('class', sourceClass);
  }

  function getIconClass(container, moreBtn) {
    const icon = moreBtn?.querySelector('.fui-Button__icon') ||
                 container.querySelector('.fui-Button__icon');
    return icon?.getAttribute('class') || 'fui-Button__icon';
  }

  /** Creates and returns the injected toolbar button. */
  function buildButton(container, moreBtn) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-tid', EXT_TID);
    btn.setAttribute('data-track', 'false');
    btn.setAttribute('aria-label', 'Responder con una cita');
    btn.setAttribute('tabindex', moreBtn.getAttribute('tabindex') || '0');
    btn.title = 'Responder con una cita';

    // Borrow Teams' current hover-toolbar button styling. "Editar" is not
    // always present, so "Más opciones" is the safest source.
    copyButtonClasses(btn, container, moreBtn);

    btn.innerHTML = `<span class="${getIconClass(container, moreBtn)}">${ICON}</span>`;
    return btn;
  }

  function injectButton(container) {
    if (container.querySelector(`[data-tid="${EXT_TID}"]`)) return;

    const moreBtn = container.querySelector(`[data-tid="${MORE_TID}"]`);
    if (!moreBtn) return;

    const toolbar = findToolbar(container);
    const btn = buildButton(container, moreBtn);
    const stopToolbarClose = e => e.stopPropagation();

    ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(type => {
      btn.addEventListener(type, stopToolbarClose, true);
    });

    btn.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      triggerQuotedReply(moreBtn);
    }, true);

    const insertParent = moreBtn.parentNode === toolbar ? toolbar : moreBtn.parentNode;
    insertParent.insertBefore(btn, moreBtn);
  }

  function processContainer(container) {
    if (container.querySelector(`[data-tid="${MORE_TID}"]`)) {
      injectButton(container);
      return;
    }
    // Poll up to 3 s for React to finish rendering the toolbar buttons.
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (container.querySelector(`[data-tid="${MORE_TID}"]`)) {
        clearInterval(t);
        injectButton(container);
      } else if (tries >= 30) {
        clearInterval(t);
      }
    }, 100);
  }

  // ── DOM observer ─────────────────────────────────────────────────────────

  new MutationObserver(mutations => {
    for (const { addedNodes } of mutations) {
      for (const node of addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.getAttribute?.('data-tid') === CONTAINER_TID) {
          processContainer(node);
        } else {
          node.querySelectorAll?.(`[data-tid="${CONTAINER_TID}"]`).forEach(processContainer);
        }
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

  // Handle containers already in the DOM at inject time.
  document.querySelectorAll(`[data-tid="${CONTAINER_TID}"]`).forEach(processContainer);

})();
