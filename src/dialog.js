/**
 * Confirm and prompt dialogs on one <dialog> element. They return promises,
 * so the app can `await` an answer without the browser's blocking popups.
 */

/**
 * @typedef {object} Dialogs
 * @property {(message: string, okLabel: string, danger?: boolean) => Promise<boolean>} confirm
 * @property {(message: string, okLabel: string, value: string) => Promise<string|null>} prompt - null when cancelled
 */

/**
 * Wires the dialog markup (see index.html).
 * @param {{dialog: HTMLDialogElement, form: HTMLFormElement, message: HTMLElement,
 *   input: HTMLInputElement, ok: HTMLButtonElement, cancel: HTMLButtonElement}} parts
 * @returns {Dialogs}
 */
export function createDialogs({ dialog, form, message, input, ok, cancel }) {
  let settle = null;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    dialog.close('ok');
  });
  cancel.addEventListener('click', () => dialog.close('cancel'));
  // A click on the backdrop lands on the <dialog> itself (the form fills it).
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close('cancel');
  });
  dialog.addEventListener('close', () => {
    const answer = dialog.returnValue === 'ok' ? input.value : null;
    const done = settle;
    settle = null;
    done?.(answer);
  });

  const open = (text, okLabel, value, danger) => {
    if (dialog.open) return Promise.resolve(null);
    message.textContent = text;
    ok.textContent = okLabel;
    ok.classList.toggle('btn-danger', danger);
    ok.classList.toggle('btn-primary', !danger);
    input.hidden = value === null;
    input.value = value ?? '';
    dialog.returnValue = '';
    return new Promise((resolve) => {
      settle = resolve;
      dialog.showModal();
      if (value === null) cancel.focus();
      else input.select();
    });
  };

  return {
    confirm: (text, okLabel, danger = false) => open(text, okLabel, null, danger).then((answer) => answer !== null),
    prompt: (text, okLabel, value) => open(text, okLabel, String(value ?? ''), false),
  };
}
