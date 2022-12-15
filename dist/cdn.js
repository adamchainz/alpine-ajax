(function (factory) {
  typeof define === 'function' && define.amd ? define(factory) :
  factory();
}((function () { 'use strict';

  /*
   * SubmitEvent API Submitter Polyfill
   * https://stackoverflow.com/a/61110260
   */
  !function () {
    var lastBtn = null;
    document.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      lastBtn = e.target.closest('button, input[type=submit]');
    }, true);
    document.addEventListener('submit', function (e) {
      if ('submitter' in e) return;
      var canditates = [document.activeElement, lastBtn];
      lastBtn = null;

      for (var i = 0; i < canditates.length; i++) {
        var candidate = canditates[i];
        if (!candidate) continue;
        if (!candidate.form) continue;
        if (!candidate.matches('button, input[type=button], input[type=image]')) continue;
        e.submitter = candidate;
        return;
      }

      e.submitter = e.target.querySelector('button, input[type=button], input[type=image]');
    }, true);
  }();

  class DomManager {
      el = undefined

      constructor(el) {
          this.el = el;
      }

      traversals = {
          'first': 'firstElementChild',
          'next': 'nextElementSibling',
          'parent': 'parentElement',
      }

      nodes() {
          this.traversals = {
              'first': 'firstChild',
              'next': 'nextSibling',
              'parent': 'parentNode',
          }; return this
      }

      first() {
          return this.teleportTo(this.el[this.traversals['first']])
      }

      next() {
          return this.teleportTo(this.teleportBack(this.el[this.traversals['next']]))
      }

      before(insertee) {
          this.el[this.traversals['parent']].insertBefore(insertee, this.el); return insertee
      }

      replace(replacement) {
          this.el[this.traversals['parent']].replaceChild(replacement, this.el); return replacement
      }

      append(appendee) {
          this.el.appendChild(appendee); return appendee
      }

      teleportTo(el) {
          if (! el) return el
          if (el._x_teleport) return el._x_teleport
          return el
      }

      teleportBack(el) {
          if (! el) return el
          if (el._x_teleportBack) return el._x_teleportBack
          return el
      }
  }

  function dom(el) {
      return new DomManager(el)
  }

  function createElement(html) {
      const template = document.createElement('template');
      template.innerHTML = html;
      return template.content.firstElementChild
  }

  function textOrComment(el) {
      return el.nodeType === 3
          || el.nodeType === 8
  }

  let resolveStep = () => {};

  let logger = () => {};

  async function morph(from, toHtml, options) {
      // We're defining these globals and methods inside this function (instead of outside)
      // because it's an async function and if run twice, they would overwrite
      // each other.

      let fromEl;
      let toEl;
      let key
          ,lookahead
          ,updating
          ,updated
          ,removing
          ,removed
          ,adding
          ,added
          ,debug;


      function breakpoint(message) {
          if (! debug) return

          logger((message || '').replace('\n', '\\n'), fromEl, toEl);

          return new Promise(resolve => resolveStep = () => resolve())
      }

      function assignOptions(options = {}) {
          let defaultGetKey = el => el.getAttribute('key');
          let noop = () => {};

          updating = options.updating || noop;
          updated = options.updated || noop;
          removing = options.removing || noop;
          removed = options.removed || noop;
          adding = options.adding || noop;
          added = options.added || noop;
          key = options.key || defaultGetKey;
          lookahead = options.lookahead || false;
          debug = options.debug || false;
      }

      async function patch(from, to) {
          // This is a time saver, however, it won't catch differences in nested <template> tags.
          // I'm leaving this here as I believe it's an important speed improvement, I just
          // don't see a way to enable it currently:
          //
          // if (from.isEqualNode(to)) return

          if (differentElementNamesTypesOrKeys(from, to)) {
              let result = patchElement(from, to);

              await breakpoint('Swap elements');

              return result
          }

          let updateChildrenOnly = false;

          if (shouldSkip(updating, from, to, () => updateChildrenOnly = true)) return

          window.Alpine && initializeAlpineOnTo(from, to);

          if (textOrComment(to)) {
              await patchNodeValue(from, to);
              updated(from, to);

              return
          }

          if (! updateChildrenOnly) {
              await patchAttributes(from, to);
          }

          updated(from, to);

          await patchChildren(from, to);
      }

      function differentElementNamesTypesOrKeys(from, to) {
          return from.nodeType != to.nodeType
              || from.nodeName != to.nodeName
              || getKey(from) != getKey(to)
      }

      function patchElement(from, to) {
          if (shouldSkip(removing, from)) return

          let toCloned = to.cloneNode(true);

          if (shouldSkip(adding, toCloned)) return

          dom(from).replace(toCloned);

          removed(from);
          added(toCloned);
      }

      async function patchNodeValue(from, to) {
          let value = to.nodeValue;

          if (from.nodeValue !== value) {
              from.nodeValue = value;

              await breakpoint('Change text node to: ' + value);
          }
      }

      async function patchAttributes(from, to) {
          if (from._x_isShown && ! to._x_isShown) {
              return
          }
          if (! from._x_isShown && to._x_isShown) {
              return
          }

          let domAttributes = Array.from(from.attributes);
          let toAttributes = Array.from(to.attributes);

          for (let i = domAttributes.length - 1; i >= 0; i--) {
              let name = domAttributes[i].name;

              if (! to.hasAttribute(name)) {
                  from.removeAttribute(name);

                  await breakpoint('Remove attribute');
              }
          }

          for (let i = toAttributes.length - 1; i >= 0; i--) {
              let name = toAttributes[i].name;
              let value = toAttributes[i].value;

              if (from.getAttribute(name) !== value) {
                  from.setAttribute(name, value);

                  await breakpoint(`Set [${name}] attribute to: "${value}"`);
              }
          }
      }

      async function patchChildren(from, to) {
          let domChildren = from.childNodes;
          let toChildren = to.childNodes;

          keyToMap(toChildren);
          let domKeyDomNodeMap = keyToMap(domChildren);

          let currentTo = dom(to).nodes().first();
          let currentFrom = dom(from).nodes().first();

          let domKeyHoldovers = {};

          while (currentTo) {
              let toKey = getKey(currentTo);
              let domKey = getKey(currentFrom);

              // Add new elements
              if (! currentFrom) {
                  if (toKey && domKeyHoldovers[toKey]) {
                      let holdover = domKeyHoldovers[toKey];

                      dom(from).append(holdover);
                      currentFrom = holdover;

                      await breakpoint('Add element (from key)');
                  } else {
                      let added = addNodeTo(currentTo, from) || {};

                      await breakpoint('Add element: ' + (added.outerHTML || added.nodeValue));

                      currentTo = dom(currentTo).nodes().next();

                      continue
                  }
              }

              if (lookahead) {
                  let nextToElementSibling = dom(currentTo).next();

                  let found = false;

                  while (!found && nextToElementSibling) {
                      if (currentFrom.isEqualNode(nextToElementSibling)) {
                          found = true;

                          currentFrom = addNodeBefore(currentTo, currentFrom);

                          domKey = getKey(currentFrom);

                          await breakpoint('Move element (lookahead)');
                      }

                      nextToElementSibling = dom(nextToElementSibling).next();
                  }
              }

              if (toKey !== domKey) {
                  if (! toKey && domKey) {
                      domKeyHoldovers[domKey] = currentFrom;
                      currentFrom = addNodeBefore(currentTo, currentFrom);
                      domKeyHoldovers[domKey].remove();
                      currentFrom = dom(currentFrom).nodes().next();
                      currentTo = dom(currentTo).nodes().next();

                      await breakpoint('No "to" key');

                      continue
                  }

                  if (toKey && ! domKey) {
                      if (domKeyDomNodeMap[toKey]) {
                          currentFrom = dom(currentFrom).replace(domKeyDomNodeMap[toKey]);

                          await breakpoint('No "from" key');
                      }
                  }

                  if (toKey && domKey) {
                      domKeyHoldovers[domKey] = currentFrom;
                      let domKeyNode = domKeyDomNodeMap[toKey];

                      if (domKeyNode) {
                          currentFrom = dom(currentFrom).replace(domKeyNode);

                          await breakpoint('Move "from" key');
                      } else {
                          domKeyHoldovers[domKey] = currentFrom;
                          currentFrom = addNodeBefore(currentTo, currentFrom);
                          domKeyHoldovers[domKey].remove();
                          currentFrom = dom(currentFrom).next();
                          currentTo = dom(currentTo).next();

                          await breakpoint('Swap elements with keys');

                          continue
                      }
                  }
              }

              // Get next from sibling before patching in case the node is replaced
              let currentFromNext = currentFrom && dom(currentFrom).nodes().next();

              // Patch elements
              await patch(currentFrom, currentTo);

              currentTo = currentTo && dom(currentTo).nodes().next();
              currentFrom = currentFromNext;
          }

          // Cleanup extra froms.
          let removals = [];

          // We need to collect the "removals" first before actually
          // removing them so we don't mess with the order of things.
          while (currentFrom) {
              if(! shouldSkip(removing, currentFrom)) removals.push(currentFrom);

              currentFrom = dom(currentFrom).nodes().next();
          }

          // Now we can do the actual removals.
          while (removals.length) {
              let domForRemoval = removals.shift();

              domForRemoval.remove();

              await breakpoint('remove el');

              removed(domForRemoval);
          }
      }

      function getKey(el) {
          return el && el.nodeType === 1 && key(el)
      }

      function keyToMap(els) {
          let map = {};

          els.forEach(el => {
              let theKey = getKey(el);

              if (theKey) {
                  map[theKey] = el;
              }
          });

          return map
      }

      function addNodeTo(node, parent) {
          if(! shouldSkip(adding, node)) {
              let clone = node.cloneNode(true);

              dom(parent).append(clone);

              added(clone);

              return clone
          }

          return null;
      }

      function addNodeBefore(node, beforeMe) {
          if(! shouldSkip(adding, node)) {
              let clone = node.cloneNode(true);

              dom(beforeMe).before(clone);

              added(clone);

              return clone
          }

          return beforeMe
      }

      // Finally we morph the element

      assignOptions(options);

      fromEl = from;
      toEl = createElement(toHtml);

      // If there is no x-data on the element we're morphing,
      // let's seed it with the outer Alpine scope on the page.
      if (window.Alpine && window.Alpine.closestDataStack && ! from._x_dataStack) {
          toEl._x_dataStack = window.Alpine.closestDataStack(from);

          toEl._x_dataStack && window.Alpine.clone(from, toEl);
      }

      await breakpoint();

      await patch(from, toEl);

      // Release these for the garbage collector.
      fromEl = undefined;
      toEl = undefined;

      return from
  }

  morph.step = () => resolveStep();
  morph.log = (theLogger) => {
      logger = theLogger;
  };

  function shouldSkip(hook, ...args) {
      let skip = false;

      hook(...args, () => skip = true);

      return skip
  }

  function initializeAlpineOnTo(from, to, childrenOnly) {
      if (from.nodeType !== 1) return

      // If the element we are updating is an Alpine component...
      if (from._x_dataStack) {
          // Then temporarily clone it (with it's data) to the "to" element.
          // This should simulate backend Livewire being aware of Alpine changes.
          window.Alpine.clone(from, to);
      }
  }

  function ajax (Alpine) {
    Alpine.directive('ajax', (el, {
      expression
    }, {
      cleanup
    }) => {
      let targets = expression.split(' ').filter(id => id);

      if (targets.length === 0) {
        targets = [el.id];
      }

      progressivelyEnhanceLinks(el);
      let stopListeningForSubmit = listenForSubmit(el, targets);
      let stoplisteningForNavigate = listenForNavigate(el, targets);
      cleanup(() => {
        stopListeningForSubmit();
        stoplisteningForNavigate();
      });
    });
  }

  function progressivelyEnhanceLinks(el) {
    if (el.hasAttribute('noajax') || el.hasAttribute('data-action')) return;
    [el, ...Array.from(el.querySelectorAll('[href]:not([noajax]):not([data-action])'))].forEach(link => {
      if (!isLocalLink(link)) return;
      link.setAttribute('role', 'button');
      link.setAttribute('data-action', link.getAttribute('href'));
      link.tabIndex = 0;
      link.removeAttribute('href');
      link.addEventListener('keydown', event => event.keyCode === 32 && event.target.click());
    });
  }

  function isLocalLink(el) {
    return el.tagName === 'A' && el.getAttribute('href') && el.getAttribute('href').indexOf("#") !== 0 && el.hostname === location.hostname;
  }

  function listenForSubmit(el, targets) {
    let handler = async event => {
      var _event$submitter;

      let form = event.target;
      if (form.hasAttribute('noajax')) return;
      event.preventDefault();
      event.stopPropagation();
      let method = (form.getAttribute('method') || 'GET').toUpperCase();
      let action = form.getAttribute('action') || window.location.href;
      let body = new FormData(form);

      if (event !== null && event !== void 0 && (_event$submitter = event.submitter) !== null && _event$submitter !== void 0 && _event$submitter.name) {
        body.append(event.submitter.name, event.submitter.value);
      }

      let html = await makeRequest(form, method, action, body);
      if (html === false) return;
      replaceTargets(targets, html);
    };

    el.addEventListener('submit', handler);
    return () => el.removeEventListener('submit', handler);
  }

  function listenForNavigate(el, targets) {
    let handler = async event => {
      let link = event.target;
      let action = link.dataset.action;
      if (!action || link.hasAttribute('noajax')) return;
      event.preventDefault();
      event.stopPropagation();
      let html = await makeRequest(link, 'GET', action, null);
      if (html === false) return;
      replaceTargets(targets, html);
    };

    el.addEventListener('click', handler);
    return () => el.removeEventListener('click', handler);
  }

  async function makeRequest(el, method, action, body) {
    if (!dispatch(el, 'ajax:before')) {
      return false;
    }

    if (method === 'GET' && body) {
      let params = Array.from(body.entries()).filter(([key, value]) => value !== '' || value !== null);

      if (params.length) {
        let parts = action.split('#');
        action = parts[0];

        if (!action.includes('?')) {
          action += '?';
        } else {
          action += '&';
        }

        action += new URLSearchParams(params);
        let hash = parts[1];

        if (hash) {
          action += '#' + hash;
        }
      }

      body = null;
    }

    return await fetch(action, {
      headers: {
        'X-Alpine-Request': 'true'
      },
      method,
      body
    }).then(response => {
      dispatch(el, 'ajax:success', response);
      dispatch(el, 'ajax:after', response);
      return response.text();
    }).catch(error => {
      dispatch(el, 'ajax:error', error);
      dispatch(el, 'ajax:after', error);
      return false;
    });
  }

  function dispatch(el, name, detail = {}) {
    return el.dispatchEvent(new CustomEvent(name, {
      detail,
      bubbles: true,
      composed: true,
      cancelable: true
    }));
  }

  function replaceTargets(targets, html) {
    let fragment = htmlToFragment(html);
    targets.forEach(id => morphTarget(id, fragment));
  }

  function htmlToFragment(html) {
    return document.createRange().createContextualFragment(html);
  }

  function morphTarget(id, fragment) {
    var _fragment$getElementB;

    let toHtml = ((_fragment$getElementB = fragment.getElementById(id)) === null || _fragment$getElementB === void 0 ? void 0 : _fragment$getElementB.outerHTML) ?? '';

    if (toHtml) {
      morph(document.getElementById(id), toHtml);
    } else {
      document.getElementById(id).replaceWith('');
    }
  }

  document.addEventListener('alpine:initializing', () => {
    ajax(window.Alpine);
  });

})));