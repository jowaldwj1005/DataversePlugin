/**
 * Self-contained auto-resizing textarea component.
 * Uses a hidden sizer div to compute needed height on each keystroke.
 */
export function createDynamicTextarea(options = {}) {
  const {
    placeholder = '',
    initialValue = '',
    minRows = 3,
    maxHeight = '50vh',
    className = '',
    onChange = null
  } = options;

  const minH = `${minRows * 1.5}em`;

  // Hidden sizer mirrors textarea content to measure natural height
  const sizer = document.createElement('div');
  Object.assign(sizer.style, {
    position: 'absolute',
    visibility: 'hidden',
    height: 'auto',
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
    overflowWrap: 'break-word',
    fontFamily: 'Consolas, monospace',
    fontSize: '0.78rem',
    lineHeight: '1.5',
    padding: '6px 8px',
    boxSizing: 'border-box',
    width: '100%',
    pointerEvents: 'none'
  });

  // Wrapper keeps sizer width in sync with textarea
  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.width = '100%';
  wrapper.appendChild(sizer);

  const textarea = document.createElement('textarea');
  if (className) textarea.className = className;
  textarea.placeholder = placeholder;
  textarea.value = initialValue;
  Object.assign(textarea.style, {
    width: '100%',
    boxSizing: 'border-box',
    fontFamily: 'Consolas, monospace',
    fontSize: '0.78rem',
    lineHeight: '1.5',
    padding: '6px 8px',
    minHeight: minH,
    maxHeight: maxHeight,
    overflowY: 'auto',
    resize: 'none',
    display: 'block'
  });
  wrapper.appendChild(textarea);

  let rafId = null;

  function resize() {
    // Feed content into sizer; add a trailing newline so the last empty line is measured
    sizer.textContent = textarea.value + '\n';
    const needed = sizer.scrollHeight;
    textarea.style.height = `${needed}px`;
  }

  function onInput() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      resize();
      if (onChange) onChange(textarea.value);
    });
  }

  textarea.addEventListener('input', onInput);

  // Initial sizing after the element is in the DOM
  requestAnimationFrame(resize);

  return {
    element: wrapper,
    getValue() { return textarea.value; },
    setValue(text) {
      textarea.value = text;
      resize();
    },
    destroy() {
      if (rafId) cancelAnimationFrame(rafId);
      textarea.removeEventListener('input', onInput);
      sizer.remove();
    }
  };
}
