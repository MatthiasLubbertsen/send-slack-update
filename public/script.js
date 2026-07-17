// Key under which the draft text is stored in localStorage
const STORAGE_KEY = 'daily-update-draft';

const textarea = document.getElementById('update-textarea');
const sendButton = document.getElementById('send-button');
const buttonText = document.getElementById('button-text');
const buttonSpinner = document.getElementById('button-spinner');
const messageEl = document.getElementById('message');

/**
 * Restores a previously saved draft from localStorage when the page loads.
 */
function restoreDraft() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    textarea.value = saved;
    autoResize();
  }
}

/**
 * Grows the textarea automatically to fit its content.
 */
function autoResize() {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

/**
 * Saves the current textarea content to localStorage.
 */
function saveDraft() {
  localStorage.setItem(STORAGE_KEY, textarea.value);
}

/**
 * Shows a success or error message below the button.
 */
function showMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
  messageEl.classList.remove('hidden');
}

function hideMessage() {
  messageEl.classList.add('hidden');
}

/**
 * Toggles the loading state of the send button.
 */
function setLoading(isLoading) {
  sendButton.disabled = isLoading;
  buttonText.textContent = isLoading ? 'Sending...' : 'Send to Slack';
  buttonSpinner.classList.toggle('hidden', !isLoading);
}

/**
 * Sends the current text to the backend, which parses it, converts it
 * to Slack Block Kit and posts it to Slack.
 */
async function sendUpdate() {
  const text = textarea.value.trim();

  if (!text) {
    showMessage('Please enter your tasks first.', 'error');
    return;
  }

  hideMessage();
  setLoading(true);

  try {
    const response = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Something went wrong while sending.');
    }

    // Successfully sent: clear the textarea and localStorage
    textarea.value = '';
    localStorage.removeItem(STORAGE_KEY);
    autoResize();
    showMessage('Update sent to Slack successfully \u2705', 'success');
  } catch (error) {
    // On error, keep the textarea content so nothing gets lost
    showMessage(error.message || 'Something went wrong while sending.', 'error');
  } finally {
    setLoading(false);
  }
}

textarea.addEventListener('input', () => {
  autoResize();
  saveDraft();
});

textarea.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.key === 'Enter') {
    event.preventDefault();
    sendUpdate();
  }
});

sendButton.addEventListener('click', sendUpdate);

// Init
restoreDraft();
