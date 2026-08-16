'use strict';

/**
 * Sender-trust guards for desktop IPC channels, kept free of Electron imports
 * so they can be unit-tested under plain node (test/ipc-guards.test.js).
 *
 * Every channel handler in `src/main.js` runs one of these guards against the
 * live window handles and the invoking `webContents`. Two callers are trusted:
 *
 *   1. the dedicated plugin-center window owned by this process, and
 *   2. the main DSH window, ONLY while its URL stays on the configured origin
 *      (`isAllowedNavigation`). The exact-URL check is what keeps a page that
 *      somehow navigated the main window away from reaching desktop IPC.
 *
 * The `web-market:*` channels are additionally exposed to the main DSH page
 * through `src/preload.js` so the Web settings bridge (内置插件 tab) can
 * install/enable/disable/uninstall the optional market without opening the
 * desktop plugin-center window — same two trusted callers, same exact-URL
 * gate.
 */

function isAlive(window) {
  return Boolean(window && typeof window.isDestroyed === 'function' && !window.isDestroyed());
}

function isMainDshPage({ mainWindow, sender, isAllowedNavigation }) {
  return isAlive(mainWindow)
    && sender === mainWindow.webContents
    && isAllowedNavigation(sender.getURL());
}

/** Guards the `plugin-center:*` channels (recommended Presets + desktop settings). */
function isPluginCenterSender({ pluginCenterWindow, mainWindow, sender, isAllowedNavigation }) {
  if (isAlive(pluginCenterWindow) && sender === pluginCenterWindow.webContents) return true;
  return isMainDshPage({ mainWindow, sender, isAllowedNavigation });
}

/** Guards the `web-market:*` channels: plugin-center window OR the exact trusted main DSH page. */
function isWebMarketSender({ pluginCenterWindow, mainWindow, sender, isAllowedNavigation }) {
  if (isAlive(pluginCenterWindow) && sender === pluginCenterWindow.webContents) return true;
  return isMainDshPage({ mainWindow, sender, isAllowedNavigation });
}

module.exports = { isPluginCenterSender, isWebMarketSender, isMainDshPage };
