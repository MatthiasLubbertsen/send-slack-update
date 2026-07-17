// Key waaronder de concept-tekst in localStorage wordt bewaard
const STORAGE_KEY = 'daily-update-draft';

const textarea = document.getElementById('update-textarea');
const sendButton = document.getElementById('send-button');
const buttonText = document.getElementById('button-text');
const buttonSpinner = document.getElementById('button-spinner');
const messageEl = document.getElementById('message');

/**
 * Herstelt een eerder opgeslagen concept uit localStorage bij het openen
 * van de pagina.
 */
function restoreDraft() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    textarea.value = saved;
    autoResize();
  }
}

/**
 * Laat de textarea automatisch meegroeien met de inhoud.
 */
function autoResize() {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

/**
 * Slaat de huidige inhoud van de textarea op in localStorage.
 */
function saveDraft() {
  localStorage.setItem(STORAGE_KEY, textarea.value);
}

/**
 * Toont een success- of error-melding onder de knop.
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
 * Schakelt de loading-state van de verstuur-knop aan/uit.
 */
function setLoading(isLoading) {
  sendButton.disabled = isLoading;
  buttonText.textContent = isLoading ? 'Versturen...' : 'Send to Slack';
  buttonSpinner.classList.toggle('hidden', !isLoading);
}

/**
 * Verstuurt de huidige tekst naar de backend, die deze parsed,
 * omzet naar Slack mrkdwn en post naar Slack.
 */
async function sendUpdate() {
  const text = textarea.value.trim();

  if (!text) {
    showMessage('Voer eerst je werkzaamheden in.', 'error');
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
      throw new Error(data.error || 'Er ging iets mis bij het versturen.');
    }

    // Succesvol verstuurd: textarea en localStorage leegmaken
    textarea.value = '';
    localStorage.removeItem(STORAGE_KEY);
    autoResize();
    showMessage("Update succesvol verstuurd naar Slack \u2705", 'success');
  } catch (error) {
    // Bij een fout blijft de textarea behouden zodat er niets verloren gaat
    showMessage(error.message || 'Er ging iets mis bij het versturen.', 'error');
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
