// Session keys in URLs (stage 10, Y3). A key is `<project>[/<sub-project>]::<agent>[::<suffix>]` and goes
// into the PATH of `/api/chat/sessions/<key>/...`, `/api/sessions/<key>/terminate|reset` and the sockets.
// The key of the chat route comes out of the address bar, so a hand-made link can put anything there:
//   - a `.` / `..` segment is a dot-segment: the browser (WHATWG URL) resolves it, also in its `%2e`
//     spelling, so `/api/sessions/../x/terminate` would hit ANOTHER route or ANOTHER conversation;
//   - an empty segment (`a//b`, a leading or trailing slash) is not a key the app ever creates;
//   - `?`, `#`, `\` and control characters change what the URL means.
// Encoding does not help against the first one, so such a key is REFUSED (the route does not exist and no
// request is built); every other segment is encoded on its own and the slashes stay as separators.

// eslint-disable-next-line no-control-regex
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f?#\\]/

export function isSafeSessionKey(sessionKey) {
  if (typeof sessionKey !== 'string' || sessionKey === '') return false
  if (UNSAFE_CHARACTERS.test(sessionKey)) return false
  return sessionKey.split('/').every((segment) => {
    if (segment === '') return false
    // `%2e` is a dot to the URL parser, in any case and mixed with literal dots (`%2e%2e`, `.%2E`).
    const dotted = segment.replace(/%2e/gi, '.')
    return dotted !== '.' && dotted !== '..'
  })
}

function encodeSegments(sessionKey, encodeSegment) {
  if (!isSafeSessionKey(sessionKey)) throw new Error('unsafe session key')
  return sessionKey.split('/').map(encodeSegment).join('/')
}

// Session keys contain '/' (sub-project paths) and '::'. The backend routes use `:path`, so the
// slashes stay as separators and every segment is encoded on its own.
export function encodeSessionKey(sessionKey) {
  return encodeSegments(sessionKey, encodeURIComponent)
}

// The same for `/ws/pty/<key>`, which the V2 opens with the colons as they are (the backend reads the
// decoded path either way).
export function encodePtySessionKey(sessionKey) {
  return encodeSegments(sessionKey, (segment) => encodeURIComponent(segment).replace(/%3A/gi, ':'))
}
