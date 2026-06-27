// Send notifications to the owner on Bale (same bot the workflows use).
// Note: we deliberately do NOT call getUpdates here — n8n WF1 owns that queue,
// and polling it from two places would drop messages. The dashboard is send-only.
const { config } = require('./env');

async function send(text, chat) {
  const chatId = chat || config.bale.ownerChat;
  try {
    await fetch('https://tapi.bale.ai/bot' + config.bale.token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { send };
