/**
 * Dataverse Toolkit - DevTools Entry Point
 *
 * Creates a "Dataverse" panel inside Chrome DevTools. This script runs
 * once when DevTools opens and registers the panel.
 */

chrome.devtools.panels.create(
  'Dataverse',
  '/icons/icon16.png',
  '/src/devtools/panel.html',
  (panel) => {
    // Panel created successfully
    console.log('[Dataverse Toolkit] DevTools panel created.');
  }
);
