/*
 * Formalise web mode, page script. Served by src/web/server.ts next to index.html; talks only to
 * the same origin (`/api/config`, `/api/rewrite`). Mirrors the desktop review window: original
 * and result side by side, everything the tool added marked and listed as Formalise's own,
 * missing substance flagged, a Copy button for Formalise only, and never any write-back for
 * Beautify. The text box is never modified by this script: an error or a result leaves what
 * was pasted exactly as it was.
 *
 * Plain JavaScript, no build step, no inline code (the server's Content-Security-Policy allows
 * scripts only from files it serves). All data goes into the DOM through textContent.
 */
(function () {
  'use strict';

  const LABELS = {
    formalise: {
      original: 'What you wrote',
      result: 'Professional version',
      loading: 'Asking Claude for a professional version…',
      additions: 'Added by Formalise, not in your words (check before sending)',
      reasoning: 'Reason invented by Formalise. You never said this; make sure it is true.',
      framing: 'Framing added by Formalise',
      addedMark: 'Added by Formalise',
      missing: 'Missing from the professional version',
      missingHelp:
        'Your original said this and the rewrite does not. Rewrite again, or edit after copying.',
      copy: 'Copy result',
      copied: 'Copied. Paste it where you were writing; your original above is untouched.',
      copyFailed:
        'Could not copy automatically on this connection. Select the professional version and copy it yourself.',
    },
    beautify: {
      original: 'What they actually wrote',
      result: 'Softer reading',
      loading: 'Asking Claude for a softer reading…',
      additions: 'Added by Formalise, not by them',
      addedMark: 'Added by Formalise',
      missing: 'Missing from the softer reading',
      missingHelp: 'They said this and the softer reading does not. Read the original for it.',
      noWriteBack: 'Shown here only. Nothing is written back.',
    },
  };

  const NETWORK_FAILED =
    'Could not reach the computer running this page. Check that the server is still running and try again. Your text is untouched.';

  /** Create an element with attributes and children (strings become text nodes). */
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (name) {
        const value = attrs[name];
        if (value === undefined || value === null || value === false) {
          return;
        }
        if (name === 'className') {
          node.className = value;
        } else if (name === 'textContent') {
          node.textContent = value;
        } else {
          node.setAttribute(name, value === true ? '' : String(value));
        }
      });
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined) {
        return;
      }
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function replaceChildren(parent, children) {
    while (parent.firstChild) {
      parent.removeChild(parent.firstChild);
    }
    children.forEach(function (child) {
      parent.appendChild(child);
    });
  }

  /** The two panes: the original always on the left, `resultNode` on the right. */
  function panes(direction, original, resultNode) {
    const labels = LABELS[direction];
    return el('section', { className: 'review__panes' }, [
      el('article', { className: 'pane pane--original', 'aria-label': labels.original }, [
        el('h2', null, [labels.original]),
        el('pre', { className: 'pane__text', 'data-testid': direction + '-original' }, [original]),
      ]),
      el('article', { className: 'pane', 'aria-label': labels.result }, [
        el('h2', null, [labels.result]),
        resultNode,
      ]),
    ]);
  }

  function heading(direction) {
    return el('header', { className: 'review__header' }, [
      el('h2', { className: 'review__title' }, [
        direction === 'beautify' ? 'Beautify' : 'Formalise',
      ]),
      direction === 'beautify'
        ? el('p', { className: 'review__hint' }, [LABELS.beautify.noWriteBack])
        : null,
    ]);
  }

  function renderLoading(container, direction, original) {
    const pending = el('p', { className: 'pane__empty', role: 'status', 'aria-busy': 'true' }, [
      LABELS[direction].loading,
    ]);
    replaceChildren(container, [heading(direction), panes(direction, original, pending)]);
    container.setAttribute('data-direction', direction);
    container.setAttribute('data-status', 'loading');
  }

  function renderError(container, direction, original, message) {
    const failed = el('p', { className: 'pane__empty pane__error', role: 'alert' }, [message]);
    replaceChildren(container, [heading(direction), panes(direction, original, failed)]);
    container.setAttribute('data-direction', direction);
    container.setAttribute('data-status', 'error');
  }

  /** The result with every addition marked inline as the tool's (PLAN.md §3). */
  function resultText(direction, body) {
    const reasoning = new Set(body.reasoning || []);
    const segments =
      Array.isArray(body.segments) && body.segments.length > 0
        ? body.segments
        : [{ text: body.output, added: false }];
    return el(
      'pre',
      { className: 'pane__text', 'data-testid': direction + '-result' },
      segments.map(function (segment) {
        if (!segment.added) {
          return el('span', null, [segment.text]);
        }
        const invented = reasoning.has(segment.text);
        return el(
          'mark',
          {
            className: invented ? 'tool-added tool-added--reasoning' : 'tool-added',
            'data-added-by': 'formalise',
            title: invented ? LABELS.formalise.reasoning : LABELS[direction].addedMark,
          },
          [segment.text],
        );
      }),
    );
  }

  function missingSection(direction, missing) {
    if (!Array.isArray(missing) || missing.length === 0) {
      return null;
    }
    const labels = LABELS[direction];
    return el('section', { className: 'missing', role: 'alert', 'aria-label': labels.missing }, [
      el('h2', null, [labels.missing]),
      el(
        'ul',
        null,
        missing.map(function (item) {
          return el('li', null, [
            el('span', { className: 'missing__kind' }, [String(item.kind)]),
            ' ' + String(item.text),
          ]);
        }),
      ),
      el('p', { className: 'missing__help' }, [labels.missingHelp]),
    ]);
  }

  function list(items) {
    return el(
      'ul',
      null,
      items.map(function (text) {
        return el('li', null, [text]);
      }),
    );
  }

  /** Everything the tool added, listed apart and attributed to it; invented reasons louder. */
  function additionsSection(direction, body) {
    const additions = Array.isArray(body.additions) ? body.additions : [];
    if (additions.length === 0) {
      return null;
    }
    const labels = LABELS[direction];
    const reasoning = direction === 'formalise' ? body.reasoning || [] : [];
    const reasoningSet = new Set(reasoning);
    const framing = additions.filter(function (text) {
      return !reasoningSet.has(text);
    });
    const children = [el('h2', null, [labels.additions])];
    if (reasoning.length > 0) {
      children.push(
        el('div', { className: 'additions__reasoning', 'data-testid': 'formalise-reasoning' }, [
          el('h3', null, [LABELS.formalise.reasoning]),
          el(
            'ul',
            null,
            reasoning.map(function (text) {
              return el('li', null, [
                el('mark', { className: 'tool-added tool-added--reasoning' }, [text]),
              ]);
            }),
          ),
        ]),
      );
    }
    if (framing.length > 0) {
      children.push(
        el('div', { className: 'additions__framing', 'data-testid': direction + '-framing' }, [
          reasoning.length > 0 ? el('h3', null, [LABELS.formalise.framing]) : null,
          list(framing),
        ]),
      );
    }
    return el('aside', { className: 'additions', 'aria-label': labels.additions }, children);
  }

  /** Copy for Formalise only. Falls back to a selection copy where the Clipboard API is absent
   * (plain http on a LAN address is not a secure context). */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(
        function () {
          return true;
        },
        function () {
          return legacyCopy(text);
        },
      );
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    const scratch = el('textarea', { readonly: true, 'aria-hidden': 'true' });
    scratch.value = text;
    scratch.style.position = 'fixed';
    scratch.style.top = '0';
    scratch.style.left = '0';
    scratch.style.opacity = '0';
    document.body.appendChild(scratch);
    scratch.focus();
    scratch.select();
    let ok;
    try {
      ok = document.execCommand('copy');
    } catch (_error) {
      ok = false;
    }
    document.body.removeChild(scratch);
    return ok === true;
  }

  function copyControls(output) {
    const status = el('p', { className: 'copy__status', role: 'status' });
    const button = el(
      'button',
      { type: 'button', className: 'button button--primary', 'data-testid': 'formalise-copy' },
      [LABELS.formalise.copy],
    );
    button.addEventListener('click', function () {
      copyText(output).then(function (ok) {
        status.textContent = ok ? LABELS.formalise.copied : LABELS.formalise.copyFailed;
        status.className = ok ? 'copy__status notice' : 'copy__status pane__error';
      });
    });
    return el('div', { className: 'copy' }, [button, status]);
  }

  function renderResult(container, direction, original, body) {
    const children = [
      heading(direction),
      panes(direction, original, resultText(direction, body)),
      missingSection(direction, body.substance && body.substance.missing),
      additionsSection(direction, body),
    ];
    if (direction === 'formalise') {
      children.push(copyControls(body.output));
    } else {
      children.push(el('p', { className: 'result__note' }, [LABELS.beautify.noWriteBack]));
    }
    replaceChildren(
      container,
      children.filter(function (child) {
        return child !== null;
      }),
    );
    container.setAttribute('data-direction', direction);
    container.setAttribute('data-status', 'ready');
  }

  /** The message for a failed `/api/rewrite`, in plain words, from the server's JSON when it
   * sent any. */
  function errorMessage(response) {
    return response
      .json()
      .then(function (body) {
        if (body && typeof body.error === 'string' && body.error !== '') {
          return body.error;
        }
        return 'The host answered with status ' + response.status + '. Your text is untouched.';
      })
      .catch(function () {
        return 'The host answered with status ' + response.status + '. Your text is untouched.';
      });
  }

  function init() {
    const form = document.getElementById('rewrite-form');
    const textarea = document.getElementById('text');
    const counter = document.getElementById('counter');
    const button = document.getElementById('rewrite');
    const result = document.getElementById('result');
    if (!form || !textarea || !counter || !button || !result) {
      return;
    }

    let maxChars = null;
    let busy = false;

    function selectedDirection() {
      const checked = form.querySelector('input[name="direction"]:checked');
      return checked && checked.value === 'beautify' ? 'beautify' : 'formalise';
    }

    function updateCounter() {
      const length = textarea.value.length;
      const over = maxChars !== null && length > maxChars;
      counter.textContent = maxChars === null ? String(length) : length + ' / ' + maxChars;
      counter.classList.toggle('compose__counter--over', over);
      button.disabled = busy || over;
      button.title = over ? 'Shorten the text to ' + maxChars + ' characters or fewer.' : '';
    }

    fetch('/api/config', { headers: { Accept: 'application/json' } })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (config) {
        if (config && typeof config.maxInputChars === 'number') {
          maxChars = config.maxInputChars;
        }
        updateCounter();
      })
      .catch(function () {
        updateCounter();
      });

    textarea.addEventListener('input', updateCounter);
    updateCounter();

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (busy) {
        return;
      }
      const direction = selectedDirection();
      const text = textarea.value;
      if (text.trim() === '') {
        renderError(result, direction, text, 'Paste some text first; there is nothing to rewrite.');
        return;
      }
      if (maxChars !== null && text.length > maxChars) {
        updateCounter();
        return;
      }

      busy = true;
      updateCounter();
      renderLoading(result, direction, text);

      fetch('/api/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ text: text, direction: direction }),
      })
        .then(function (response) {
          if (!response.ok) {
            return errorMessage(response).then(function (message) {
              renderError(result, direction, text, message);
            });
          }
          return response.json().then(function (body) {
            if (!body || typeof body.output !== 'string' || body.output === '') {
              renderError(
                result,
                direction,
                text,
                'The host returned no result. Your text is untouched.',
              );
              return;
            }
            renderResult(result, direction, text, body);
          });
        })
        .catch(function () {
          renderError(result, direction, text, NETWORK_FAILED);
        })
        .then(function () {
          busy = false;
          updateCounter();
        });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
