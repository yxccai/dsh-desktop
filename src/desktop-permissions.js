'use strict';

const CLIPBOARD_WRITE_PERMISSIONS = new Set([
  'clipboard-sanitized-write',
  'clipboard-write',
]);

function allowsDesktopPermission({ permission, senderUrl, appOrigin, isMainWindow }) {
  if (!isMainWindow || !CLIPBOARD_WRITE_PERMISSIONS.has(permission)) return false;
  try { return new URL(senderUrl).origin === appOrigin; }
  catch { return false; }
}

module.exports = { allowsDesktopPermission, CLIPBOARD_WRITE_PERMISSIONS };
