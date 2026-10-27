/**
 * The responsive frame: the sidebar becomes a drawer on narrow screens,
 * phones switch between Edit and Preview, and wider screens get a splitter
 * between the editor and the preview (drag, or arrow keys when focused).
 */

const PHONE_QUERY = '(max-width: 767px)';
const DRAWER_QUERY = '(max-width: 1023px)';
const SPLIT_KEY = 'markdown-editor:split';
const SPLIT_DEFAULT = 50;
const SPLIT_MIN = 20;
const SPLIT_MAX = 80;
const SPLIT_STEP = 5;

/**
 * @typedef {object} LayoutView
 * @property {() => boolean} isPhone - one pane at a time, switched by the tabs
 * @property {() => 'edit'|'preview'} tab - the pane shown on phones
 * @property {(tab: 'edit'|'preview') => void} setTab
 * @property {() => void} closeDrawer - closes the drawer (if open) and returns the focus to the menu button
 */

/**
 * Wires the drawer, the phone tabs and the splitter.
 * @param {object} parts
 * @param {Window} parts.win
 * @param {HTMLElement} parts.root - gets the drawer-open and resizing classes
 * @param {HTMLElement} parts.panes - gets data-view and the --split custom property
 * @param {HTMLElement[]} parts.tabs - the Edit and Preview buttons (data-view)
 * @param {HTMLElement} parts.splitter - role="separator"
 * @param {HTMLElement} parts.menuButton
 * @param {HTMLElement} parts.drawerClose
 * @param {HTMLElement} parts.backdrop
 * @param {HTMLElement[]} parts.covered - made inert while the drawer is open
 * @param {import('./storage.js').SafeStorage} parts.storage - remembers the splitter position
 * @param {(tab: 'edit'|'preview') => void} parts.onTab - a tab was clicked
 * @param {(isPhone: boolean) => void} parts.onModeChange - the screen crossed the phone width
 * @returns {LayoutView}
 */
export function createLayoutView({ win, root, panes, tabs, splitter, menuButton, drawerClose, backdrop, covered, storage, onTab, onModeChange }) {
  const doc = win.document;
  const phone = win.matchMedia(PHONE_QUERY);
  const drawerMode = win.matchMedia(DRAWER_QUERY);
  let drawerOpen = false;
  let tab = 'edit';
  let split = SPLIT_DEFAULT;

  const setDrawer = (open, returnFocus) => {
    const wasOpen = drawerOpen;
    drawerOpen = open && drawerMode.matches;
    root.classList.toggle('drawer-open', drawerOpen);
    menuButton.setAttribute('aria-expanded', String(drawerOpen));
    for (const el of covered) el.inert = drawerOpen;
    if (drawerOpen && !wasOpen) drawerClose.focus();
    if (!drawerOpen && wasOpen && returnFocus) menuButton.focus();
  };

  menuButton.addEventListener('click', () => setDrawer(!drawerOpen, false));
  drawerClose.addEventListener('click', () => setDrawer(false, true));
  backdrop.addEventListener('click', () => setDrawer(false, true));
  doc.addEventListener('keydown', (event) => {
    // A dialog handles its own Escape.
    if (event.key === 'Escape' && drawerOpen && !event.target.closest?.('dialog')) setDrawer(false, true);
  });
  drawerMode.addEventListener('change', () => setDrawer(false, false));
  phone.addEventListener('change', () => onModeChange(phone.matches));

  for (const button of tabs) button.addEventListener('click', () => onTab(button.dataset.view));

  const setSplit = (value) => {
    split = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Math.round(value)));
    panes.style.setProperty('--split', `${split}%`);
    splitter.setAttribute('aria-valuenow', String(split));
  };
  const saveSplit = () => storage.setText(SPLIT_KEY, String(split));

  setSplit(Number(storage.getText(SPLIT_KEY)) || SPLIT_DEFAULT);

  splitter.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    splitter.setPointerCapture(event.pointerId);
    root.classList.add('resizing');
    const move = (moveEvent) => {
      const box = panes.getBoundingClientRect();
      if (box.width > 0) setSplit(((moveEvent.clientX - box.left) / box.width) * 100);
    };
    const end = () => {
      splitter.removeEventListener('pointermove', move);
      splitter.removeEventListener('pointerup', end);
      splitter.removeEventListener('pointercancel', end);
      root.classList.remove('resizing');
      saveSplit();
    };
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', end);
    splitter.addEventListener('pointercancel', end);
  });
  splitter.addEventListener('keydown', (event) => {
    const targets = {
      ArrowLeft: split - SPLIT_STEP,
      ArrowRight: split + SPLIT_STEP,
      Home: SPLIT_MIN,
      End: SPLIT_MAX,
      Enter: SPLIT_DEFAULT,
    };
    if (!Object.hasOwn(targets, event.key)) return;
    event.preventDefault();
    setSplit(targets[event.key]);
    saveSplit();
  });
  splitter.addEventListener('dblclick', () => {
    setSplit(SPLIT_DEFAULT);
    saveSplit();
  });

  return {
    isPhone: () => phone.matches,
    tab: () => tab,
    setTab(next) {
      tab = next === 'preview' ? 'preview' : 'edit';
      panes.dataset.view = tab;
      for (const button of tabs) button.setAttribute('aria-pressed', String(button.dataset.view === tab));
    },
    closeDrawer: () => setDrawer(false, true),
  };
}
