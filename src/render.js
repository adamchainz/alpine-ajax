import { Alpine } from './helpers'

let queue = {}

let renderElement

export function setRenderer(renderer) {
  renderElement = renderer || (from => {
    console.warn(`You can't use Alpine AJAX without first installing the "morph" plugin here: https://alpinejs.dev/plugins/morph`)
    return from
  })
}

export async function render(request, ids, el, events = true) {
  let dispatch = (name, detail = {}) => {
    return el.dispatchEvent(
      new CustomEvent(name, {
        detail,
        bubbles: true,
        composed: true,
        cancelable: true,
      })
    )
  }

  if (!events) {
    dispatch = () => true
  }

  if (!dispatch('ajax:before')) return

  ids.forEach(id => {
    let busy = document.getElementById(id)
    if (busy) busy.setAttribute('aria-busy', 'true')
  })

  let response = await send(request)
  if (response.ok) {
    dispatch('ajax:success', response)
  } else {
    dispatch('ajax:error', response)
  }

  dispatch('ajax:after', response)

  if (!response.html) return

  let fragment = document.createRange().createContextualFragment(response.html)
  let targets = ids.map(id => {
    let template = fragment.getElementById(id)
    let target = document.getElementById(id)
    if (!template) {
      if (!dispatch('ajax:missing', response)) {
        return
      }

      if (!target.hasAttribute('x-sync')) {
        console.warn(`Target #${id} not found in AJAX response.`)
      }

      if (response.ok) {
        return renderElement(target, target.cloneNode(false))
      }

      return window.location.href = response.url
    }

    renderElement(target, template)

    let freshEl = document.getElementById(id);
    freshEl.dataset.source = response.url

    return freshEl
  })

  let focus = Alpine.bound(el, 'focus')
  if (focus !== undefined) {
    if (targets.length && typeof focus === 'string') {
      focusOn(targets[0].querySelector(Alpine.bound(el, 'focus')))
    } else {
      focusOn(focus)
    }
  }

  return targets
}

async function send({ method, action, body, referrer }) {
  // When duplicate `GET` requests are issued we'll proxy
  // the initial request to save network roundtrips.
  let proxy
  let onSuccess = response => response
  let onError = error => error
  if (method === 'GET') {
    proxy = enqueue(action)
    if (isLocked(action)) {
      return proxy
    }
    onSuccess = response => dequeue(action, job => job.resolve(response))
    onError = error => dequeue(action, job => job.reject(error))
  }

  referrer = referrer || window.location.href

  let response = fetch(action, {
    headers: { 'X-Alpine-Request': 'true' },
    referrer,
    method,
    body,
  }).then(readHtml).then(onSuccess).catch(onError)

  return method === 'GET' ? proxy : response
}

function enqueue(key) {
  if (!queue[key]) {
    queue[key] = []
  }
  let job = {}
  let proxy = new Promise((resolve, reject) => {
    job.resolve = resolve
    job.reject = reject
  })
  queue[key].push(job)

  return proxy
}

function isLocked(key) {
  return queue[key].length > 1
}

function dequeue(key, resolver) {
  (queue[key] || []).forEach(resolver)
  queue[key] = undefined
}

function readHtml(response) {
  return response.text().then(html => {
    response.html = html
    return response
  })
}

function focusOn(el) {
  setTimeout(() => {
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0')
    el.focus()
  }, 0);
}