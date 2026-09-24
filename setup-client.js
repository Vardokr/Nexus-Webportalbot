'use strict';
const form = document.getElementById('setup');
const message = document.getElementById('message');
const button = document.getElementById('submit');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  if (values.password !== values.confirm) { message.textContent = 'Die Passwörter stimmen nicht überein.'; return; }
  const file = document.getElementById('credentials').files[0];
  if (!file || file.size > 20000) { message.textContent = 'Bitte eine Servicekonto-JSON-Datei bis 20 KB auswählen.'; return; }
  button.disabled = true;
  message.textContent = 'Firebase, Wargaming und gegebenenfalls Discord werden geprüft …';
  try {
    let credentials;
    try { credentials = JSON.parse(await file.text()); } catch { throw new Error('Die hochgeladene Datei enthält kein gültiges JSON.'); }
    const { token, confirm, ...settings } = values;
    const response = await fetch('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Setup-Token': token }, body: JSON.stringify({ ...settings, credentials }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Einrichtung fehlgeschlagen.');
    form.reset();
    form.querySelectorAll('input').forEach(input => { input.disabled = true; });
    message.textContent = 'Einrichtung abgeschlossen. Der Watchdog startet jetzt. Öffne anschließend das Dashboard und melde dich mit deinem Administrator an.';
    button.hidden = true;
    document.getElementById('dashboard').hidden = false;
  } catch (error) { message.textContent = error.message; button.disabled = false; }
});
